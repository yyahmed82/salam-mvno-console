/* SMS TRACE — "what did we send this customer, when, and did it work?"
 *
 * WHAT THE PLATFORM ACTUALLY KEEPS  (read from selfcare-backend, not assumed)
 *   Notifier::SmsWorker#perform(number, message) → SmsVendor.current_vendor.send(message, number)
 *   → HTTParty POST. The response is thrown away and NOTHING is written to any table. There is
 *   no sms_logs, no delivery receipt, no vendor message id. `sms_vendors` holds configuration.
 *
 * So an SMS body exists in exactly three places, none of them permanent:
 *   1. the vendor's own portal (outside this console)
 *   2. Rails.cache for 10 minutes — Otp#cache_message_details writes `<otp_id>_otp_type` and
 *      `<otp_id>_otp_extras`. That is the ONLY record of WHICH template was used.
 *   3. the template itself, config/locales/{en,ar}.yml → imported to smsTemplates.json
 *
 * This module therefore reports three different grades of certainty, and always says which:
 *   RECORDED   — the OTP row itself: recipient, time, verified, time-to-verify. Hard fact.
 *   LIVE       — message type read from Redis (< 10 min old) → the exact template, rendered.
 *   INFERRED   — older OTPs: the type is gone, so it is deduced from what else happened for that
 *                number in the same few seconds (a change-plan log, an order, a payment…).
 * Anything we cannot establish is returned as null with a reason. We never guess a body and
 * present it as sent.
 *
 * TWO NUANCES THAT MATTER FOR SUPPORT
 *   • `otps.otp_for` is the IDENTIFIER, not necessarily the RECIPIENT. Otp#received_on redirects
 *     the SMS to the contact number when otp_for is a data-SIM MSISDN — and received_on is never
 *     stored. For those rows the true recipient is unknown to us and is flagged.
 *   • `otps.code` is the live verification code. It is NEVER returned by this module: anyone
 *     holding it could complete the customer's verification. Presence is reported, value is not.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

const OTP_VALIDITY_SEC = 300;      // OtpRetrial::OTP_VERIFICATION_EXPIRY_TIME
const CACHE_TTL_MIN = 10;          // Otp#cache_message_details expires_in: 10.minutes

/* ---- templates (smsTemplates.json, produced by tools/import-sms-templates.py) ---- */
let _tpl = null;
function templates() {
  if (_tpl) return _tpl;
  const dir = process.env.STATIC_DIR || path.join(__dirname, '..', '..');
  try { _tpl = JSON.parse(fs.readFileSync(path.join(dir, 'smsTemplates.json'), 'utf8')); }
  catch (e) { _tpl = { templates: {}, count: 0, error: e.message }; }
  return _tpl;
}

/* Render a template the way MessageBuilder would. The code is deliberately NOT substituted —
 * see the header — so the placeholder stays visible and the operator sees the shape of the
 * message without being handed a working credential. */
function render(type, lang, extras) {
  const t = (templates().templates || {})[type];
  if (!t) return null;
  let s = t[lang] || t.en || t.ar;
  if (!s) return null;
  const vals = Object.assign({ otp_code: '••••', protection_message: '<protection message>' }, extras || {});
  return s.replace(/%\{(\w+)\}/g, (m, k) => (vals[k] != null ? String(vals[k]) : `%{${k}}`));
}

/* Rails redis_cache_store Marshal-dumps its values. Rather than reimplement Marshal, pull the
 * longest printable ASCII run out of the blob and accept it only if it is a known message type —
 * a wrong guess can never survive that check. */
function typeFromMarshal(raw) {
  if (!raw) return null;
  const known = Object.keys(templates().templates || {});
  const runs = String(raw).match(/[a-z_]{4,40}/g) || [];
  for (const r of runs) if (known.includes(r)) return r;
  return null;
}

/* Is the login OTP step switched on? (Current.new_registration && Setting.login_otp) */
async function loginOtpEnabled() {
  try {
    const r = await db.source.query(`SELECT value FROM settings WHERE var='login_otp' LIMIT 1`);
    if (!r.rows.length) return null;
    return /true/i.test(String(r.rows[0].value)) ? true : /false/i.test(String(r.rows[0].value)) ? false : null;
  } catch (e) { return null; }
}

const digitsOf = s => String(s || '').replace(/\D/g, '');
function numberForms(msisdn) {
  const l9 = digitsOf(msisdn).slice(-9);
  if (!/^5\d{8}$/.test(l9)) return [];
  return ['0' + l9, '966' + l9, '+966' + l9, l9, '00966' + l9];
}
const DATA_SIM = /^(9665|05|5)?8\d{7}$/;   // AccountManager::DATA_SIM_NUMBER_REGEX shape

/* ---- infer the message type of an older OTP from what else happened at that moment ---- */
async function inferTypes(rows, forms) {
  if (!rows.length || !forms.length) return {};
  const lo = new Date(Math.min(...rows.map(r => new Date(r.created_at).getTime())) - 120000);
  const hi = new Date(Math.max(...rows.map(r => new Date(r.created_at).getTime())) + 120000);
  const near = [];
  const add = (t, type, label) => near.push({ at: new Date(t).getTime(), type, label });
  const q = async (sql, params, type, label) => {
    try { (await db.source.query(sql, params)).rows.forEach(r => add(r.at, type, label)); } catch (e) { }
  };
  await q(`SELECT created_at AT TIME ZONE 'UTC' AS at FROM change_plan_logs
            WHERE mobile_number = ANY($1::text[]) AND created_at BETWEEN $2 AND $3`, [forms, lo, hi], 'change_plan', 'change-plan request');
  await q(`SELECT created_at AT TIME ZONE 'UTC' AS at FROM onboarding_orders
            WHERE mobile_number = ANY($1::text[]) AND created_at BETWEEN $2 AND $3`, [forms, lo, hi], 'activate_new_line', 'onboarding order');
  await q(`SELECT created_at AT TIME ZONE 'UTC' AS at FROM payments
            WHERE customer_mobile_number = ANY($1::text[]) AND created_at BETWEEN $2 AND $3`, [forms, lo, hi], null, 'payment');
  const out = {};
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const hit = near.filter(n => Math.abs(n.at - t) <= 90000).sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
    if (hit) out[r.id] = { type: hit.type, because: hit.label, grade: 'inferred' };
  }
  return out;
}

/* ---------------------------------------------------------------- search ---- */
async function search(q, { limit = 60 } = {}) {
  const raw = String(q || '').trim();
  const digits = digitsOf(raw);
  const out = { query: raw, msisdn: null, rows: [], totals: null, notes: [], templates_loaded: templates().count || 0 };

  let forms = numberForms(digits);
  if (!forms.length && /^[12]\d{9}$/.test(digits)) {
    // national ID → the mobile(s) behind it, through the identity log and the app account
    const found = new Set();
    try {
      (await db.source.query(`SELECT DISTINCT msisdn FROM nafath_logs WHERE nationality_id_number=$1 AND msisdn IS NOT NULL LIMIT 10`, [digits]))
        .rows.forEach(r => numberForms(r.msisdn).forEach(f => found.add(f)));
    } catch (e) { }
    try {
      (await db.source.query(`SELECT mobile_number FROM users WHERE nationality_id_number=$1 LIMIT 10`, [digits]))
        .rows.forEach(r => numberForms(r.mobile_number).forEach(f => found.add(f)));
    } catch (e) { }
    forms = [...found];
    if (forms.length) out.notes.push('Resolved the national ID to its mobile number(s) through the identity log and the app account.');
  }
  if (!forms.length) { out.notes.push('Enter a Saudi mobile number (05… / 9665…) or a 10-digit national ID.'); return out; }
  /* `msisdn` (not `resolved`) on purpose: roles.PII_FIELDS masks by KEY NAME, so a field called
   * `resolved` would have sailed past the mask while `identifier` next to it was starred out —
   * the same value, one copy protected and one not. Any field carrying a number must use a name
   * the mask knows. The UI links to Subscriber 360 with the number the operator typed, which
   * never leaves the browser and therefore needs no unmasked copy in the payload. */
  out.msisdn = forms.find(f => /^966/.test(f)) || forms[0];

  const rows = (await db.source.query(
    `SELECT id::text, otp_for, otp_type, delivery_method, verified, created_at, updated_at,
            confirmation_reference::text, (code IS NOT NULL) AS has_code
       FROM otps WHERE otp_for = ANY($1::text[])
      ORDER BY created_at DESC LIMIT $2`, [forms, Math.min(200, limit)])).rows;

  // live message types for anything still inside the 10-minute cache window
  const iprl = require('./ipUnblock');
  const live = {};
  if (iprl.configured()) {
    const fresh = rows.filter(r => Date.now() - new Date(r.created_at).getTime() < CACHE_TTL_MIN * 60000);
    for (const r of fresh.slice(0, 10)) {
      const t = typeFromMarshal(await iprl.getRaw(`${r.id}_otp_type`));
      if (t) live[r.id] = { type: t, grade: 'live' };
    }
  }
  const inferred = await inferTypes(rows.filter(r => !live[r.id]), forms);

  out.rows = rows.map(r => {
    const sent = new Date(r.created_at);
    const ageSec = Math.round((Date.now() - sent.getTime()) / 1000);
    const ttv = r.verified && r.updated_at ? Math.round((new Date(r.updated_at) - sent) / 1000) : null;
    const src = live[r.id] || inferred[r.id] || null;
    const type = src ? src.type : null;
    const status = r.verified ? 'verified'
      : (ageSec > OTP_VALIDITY_SEC ? 'expired-unverified' : 'awaiting-entry');
    const dataSim = DATA_SIM.test(digitsOf(r.otp_for));
    return {
      id: r.id, sent_at: r.created_at, verified_at: r.verified ? r.updated_at : null,
      identifier: r.otp_for, identifier_kind: r.otp_type, channel: r.delivery_method,
      status, time_to_verify_sec: ttv, age_sec: ageSec, has_code: r.has_code,
      message_type: type, type_source: src ? src.grade : null, type_because: src ? src.because : null,
      body_en: type ? render(type, 'en') : null,
      body_ar: type ? render(type, 'ar') : null,
      body_note: type ? 'Template text, rendered from the same locale string MessageBuilder uses. The code is masked.'
        : `Message type not recorded — it lives in Rails.cache for ${CACHE_TTL_MIN} minutes only, and this OTP is older than that.`,
      recipient_mobile: dataSim ? null : r.otp_for,
      recipient_note: dataSim
        ? 'Data-SIM number: Otp#received_on redirects the SMS to the contact number, which is never stored. The real recipient is not knowable from our data.'
        : null,
      confirmation_reference: r.confirmation_reference
    };
  });

  /* LOGIN OTPs ARE NOT IN THE otps TABLE — this is the gap a real phone exposed.
   * User#send_otp (app/models/user.rb) builds the login message with MessageBuilder and calls
   * Notifier::SmsWorker DIRECTLY. It never creates an Otp record, because the login code is a
   * TOTP derived from otp_secret_key rather than a stored one. So a customer can hold a
   * "Your One-time Password to login our mysalamApp: 1234" SMS that has no row anywhere.
   * The one durable trace is the sign-in tracking written in the same request
   * (Trackable#update_tracked_fields!, at the password step, immediately before send_otp).
   * `users` keeps only the current and previous sign-in, so this adds at most two rows per line
   * — enough to answer "did today's login OTP go out", which is what gets asked. */
  try {
    const lg = (await db.source.query(
      `SELECT mobile_number, current_sign_in_at, last_sign_in_at, platform, app_version
         FROM users WHERE mobile_number = ANY($1::text[])`, [forms])).rows;
    const otpOn = await loginOtpEnabled();
    for (const u of lg) {
      for (const [at, which] of [[u.current_sign_in_at, 'most recent sign-in'], [u.last_sign_in_at, 'previous sign-in']]) {
        if (!at) continue;
        const t = new Date(at).getTime();
        if (out.rows.some(r => Math.abs(new Date(r.sent_at).getTime() - t) < 120000)) continue;  // don't double-count
        out.rows.push({
          id: `login:${u.mobile_number}:${t}`, sent_at: at, verified_at: null,
          identifier: u.mobile_number, identifier_kind: 'mobile_number', channel: 'sms',
          status: 'sent-login', time_to_verify_sec: null,
          age_sec: Math.round((Date.now() - t) / 1000), has_code: false,
          message_type: 'login_mysalam', type_source: 'derived', type_because: which,
          body_en: render('login_mysalam', 'en'), body_ar: render('login_mysalam', 'ar'),
          body_note: otpOn === false
            ? 'Setting.login_otp is OFF, so a token may have been issued without sending this SMS.'
            : 'Login OTP. It is a TOTP built by User#send_otp and sent straight to the SMS worker — no row is ever written, so this entry is derived from the sign-in tracking recorded in the same request.',
          recipient_mobile: u.mobile_number, recipient_note: null,
          confirmation_reference: null, device: [u.platform, u.app_version].filter(Boolean).join(' ') || null
        });
      }
    }
    out.rows.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  } catch (e) { out.notes.push('Login-OTP lookup failed: ' + e.message); }

  const n = out.rows.length;
  out.totals = {
    total: n,
    verified: out.rows.filter(r => r.status === 'verified').length,
    expired: out.rows.filter(r => r.status === 'expired-unverified').length,
    pending: out.rows.filter(r => r.status === 'awaiting-entry').length,
    login: out.rows.filter(r => r.status === 'sent-login').length,
    avg_verify_sec: (() => { const v = out.rows.filter(r => r.time_to_verify_sec != null).map(r => r.time_to_verify_sec);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })(),
    first: n ? out.rows[n - 1].sent_at : null, last: n ? out.rows[0].sent_at : null
  };

  /* Be explicit about the three tiers, because a customer's phone will always show more messages
   * than this list — and an operator who does not know why will distrust the whole panel. */
  out.coverage = [
    { kind: 'Stored OTPs (registration, change-plan, transfer…)', recorded: 'fully', how: 'one row per message in the otps table' },
    { kind: 'Login OTPs', recorded: 'derived', how: 'no row is ever written — User#send_otp sends a TOTP directly; the last two are reconstructed from the sign-in tracking' },
    { kind: 'Campaign, undertaking, billing and order SMS', recorded: 'not at all', how: 'sent fire-and-forget by Notifier::SmsWorker; the vendor portal is the only record' }
  ];
  out.notes.push('The customer\'s handset will show MORE messages than this list. Only stored OTPs are fully recorded; login OTPs are derived (last two only); campaign, undertaking and billing SMS leave no trace on our side at all.');
  if (!iprl.configured()) out.notes.push('IPRL_REDIS_URL is not set, so message types cannot be read even for OTPs sent in the last 10 minutes.');
  out.notes.push('Verification codes are never displayed — anyone holding one could complete the customer’s verification.');
  return out;
}

/* ------------------------------------------------------- recipient lists ---- */
/* Backs the clickable KPI tiles: one row per number, so "8,904 sent" becomes "who". */
async function recipients(bucket, { hours = 24, limit = 300 } = {}) {
  const h = Math.min(720, Math.max(1, Number(hours) || 24));
  const win = `created_at > now() - interval '${h} hours' AND delivery_method='sms'`;
  const B = {
    sent: '',
    verified: ' AND verified',
    unverified: ' AND NOT verified',
    storm: ''
  };
  if (!(bucket in B)) throw new Error(`unknown bucket: ${bucket}`);

  const sql = bucket === 'storm'
    ? `SELECT otp_for, count(*)::int n, count(*) FILTER (WHERE verified)::int verified,
              min(created_at) first_at, max(created_at) last_at
         FROM otps WHERE ${win} GROUP BY 1 HAVING count(*) >= 3
         ORDER BY n DESC, last_at DESC LIMIT $1`
    : `SELECT otp_for, count(*)::int n, count(*) FILTER (WHERE verified)::int verified,
              min(created_at) first_at, max(created_at) last_at
         FROM otps WHERE ${win}${B[bucket]} GROUP BY 1
         ORDER BY last_at DESC LIMIT $1`;
  const rows = (await db.source.query(sql, [Math.min(1000, limit)])).rows.map(r => ({
    ...r, verify_rate: r.n ? +(r.verified * 100 / r.n).toFixed(0) : null
  }));
  const label = { sent: 'received at least one OTP SMS', verified: 'verified at least one OTP',
    unverified: 'never entered the code', storm: 'received 3 or more OTPs (retry storm)' }[bucket];
  return { bucket, hours: h, label, count: rows.length, rows,
    note: bucket === 'storm'
      ? 'Three or more OTPs to the same number in the window. Usually non-delivery — the customer keeps asking for a new code because none arrived.'
      : 'Grouped by recipient. The list is capped; widen or narrow the window to change it.' };
}

module.exports = { search, recipients, templates, render, OTP_VALIDITY_SEC };
