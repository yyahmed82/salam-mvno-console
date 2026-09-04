/* LOGIN TRACE — "did this customer log in, and where did the login stop?"
 *
 * WHY THIS MODULE EXISTS
 * A login leaves a much thinner trail than an order or a payment, and the trail is NOT where
 * intuition puts it. Every statement below is read from the app source
 * (selfcare-backend), not inferred from data:
 *
 *   app/controllers/api/v1/users/authentication_controller.rb
 *   app/models/user.rb · app/models/concerns/trackable.rb
 *   config/initializers/api_guard.rb · app/services/optiva/account.rb
 *
 * THE REAL FLOW  (POST users/sign_in → POST users/verify)
 *   ① find_resource   → Optiva get_subscription_profile(mobile)
 *                       DEACTIVATED → -512 · PENDING → -513 · lookup fails → -112
 *   ② authenticate(password)                     wrong password / no account → -300
 *   ③ current_plan missing                                                  → -705
 *   ④ update_tracked_fields!  ← THE ONLY DATABASE WRITE OF THE WHOLE LOGIN
 *        writes users.current_sign_in_at / last_sign_in_at / current_sign_in_ip /
 *        last_sign_in_ip / sign_in_count+1 / platform / app_version / os_version
 *        …and it runs at the PASSWORD step, BEFORE the OTP is even sent.
 *   ⑤ if (Current.new_registration && Setting.login_otp) → send_otp, respond "OTP delivered"
 *        send_otp uses has_one_time_password(length: 4, interval: 5.minutes) — a TOTP derived
 *        from users.otp_secret_key. ***NO ROW IS WRITTEN TO THE otps TABLE.*** That is why a
 *        login OTP is invisible there: the `otps` table serves registration and other flows.
 *        The SMS goes out through Notifier::SmsWorker (Sidekiq, fire-and-forget, no DB row).
 *      else → token issued immediately (no OTP step at all)
 *   ⑥ users/verify → authenticate_otp(code, drift: 180) → wrong/expired → -103
 *        On success a token is issued. THIS STEP WRITES NOTHING AT ALL — not even tracked fields.
 *   ⑦ the app then reads the balance: Optiva::Account#query_bill →
 *        POST /bss/account/execute-account-blnc-query   (visible in the API log + uil_logs)
 *
 * THREE CONSEQUENCES, ALL COUNTER-INTUITIVE
 *   • "Currently logged in" IS NOT A FACT THE PLATFORM STORES. api_guard is configured with
 *     `token_validity = 1.year` and there is no server-side session table and no write on
 *     logout. Once a token is issued it is simply valid for a year. Any product that claims a
 *     live logged/not-logged flag is guessing. What is provable is LAST AUTHENTICATION and
 *     LAST ACTIVITY.
 *   • users.current_sign_in_at means "password accepted", NOT "login completed". A customer who
 *     abandons at the OTP screen still gets a fresh timestamp and sign_in_count+1. The gap
 *     between ④ and ⑥ is exactly the OTP drop-off, and it is measurable (see funnel()).
 *   • The write happens on the primary. Whether the console can SEE it depends only on whether
 *     `users` is in the replica sync — see freshness(). A stale timestamp is a sync gap, never
 *     proof that tracking is broken.
 *
 * WHAT THIS MODULE READS — nothing new, no new credentials:
 *   replica `users`            → per-customer last authentication (needs users in prodSync)
 *   console `api_traffic_events` → the platform-wide funnel ①→⑥→⑦ (paths + response codes)
 * Read-only throughout. */
'use strict';

const db = require('./db');

/* App error codes, from app/controllers/concerns/error_codes.rb — exact, not guessed. */
const LOGIN_CODES = {
  '-300': { label: 'Invalid login credentials', cls: 'business', where: 'password', hint: 'wrong password, or no app account for that number' },
  '-103': { label: 'Invalid OTP', cls: 'business', where: 'otp', hint: 'wrong or expired code — the TOTP window is 5 min ±180 s drift' },
  '-112': { label: 'Invalid mobile number', cls: 'business', where: 'lookup', hint: 'malformed number, OR the Optiva profile lookup raised — a BSS fault surfaces as this code' },
  '-512': { label: 'Account suspended', cls: 'business', where: 'lookup', hint: 'Optiva state = DEACTIVATED (the app row is then deleted)' },
  '-513': { label: 'Account pending', cls: 'business', where: 'lookup', hint: 'Optiva state = PENDING — activation not finished' },
  '-705': { label: 'Plan not registered', cls: 'business', where: 'plan', hint: 'password was correct but the customer has no current plan' },
  '-102': { label: 'Invalid customer info', cls: 'technical', where: 'save', hint: 'the user row failed to save after the Optiva sync' },
  '-704': { label: 'IP retries exceeded', cls: 'technical', where: 'limiter', hint: 'the IP rate-limiter blocked the request before login logic ran' }
};

/* WHICH LOG HOLDS WHAT — this cost a wrong first version of the funnel.
 * api_logger.production.log (→ api_traffic_events) records the app's OUTBOUND integration calls:
 * every path in it starts with /bss/… . The customer's INBOUND requests — users/sign_in,
 * users/verify — are NOT in it, which is why matching on `%/users/sign_in` returned zero while
 * the balance call returned 18k. The three steps therefore come from three different places:
 *   ① accepted passwords → replica `users`: the tracked-fields write IS the event, counted exactly
 *   ①/② failures        → console `api_error_events` (api_error_logger), which carries the app
 *                          error code plus controller/action, so login failures are separable
 *   ③ balance           → console `api_traffic_events` (outbound BSS), the one that always worked
 * Successful OTP verifications are recorded NOWHERE (step ⑥ writes nothing and the inbound
 * request is not logged), so the funnel reports that gap instead of inventing a number. */
const BALANCE_LIKE = '%execute-account-blnc-query%';
const AUTH_CTRL = '%authentication%';

const SUCCESS = new Set(['00', '0', '000', '0000', '200', '600']);

/* ---------------------------------------------------------------- freshness ---- */
/* Can the console see logins at all? Everything users-derived is worthless without this. */
/* freshness() runs on EVERY per-customer lookup and takes max(current_sign_in_at) over ~505k
 * rows. Until the index lands that is a sequential scan, and the answer is identical for every
 * caller — so cache it for a minute. Two of these per page load were enough to occupy the
 * 4-connection source pool and make the health strip's own ping time out. */
let _freshCache = null;
async function freshness() {
  if (_freshCache && Date.now() - _freshCache.at < 60000) return _freshCache.v;
  const out = { users_in_sync: false, newest_login_seen: null, age_days: null, watermark: null, last_run_at: null, last_status: null, verdict: '' };
  try {
    out.users_in_sync = (require('./prodSync').DEFAULT_TABLES || []).includes('users');
  } catch (_) { }
  try {
    const r = await db.source.query(`SELECT max(current_sign_in_at) newest FROM users`);
    out.newest_login_seen = r.rows[0] && r.rows[0].newest;
    if (out.newest_login_seen) out.age_days = Math.round((Date.now() - new Date(out.newest_login_seen).getTime()) / 86400000);
  } catch (e) { out.error = e.message; }
  try {
    const s = (await db.console.query(
      `SELECT watermark, last_run_at, last_status, rows_synced FROM prod_sync_state WHERE table_name='users'`)).rows[0];
    if (s) { out.watermark = s.watermark; out.last_run_at = s.last_run_at; out.last_status = s.last_status; out.rows_synced = Number(s.rows_synced); }
  } catch (_) { }
  out.verdict = !out.users_in_sync
    ? 'BLIND — `users` is not in the replica sync, so every sign-in value here is frozen at the last full copy. Add it to prodSync.DEFAULT_TABLES to make logins visible.'
    : (out.age_days != null && out.age_days > 1)
      ? `STALE — the newest sign-in on the replica is ${out.age_days} days old; the sync is configured but is not landing rows.`
      : 'LIVE — sign-in tracking is being replicated; timestamps below are current.';
  _freshCache = { at: Date.now(), v: out };
  return out;
}

/* ------------------------------------------------------------------- funnel ---- */
/* Platform-wide login funnel from the API log. No identity is involved — the collector masks
 * MSISDNs at ingest by design — so this answers "are logins working" and "where do they fail",
 * not "who". Cheap: two indexed scans (idx_api_traffic_events_path_ts). */
/* Is the OTP step even active? `Current.new_registration && Setting.login_otp` gates it, so with
 * login_otp off a token is issued straight after the password and there is no ② at all. Read it
 * rather than assume — RailsSettings keeps it in the (synced) `settings` table as a YAML value. */
async function loginOtpSetting() {
  try {
    const r = await db.source.query(`SELECT value FROM settings WHERE var = 'login_otp' LIMIT 1`);
    if (!r.rows.length) return null;
    return /true/i.test(String(r.rows[0].value)) ? true : /false/i.test(String(r.rows[0].value)) ? false : null;
  } catch (_) { return null; }
}

async function funnel({ hours = 24 } = {}) {
  const h = Math.min(24 * 14, Math.max(1, Number(hours) || 24));
  const since = new Date(Date.now() - h * 3600e3);
  const out = { window: { hours: h, from: since.toISOString(), to: new Date().toISOString() }, steps: [], drop: null, notes: [] };
  out.otp_required = await loginOtpSetting();

  /* ① accepted passwords — counted from the tracked-fields write itself, not from a log. This is
   * exact: one row per accepted password, and it only exists because `users` is now synced. */
  let accepted = null, acceptedErr = null;
  try {
    accepted = Number((await db.source.query(
      `SELECT count(*)::bigint n FROM users WHERE current_sign_in_at >= $1`, [since])).rows[0].n);
  } catch (e) { acceptedErr = e.message; }

  /* ①/② failures — the app error log, split by controller action: create = the password step,
   * verify = the OTP step. Both carry the exact ErrorCodes constant. */
  const failRows = (await db.console.query(
    `SELECT COALESCE(action,'?') action, error_code, count(*)::int n, max(ts) newest
       FROM api_error_events
      WHERE ts >= $1 AND controller ILIKE $2
      GROUP BY 1,2 ORDER BY n DESC`, [since, AUTH_CTRL])).rows;
  const failFor = act => failRows.filter(r => String(r.action).toLowerCase() === act)
    .map(r => {
      const code = String(r.error_code);
      const meta = LOGIN_CODES[code] || null;
      return { code, n: r.n, newest: r.newest, ok: false,
        label: meta ? meta.label : null, cls: meta ? meta.cls : 'unknown',
        where: meta ? meta.where : null, hint: meta ? meta.hint : null };
    });

  const pwFails = failFor('create'), otpFails = failFor('verify');
  const sum = a => a.reduce((x, c) => x + c.n, 0);

  out.steps.push({
    key: 'signin', label: '① Password', source: 'replica users + app error log',
    note: 'credentials + Optiva profile check; this step writes the sign-in tracking',
    total: accepted == null ? null : accepted + sum(pwFails), ok: accepted, fail: sum(pwFails),
    ok_pct: (accepted == null || accepted + sum(pwFails) === 0) ? null
      : +(accepted * 100 / (accepted + sum(pwFails))).toFixed(1),
    codes: pwFails, error: acceptedErr
  });

  out.steps.push({
    key: 'verify', label: '② OTP verify', source: 'app error log (failures only)',
    note: 'the real "logged in" moment — issues the token and writes nothing, so successes are not recorded anywhere',
    total: null, ok: null, fail: sum(otpFails), ok_pct: null, codes: otpFails, not_measured: true
  });

  /* ③ balance — outbound BSS call, the one step that genuinely lives in the API traffic log. */
  const bal = (await db.console.query(
    `SELECT COALESCE(response_code,'∅') code, count(*)::int n, round(avg(duration_ms))::int avg_ms, max(ts) newest
       FROM api_traffic_events WHERE ts >= $1 AND path ILIKE $2
      GROUP BY 1 ORDER BY n DESC LIMIT 15`, [since, BALANCE_LIKE])).rows
    .map(x => ({ code: x.code, n: x.n, avg_ms: x.avg_ms, newest: x.newest, ok: SUCCESS.has(x.code),
      label: SUCCESS.has(x.code) ? 'Success' : null, cls: SUCCESS.has(x.code) ? 'success' : 'technical' }));
  const balTotal = sum(bal), balOk = sum(bal.filter(c => c.ok));
  out.steps.push({
    key: 'balance', label: '③ Balance (BSS)', source: 'outbound API log',
    note: 'first authenticated call the app makes after login — also called elsewhere in the app, so it is a ceiling, not a login count',
    total: balTotal, ok: balOk, fail: balTotal - balOk,
    ok_pct: balTotal ? +(balOk * 100 / balTotal).toFixed(1) : null, codes: bal.filter(c => !c.ok)
  });

  const wrongOtp = (otpFails.find(c => c.code === '-103') || {}).n || 0;
  out.drop = {
    passwords_accepted: accepted,
    wrong_otp: wrongOtp,
    password_failures: sum(pwFails),
    balance_calls: balTotal,
    abandoned_at_otp: null,
    why_not: out.otp_required === false
      ? 'The OTP step is switched OFF (Setting.login_otp = false), so an accepted password issues a token immediately — there is no abandonment to measure.'
      : 'Successful OTP verifications are written nowhere: step ⑥ makes no database change, and the inbound request is not in the API log (that log carries outbound /bss calls only). '
        + 'Only failed verifications are visible, through the app error log. To close this, ask the app team to log a line on successful verify — or to call update_tracked_fields! there too.'
  };

  if (acceptedErr) out.notes.push(`Accepted-password count unavailable: ${acceptedErr}`);
  else if (accepted === 0) out.notes.push(
    'No accepted passwords in this window. If that looks wrong, check the users sync — this number comes from the replica, not from a log.');
  if (!failRows.length) out.notes.push(
    'No login failures in the app error log for this window. That log only fills when the app renders an error, so a quiet window is normal.');
  out.notes.push(
    'Accepted passwords are counted exactly, from the sign-in tracking the app writes. Failures come from the app error log. '
    + 'Neither carries a customer identity here — use the per-customer lookup below for one subscriber.');
  return { ok: true, ...out };
}

/* ------------------------------------------------------- per customer state ---- */
const digitsOf = s => String(s || '').replace(/\D/g, '');
function numberForms(msisdn) {
  const l9 = digitsOf(msisdn).slice(-9);
  if (!/^5\d{8}$/.test(l9)) return [];
  return ['0' + l9, '966' + l9, '+966' + l9, l9, '00966' + l9];
}

/* One customer: every line under the identity, with the last authentication and what it proves.
 * Never returns a bare "logged in / not logged in" — that state does not exist server-side. */
async function state(q) {
  const raw = String(q || '').trim();
  const digits = digitsOf(raw);
  const out = { query: raw, lines: [], verdict: null, evidence: [], notes: [] };
  out.freshness = await freshness();

  const have = new Set((await db.source.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='users' AND column_name = ANY($1::text[])`,
    [['mobile_number', 'nationality_id_number', 'current_sign_in_at', 'last_sign_in_at',
      'current_sign_in_ip', 'last_sign_in_ip', 'sign_in_count', 'platform', 'app_version', 'os_version', 'updated_at']]
  )).rows.map(r => r.column_name));
  const c = (n, t) => have.has(n) ? `"${n}"` : `NULL::${t} AS ${n}`;
  const SEL = `SELECT id::text,
      ${c('mobile_number', 'text')}, ${c('current_sign_in_at', 'timestamptz')}, ${c('last_sign_in_at', 'timestamptz')},
      ${c('current_sign_in_ip', 'text')}, ${c('last_sign_in_ip', 'text')}, ${c('sign_in_count', 'int')},
      ${c('platform', 'text')}, ${c('app_version', 'text')}, ${c('os_version', 'text')}, ${c('updated_at', 'timestamptz')}
    FROM users`;

  let rows = [];
  const forms = numberForms(digits);
  if (forms.length && have.has('mobile_number'))
    rows = (await db.source.query(`${SEL} WHERE mobile_number = ANY($1::text[])
      ORDER BY current_sign_in_at DESC NULLS LAST, sign_in_count DESC NULLS LAST LIMIT 10`, [forms])).rows;
  if (!rows.length && /^[12]\d{9}$/.test(digits) && have.has('nationality_id_number'))
    rows = (await db.source.query(`${SEL} WHERE nationality_id_number = $1
      ORDER BY current_sign_in_at DESC NULLS LAST, sign_in_count DESC NULLS LAST LIMIT 10`, [digits])).rows;

  if (!rows.length) {
    out.notes.push('No app account found for that number or ID. Note that a DEACTIVATED account is deleted by the login flow itself (see -512), so an absent row can also mean the line was deactivated.');
    return out;
  }

  const now = Date.now();
  out.lines = rows.map(r => {
    const at = r.current_sign_in_at || null;
    const ageMin = at ? Math.round((now - new Date(at).getTime()) / 60000) : null;
    return {
      mobile: r.mobile_number,
      last_auth_at: at,
      previous_auth_at: r.last_sign_in_at,
      age_minutes: ageMin,
      sign_in_count: r.sign_in_count,
      ip: r.current_sign_in_ip,
      previous_ip: r.last_sign_in_ip,
      platform: r.platform, app_version: r.app_version, os_version: r.os_version,
      row_updated_at: r.updated_at
    };
  });

  const newest = out.lines.filter(l => l.last_auth_at)
    .sort((a, b) => new Date(b.last_auth_at) - new Date(a.last_auth_at))[0] || null;

  if (!out.freshness.users_in_sync) {
    out.verdict = {
      state: 'not-observable',
      headline: 'Cannot answer — the console is not receiving sign-in data',
      why: 'The `users` table is not part of the incremental replica sync, so its sign-in columns are frozen at the last full copy. '
        + 'The app IS writing them on every accepted password (Trackable#update_tracked_fields!, called from AuthenticationController#create) — '
        + 'the write simply never reaches this replica.',
      fix: 'Add `users` to prodSync.DEFAULT_TABLES and run a sync.'
    };
  } else if (!newest) {
    out.verdict = { state: 'never', headline: 'This account has never completed the password step', why: 'current_sign_in_at is empty for every line under this identity.' };
  } else {
    const ageMin = newest.age_minutes;
    const human = ageMin < 60 ? `${ageMin} min ago` : ageMin < 2880 ? `${Math.round(ageMin / 60)} h ago` : `${Math.round(ageMin / 1440)} days ago`;
    out.verdict = {
      state: ageMin <= 15 ? 'authenticating-now' : ageMin <= 1440 ? 'recent' : 'idle',
      headline: `Password last accepted ${human} on ${newest.mobile}`,
      not_a_session: 'This is the last recorded AUTHENTICATION, not a live session. Signing out changes nothing here — '
        + 'sign-out is client-side only (there is no token blacklist table), so this value moves only when the customer signs in AGAIN. '
        + 'A re-login raises sign_in_count by 1 and pushes the current timestamp into last_sign_in_at.',
      why: 'This timestamp is written the moment the password is accepted — BEFORE the OTP is sent. It proves the customer reached the OTP screen, '
        + 'not that the login completed.',
      token: 'If the OTP was then entered correctly the app holds an access token valid for ONE YEAR (api_guard token_validity = 1.year). '
        + 'There is no session table and no write on logout, so "logged in right now" is not a state the platform stores.'
    };
  }

  /* Corroborating activity from tables that ARE live — this is what distinguishes "reached the
   * OTP screen" from "actually used the app afterwards". */
  try {
    const forms2 = numberForms(newest ? newest.mobile : digits);
    if (forms2.length) {
      const pay = (await db.source.query(
        `SELECT created_at, status, payment_on_type FROM payments
          WHERE customer_mobile_number = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`, [forms2])).rows[0];
      if (pay) out.evidence.push({ kind: 'payment', at: pay.created_at, detail: `${pay.payment_on_type || 'payment'} · ${pay.status}`,
        proves: 'the app was holding a valid token at this moment' });
      const otp = (await db.source.query(
        `SELECT created_at, otp_type, verified FROM otps
          WHERE otp_for = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`, [forms2])).rows[0];
      if (otp) out.evidence.push({ kind: 'otp', at: otp.created_at, detail: `${otp.otp_type || 'otp'} · ${otp.verified ? 'verified' : 'not verified'}`,
        proves: 'a stored-OTP flow (registration / change-plan / step-up) — NOT the login OTP, which is a TOTP and is never stored' });
    }
  } catch (e) { out.evidenceError = e.message; }

  out.notes.push('The login OTP is a time-based code (has_one_time_password, 4 digits, 5-minute interval, ±180 s drift). It is never written to the otps table, so its absence there means nothing.');
  if (out.lines.length > 1) out.notes.push(`${out.lines.length} lines are registered under this identity — the most recently authenticated one is used for the verdict.`);
  return out;
}

module.exports = { funnel, state, freshness, LOGIN_CODES };
