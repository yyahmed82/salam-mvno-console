/* DEALER 360 — one dealer, everything, from the DMS system of record.
 *
 * SOURCE OF TRUTH is Clara (dms_v1 / trms_wallet / trms_commission / dms_audit_logs). The console
 * also holds the APP's view of the same dealer in the Postgres replica (`sellers`), and the two
 * are compared rather than one being discarded: a disagreement between two systems that should
 * agree is itself a finding. That pattern already paid off once with payments vs the UPG gateway,
 * where "declined" and "no answer" were indistinguishable until both sides were on screen.
 *
 * EVERY QUERY IS BUILT FROM COLUMNS THAT WERE PROBED FIRST (dmsDb.pick / selectList). We did not
 * write this schema, it has 128 tables in dms_v1 alone and visible inconsistencies
 * (`external_refrence`, `fpe_vlaue_type`, tables duplicated in different letter-cases). A missing
 * column yields a null and a reason, never a 500.
 *
 * COST DISCIPLINE — dms_audit_logs.user_onboarding_logs is 362 M rows / 46 GB. Nothing here
 * touches it. Activity comes from dms_v1.dms_sim_activation_report and the far smaller
 * dms_audit_logs.sim_activation_logs, always filtered by the dealer's own id and bounded by LIMIT.
 *
 * Read-only throughout.
 */
'use strict';

const D = require('./dmsDb');
const db = require('./db');

const SCH = { dms: 'dms_v1', wal: 'trms_wallet', com: 'trms_commission', aud: 'dms_audit_logs' };
const digits = s => String(s || '').replace(/\D/g, '');

/* ------------------------------------------------------------------ find ---- */
/* Accepts what an operator actually has to hand: dealer code, username, account number,
 * national id, contact number, the numeric id, or an MSISDN/ICCID seen on a commission row. */
async function find(qRaw) {
  const raw = String(qRaw || '').trim();
  if (!raw) return null;
  const have = await D.columnsOf(SCH.dms, 'dms_users');
  if (!have.size) throw new Error(`${SCH.dms}.dms_users is not visible to this account`);
  const col = c => have.has(c) ? c : null;

  const where = [], params = [];
  const add = (c, v) => { if (c) { where.push(`\`${c}\` = ?`); params.push(v); } };
  add(col('username'), raw);
  add(col('dealer_code'), raw);
  add(col('account_number'), raw);
  add(col('shop_code'), raw);
  add(col('terminal_id'), raw);
  if (/^\d+$/.test(raw)) add(col('id'), raw);
  if (/^[12]\d{9}$/.test(digits(raw))) { add(col('national_id'), digits(raw)); add(col('id_number'), digits(raw)); }
  const l9 = digits(raw).slice(-9);
  if (/^5\d{8}$/.test(l9)) for (const f of ['0' + l9, '966' + l9, l9]) add(col('contact_number'), f);
  if (!where.length) return null;

  const sel = await D.selectList(SCH.dms, 'dms_users', [
    'id', 'username', 'channel_id', 'account_number', 'dealer_code', 'dealer_type', 'shop_code',
    'first_name', 'last_name', 'contact_number', 'email_address', 'national_id', 'id_number',
    'status', 'user_type', 'role', 'partner', 'address', 'location_of_sales', 'geographical_area',
    'latitude', 'longitude', 'created_at', 'updated_at', 'created_by', 'reason_for_deactivation',
    'key_cloak_user_id', 'employee_id', 'employee_name', 'employee_type', 'owner_user', 'terminal_id',
    'min_topup_recharge', 'max_topup_recharge', 'min_recharge_limit', 'max_recharge_limit',
    'maximum_session', 'maximum_devices', 'device_registration', 'vpn_status', 'fingerprint',
    'iam_token', 'iam_otp', 'is_qr_enabled', 'login_without_qr_allowed', 'qr_scan_time',
    'absher_status', 'is_semati_nafat_bypass_enable',
    'free_numbers', 'golden_vanity_numbers', 'platinum_vanity_numbers', 'silver_numbers',
    'diamond_numbers', 'iuc_numbers']);
  const rows = await D.q(`SELECT ${sel} FROM \`${SCH.dms}\`.\`dms_users\` WHERE ${where.join(' OR ')} LIMIT 5`, params);
  return rows[0] || null;
}

/* --------------------------------------------------------------- sections ---- */
const bool = v => v == null ? null : !!(Number(v) || (Buffer.isBuffer(v) && v[0]) || v === true || v === '1');

async function sessions(u) {
  if (!(await D.hasTable(SCH.dms, 'dms_user_login_details'))) return { available: false, why: 'dms_user_login_details not visible' };
  const rows = await D.q(
    `SELECT id, login_time, logout_time FROM \`${SCH.dms}\`.\`dms_user_login_details\`
      WHERE user_id = ? ORDER BY login_time DESC LIMIT 25`, [u.id]);
  const withDur = rows.map(r => ({ ...r,
    minutes: (r.login_time && r.logout_time) ? Math.round((new Date(r.logout_time) - new Date(r.login_time)) / 60000) : null }));
  const last = withDur[0] || null;
  /* CORRECTION (first live run): a row with login_time and no logout_time was reported as
   * "open now" — and the sample dealer's newest login was 2 June with a null logout, i.e. an
   * "open session" 2.5 months long. That is not a session, it is a logout that was never
   * written. The claim "DMS records a logout so an unfinished row is genuinely open" was too
   * strong: the column exists, it is not always populated.
   * A session is only called open if it started recently enough to still plausibly be one. */
  const OPEN_MAX_H = Number(process.env.DMS_SESSION_OPEN_HOURS) || 18;
  const ageH = last && last.login_time ? (Date.now() - new Date(last.login_time).getTime()) / 3600e3 : null;
  const dangling = !!(last && last.login_time && !last.logout_time);
  const withLogout = withDur.filter(r => r.logout_time).length;
  return {
    available: true, rows: withDur, last_login: last && last.login_time, last_logout: last && last.logout_time,
    last_login_age_hours: ageH == null ? null : Math.round(ageH),
    open_now: dangling && ageH != null && ageH <= OPEN_MAX_H,
    dangling_no_logout: dangling && ageH != null && ageH > OPEN_MAX_H,
    logout_coverage: withDur.length ? `${withLogout}/${withDur.length} rows have a logout` : null,
    note: dangling && ageH > OPEN_MAX_H
      ? `Newest login is ${Math.round(ageH / 24)} days old with no logout recorded — treat that as a missing logout, not an open session.`
      : 'DMS has a logout_time column, but it is not always written; only a recent login without one is reported as open.'
  };
}

async function wallet(u) {
  const out = { available: false };
  if (!u.account_number) return { available: false, why: 'dealer has no account_number to join on' };
  if (await D.hasTable(SCH.wal, 'wallet_accounts')) {
    const sel = await D.selectList(SCH.wal, 'wallet_accounts',
      ['id', 'account_number', 'account_title', 'status', 'created_on', 'contact_number', 'email', 'external_refrence']);
    out.account = (await D.q(`SELECT ${sel} FROM \`${SCH.wal}\`.\`wallet_accounts\` WHERE account_number = ? LIMIT 1`, [u.account_number]))[0] || null;
    out.available = !!out.account;
  }
  /* The first live run returned a wallet_balance ROW whose `balance` came back null — because the
   * column is not called `balance`. selectList had substituted NULL for a name that does not
   * exist, which looks identical to "the dealer has no balance". So: pick the amount column from
   * the ones that plausibly hold it, and when none matches, RETURN THE ACTUAL COLUMN LIST rather
   * than a silent null — the next run then tells us the answer instead of failing the same way. */
  if (await D.hasTable(SCH.wal, 'wallet_balance')) {
    const acct = await D.pick(SCH.wal, 'wallet_balance', ['account_number', 'account_id', 'wallet_account_id']);
    const amt = await D.pick(SCH.wal, 'wallet_balance',
      ['balance', 'current_balance', 'available_balance', 'amount', 'wallet_balance', 'closing_balance', 'total_balance']);
    if (acct) {
      const extra = ['id', 'currency', 'updated_on', 'updated_at', 'status'];
      const sel = await D.selectList(SCH.wal, 'wallet_balance', amt ? [amt, ...extra] : extra);
      const row = (await D.q(`SELECT ${sel} FROM \`${SCH.wal}\`.\`wallet_balance\` WHERE \`${acct}\` = ? LIMIT 1`,
        [acct === 'account_number' ? u.account_number : (out.account && out.account.id)]))[0] || null;
      /* The amount arrives as a DECIMAL string, or occasionally a Buffer for a binary column, so
       * a bare Number() produced NaN on screen. Coerce explicitly and keep the raw value beside
       * it: a number we cannot parse must be shown as-is, never as NaN. */
      /* THE BALANCE IS ENCRYPTED AT REST. The first live render showed
       * "9VJPJ+XwJqgNou5d0ctT0w==" — valid base64 decoding to exactly 16 non-printable bytes,
       * i.e. one AES block. The application encrypts the wallet balance in the database.
       * So the console cannot show a figure, and must not pretend otherwise: printing the
       * ciphertext next to the word "balance" reads like a corrupted number rather than a
       * deliberate control. It is reported as encrypted, with the value withheld — we have no
       * key, and would not want one in this console even if it were offered. */
      if (row) {
        const rawAmt = amt ? row[amt] : null;
        const asStr = rawAmt == null ? null
          : (Buffer.isBuffer(rawAmt) ? rawAmt.toString('utf8').replace(/\0/g, '') : String(rawAmt));
        const asNum = asStr == null || asStr === '' ? null : Number(asStr);
        const looksEncrypted = asStr != null && !Number.isFinite(asNum)
          && /^[A-Za-z0-9+/]{16,}={0,2}$/.test(asStr.trim());
        out.balance = { ...row, amount_column: amt,
          amount: Number.isFinite(asNum) ? asNum : null,
          encrypted: looksEncrypted,
          amount_raw: (Number.isFinite(asNum) || looksEncrypted) ? undefined : asStr };
        if (looksEncrypted) out.balance_note =
          `trms_wallet.wallet_balance.${amt} is encrypted by the application (base64 ciphertext, 16-byte AES block). `
          + 'The console has no key and is not asking for one — wallet movements are shown instead of a figure.';
      }
      if (!amt) out.balance_note = 'No recognised amount column on trms_wallet.wallet_balance. Columns present: '
        + [...(await D.columnsOf(SCH.wal, 'wallet_balance'))].join(', ');
    } else out.balance_note = 'No account key on trms_wallet.wallet_balance. Columns present: '
      + [...(await D.columnsOf(SCH.wal, 'wallet_balance'))].join(', ');
  }
  // recent refills — small table, safe to scan by dealer
  if (await D.hasTable(SCH.aud, 'wallet_refill_logs')) {
    const who = await D.pick(SCH.aud, 'wallet_refill_logs', ['account_number', 'channel_user_id', 'user_id', 'channel_id']);
    const when = await D.pick(SCH.aud, 'wallet_refill_logs', ['created_on', 'created_at', 'created_date', 'insert_date_time']);
    if (who && when) {
      const sel = await D.selectList(SCH.aud, 'wallet_refill_logs', ['id', 'amount', 'status', 'reference', 'response_message', when]);
      const key = who === 'account_number' ? u.account_number : (who === 'channel_id' ? u.channel_id : u.id);
      out.refills = await D.q(
        `SELECT ${sel} FROM \`${SCH.aud}\`.\`wallet_refill_logs\` WHERE \`${who}\` = ? ORDER BY \`${when}\` DESC LIMIT 10`, [key]);
    }
  }
  return out;
}

/* THE MONEY QUESTION: earned vs actually paid out.
 * commission_history is the earned/paid ledger (wallet_transfered, pay_out, pay_out_date).
 * commission_queue is NOT a backlog — its fpe / recharge_1st..3rd columns are the PENDING
 * MILESTONE ledger per activation, i.e. commission not yet triggered. Reporting the queue as
 * "unpaid money" would overstate what the dealer is owed, so the two are kept separate. */
async function commission(u) {
  const out = { available: false };
  if (!(await D.hasTable(SCH.com, 'commission_history'))) return { available: false, why: 'trms_commission not visible' };
  const key = await D.pick(SCH.com, 'commission_history', ['channel_user_id', 'channel_id']);
  if (!key) return { available: false, why: 'no channel_user_id/channel_id on commission_history' };
  const val = key === 'channel_user_id' ? u.id : u.channel_id;
  const have = await D.columnsOf(SCH.com, 'commission_history');
  const amt = have.has('commission_amount') ? 'commission_amount' : null;
  if (!amt) return { available: false, why: 'no commission_amount column' };
  const paidExpr = have.has('pay_out_date') ? `pay_out_date IS NOT NULL`
    : have.has('pay_out') ? `pay_out IS NOT NULL AND pay_out <> ''` : null;

  const [tot] = await D.q(
    `SELECT count(*) n, sum(\`${amt}\`) earned,
            ${paidExpr ? `sum(CASE WHEN ${paidExpr} THEN \`${amt}\` ELSE 0 END)` : 'NULL'} paid,
            ${have.has('wallet_transfered_date') ? `sum(CASE WHEN wallet_transfered_date IS NOT NULL THEN \`${amt}\` ELSE 0 END)` : 'NULL'} to_wallet,
            min(created_on) first_at, max(created_on) last_at
       FROM \`${SCH.com}\`.\`commission_history\` WHERE \`${key}\` = ?`, [val]);
  const byMonth = have.has('commission_month') ? await D.q(
    `SELECT commission_month month, count(*) n, sum(\`${amt}\`) earned,
            ${paidExpr ? `sum(CASE WHEN ${paidExpr} THEN \`${amt}\` ELSE 0 END)` : 'NULL'} paid
       FROM \`${SCH.com}\`.\`commission_history\` WHERE \`${key}\` = ?
      GROUP BY commission_month ORDER BY commission_month DESC LIMIT 12`, [val]) : [];
  let pending = null;
  if (await D.hasTable(SCH.com, 'commission_queue')) {
    const qk = await D.pick(SCH.com, 'commission_queue', ['channel_user_id', 'channel_id']);
    if (qk) {
      const qv = qk === 'channel_user_id' ? u.id : u.channel_id;
      pending = (await D.q(`SELECT count(*) n, min(created_on) first_at, max(created_on) last_at
        FROM \`${SCH.com}\`.\`commission_queue\` WHERE \`${qk}\` = ?`, [qv]))[0];
    }
  }
  /* Distinguish "this schema has no pay_out column" from "this dealer has no commission rows" —
   * SUM() over zero rows is also NULL, and the first live run printed "no pay_out column" for a
   * dealer who simply had nothing yet. Same null, completely different meaning. */
  const n = Number(tot.n || 0);
  const earned = Number(tot.earned || 0);
  const paid = !paidExpr ? null : (n === 0 ? 0 : Number(tot.paid || 0));
  return { available: true, rows: n, earned, paid,
    paid_basis: !paidExpr ? 'no pay_out / pay_out_date column in this schema'
      : (n === 0 ? 'no commission rows for this dealer' : `pay_out recorded on ${paidExpr.split(' ')[0]}`),
    unpaid: paid == null ? null : earned - paid,
    to_wallet: tot.to_wallet == null ? null : Number(tot.to_wallet),
    first_at: tot.first_at, last_at: tot.last_at, by_month: byMonth,
    pending_milestones: pending ? { rows: Number(pending.n || 0), first_at: pending.first_at, last_at: pending.last_at } : null,
    note: 'Earned/paid come from commission_history. "Pending milestones" is commission_queue — activations whose recharge milestones have not fired yet, NOT money already owed.' };
}

async function stock(u) {
  const out = { available: false };
  if (!(await D.hasTable(SCH.dms, 'sim_inventory'))) return { available: false, why: 'sim_inventory not visible' };
  const sel = await D.selectList(SCH.dms, 'sim_inventory',
    ['id', 'start_range', 'end_range', 'channel_id', 'parent_id', 'received_by', 'received_on', 'sold_sims']);
  const rows = await D.q(`SELECT ${sel} FROM \`${SCH.dms}\`.\`sim_inventory\` WHERE channel_id = ? ORDER BY received_on DESC LIMIT 25`, [u.channel_id]);
  const total = rows.reduce((a, r) => a + (Number(r.end_range) - Number(r.start_range) + 1 || 0), 0);
  const sold = rows.reduce((a, r) => a + Number(r.sold_sims || 0), 0);
  return { available: true, ranges: rows, total_sims: total, sold, unsold: total - sold };
}

/* ACTIVITY — corrected after the column probe came back.
 * `dms_v1.dms_sim_activation_report` has only FOUR columns: id, username, channel, insert_date.
 * Despite the name and its 1.6 M rows it carries no MSISDN, ICCID or status — it is a record of
 * report REQUESTS (who asked, on which channel, when), not of activations. Presenting it as
 * "recent activations" would have been wrong, so it is reported under its true meaning.
 * The real activation detail lives in `dms_audit_logs.sim_activation_logs` (2.1 M rows, 1.3 GB),
 * which is what the dealer's activity is now read from. Both are probed, neither is assumed. */
async function activity(u) {
  const out = { available: false, activations: [] };
  const forms = [];
  const l9 = digits(u.contact_number).slice(-9);
  if (/^5\d{8}$/.test(l9)) forms.push('0' + l9, '966' + l9, l9);

  if (await D.hasTable(SCH.aud, 'sim_activation_logs')) {
    const key = await D.pick(SCH.aud, 'sim_activation_logs',
      ['channel_user_id', 'user_id', 'channel_id', 'channel', 'username', 'dealer_code', 'created_by']);
    const when = await D.pick(SCH.aud, 'sim_activation_logs',
      ['insert_date', 'created_on', 'created_at', 'created_date', 'activation_date', 'activated_time', 'insert_date_time']);
    if (key && when) {
      const sel = await D.selectList(SCH.aud, 'sim_activation_logs',
        ['id', 'mobile_number', 'msisdn', 'sim_iccid_number', 'iccid', 'status', 'response_code',
          'response_message', 'plan_name', 'region', when]);
      const val = key === 'channel_id' || key === 'channel' ? u.channel_id
        : key === 'username' ? u.username : key === 'dealer_code' ? u.dealer_code : u.id;
      out.activations = await D.q(
        `SELECT ${sel} FROM \`${SCH.aud}\`.\`sim_activation_logs\`
          WHERE \`${key}\` = ? ORDER BY \`${when}\` DESC LIMIT 25`, [val]);
      out.available = true; out.source = `${SCH.aud}.sim_activation_logs`; out.key_column = key; out.time_column = when;
    } else out.why = `sim_activation_logs has no recognised ${!key ? 'dealer key' : 'timestamp'} column. `
      + 'Columns present: ' + [...(await D.columnsOf(SCH.aud, 'sim_activation_logs'))].join(', ');
  } else out.why = 'dms_audit_logs.sim_activation_logs not visible to this account';

  // separately: how often this dealer pulled the activation report (a usage signal, not sales)
  if (await D.hasTable(SCH.dms, 'dms_sim_activation_report')) {
    const rk = await D.pick(SCH.dms, 'dms_sim_activation_report', ['username', 'channel', 'channel_user_id', 'user_id']);
    const rw = await D.pick(SCH.dms, 'dms_sim_activation_report', ['insert_date', 'created_at', 'created_on']);
    if (rk && rw) {
      const rv = rk === 'username' ? u.username : (rk === 'channel' ? u.channel_id : u.id);
      const r = await D.q(`SELECT count(*) n, max(\`${rw}\`) last_at FROM \`${SCH.dms}\`.\`dms_sim_activation_report\`
        WHERE \`${rk}\` = ?`, [rv]);
      out.report_pulls = { count: Number(r[0].n || 0), last_at: r[0].last_at,
        note: 'dms_sim_activation_report holds only id/username/channel/insert_date — it records who REQUESTED the activation report, not activations themselves.' };
    }
  }
  return out;
}

async function rights(u) {
  if (!(await D.hasTable(SCH.dms, 'dms_users_rights'))) return { available: false };
  const rows = await D.q(
    `SELECT count(*) n, sum(CASE WHEN is_active THEN 1 ELSE 0 END) active
       FROM \`${SCH.dms}\`.\`dms_users_rights\` WHERE channel_user_id = ?`, [u.id]);
  return { available: true, total: Number(rows[0].n || 0), active: Number(rows[0].active || 0) };
}

/* ------------------------------------------------- app-side view + drift ---- */
/* The Postgres replica's `sellers` row for the same person. Matching is deliberately conservative:
 * username or contact number only. A near-match on a name is not an identity. */
async function appSide(u) {
  const out = { found: false, mismatches: [] };
  try {
    const l9 = digits(u.contact_number).slice(-9);
    const forms = /^5\d{8}$/.test(l9) ? ['0' + l9, '966' + l9, '+966' + l9, l9] : [];
    const r = await db.source.query(
      `SELECT id, trim(first_name || ' ' || last_name) name, username, email, mobile_number,
              seller_type, "group", created_at
         FROM sellers
        WHERE ($1 <> '' AND username = $1) OR ($2::text[] <> '{}' AND mobile_number = ANY($2::text[]))
        LIMIT 2`, [u.username || '', forms]);
    if (!r.rows.length) {
      /* Do NOT present a miss as a finding until we know the two tables describe the same people.
       * The first live run missed on both sampled dealers, whose DMS usernames are `pos_0xxxxx`
       * POS-shop accounts — quite possibly a different population from the app's `sellers`
       * (Apollo/Tygo resellers). Measure the overlap once and say which case this is, instead of
       * implying the app has lost a dealer. */
      if (!appSide._overlap) {
        try {
          const o = await db.source.query(`SELECT count(*)::int n FROM sellers`);
          const sample = await D.q(`SELECT username FROM \`${SCH.dms}\`.\`dms_users\` LIMIT 200`);
          const names = sample.map(x => String(x.username || '')).filter(Boolean);
          const hit = names.length ? (await db.source.query(
            `SELECT count(*)::int n FROM sellers WHERE username = ANY($1::text[])`, [names])).rows[0].n : 0;
          appSide._overlap = { sellers: o.rows[0].n, sampled: names.length, matched: hit };
        } catch (_) { appSide._overlap = { error: true }; }
      }
      const ov = appSide._overlap;
      out.overlap = ov;
      out.note = (ov && !ov.error && ov.matched === 0)
        ? `No match — and none of ${ov.sampled} sampled DMS usernames appear in the app's ${ov.sellers} sellers either. These look like two different populations (DMS POS shops vs app resellers), not a missing dealer. A shared key needs to be agreed before drift can be measured.`
        : 'No matching row in the app-side sellers table for this dealer.';
      return out;
    }
    const s = r.rows[0];
    out.found = true; out.seller = s;
    const cmp = (label, dmsV, appV) => {
      const a = String(dmsV == null ? '' : dmsV).trim().toLowerCase();
      const b = String(appV == null ? '' : appV).trim().toLowerCase();
      if (a && b && a !== b) out.mismatches.push({ field: label, dms: dmsV, app: appV });
    };
    cmp('username', u.username, s.username);
    cmp('email', u.email_address, s.email);
    cmp('mobile', digits(u.contact_number).slice(-9), digits(s.mobile_number).slice(-9));
    cmp('type', u.dealer_type, s.seller_type);
  } catch (e) { out.error = e.message; }
  return out;
}

/* ------------------------------------------------------------------ main ---- */
async function dealer360(qRaw) {
  if (!D.configured()) return { ok: false, configured: false,
    error: 'DMS database not configured — set DMS_DB_URL (or OSB_LOG_URL, whose credential is reused against the MaxScale VIP).' };
  const u = await find(qRaw);
  if (!u) return { ok: true, found: false, query: String(qRaw || ''),
    note: 'No dealer matched. Try the dealer code, username, account number, terminal id, national id or contact number.' };

  const [ses, wal, com, stk, act, rts, app] = await Promise.all([
    sessions(u).catch(e => ({ available: false, error: e.message })),
    wallet(u).catch(e => ({ available: false, error: e.message })),
    commission(u).catch(e => ({ available: false, error: e.message })),
    stock(u).catch(e => ({ available: false, error: e.message })),
    activity(u).catch(e => ({ available: false, error: e.message })),
    rights(u).catch(e => ({ available: false, error: e.message })),
    appSide(u).catch(e => ({ found: false, error: e.message }))
  ]);

  return {
    ok: true, found: true, query: String(qRaw || ''),
    dealer: {
      id: u.id, channel_id: u.channel_id, username: u.username, dealer_code: u.dealer_code,
      dealer_type: u.dealer_type, shop_code: u.shop_code, terminal_id: u.terminal_id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.employee_name || null,
      contact_number: u.contact_number, email: u.email_address,
      national_id: u.national_id || u.id_number, status: u.status,
      user_type: u.user_type, role: u.role, partner: u.partner, owner_user: bool(u.owner_user),
      address: u.address, location_of_sales: u.location_of_sales, area: u.geographical_area,
      lat: u.latitude == null ? null : Number(u.latitude), lng: u.longitude == null ? null : Number(u.longitude),
      account_number: u.account_number, keycloak_id: u.key_cloak_user_id,
      created_at: u.created_at, updated_at: u.updated_at, created_by: u.created_by,
      deactivation_reason: u.reason_for_deactivation
    },
    /* The security block is the reason an operator opens this page during an incident: which
     * controls are relaxed for this dealer. Semati/Nafath bypass is called out because it turns
     * off an identity check the regulator requires. */
    security: {
      qr_enabled: bool(u.is_qr_enabled), login_without_qr: bool(u.login_without_qr_allowed),
      qr_scan_time: u.qr_scan_time, device_registration: bool(u.device_registration),
      max_devices: u.maximum_devices, max_sessions: u.maximum_session,
      vpn: bool(u.vpn_status), fingerprint: bool(u.fingerprint),
      iam_token: bool(u.iam_token), iam_otp: bool(u.iam_otp), absher: bool(u.absher_status),
      semati_nafath_bypass: bool(u.is_semati_nafat_bypass_enable),
      warnings: [
        bool(u.is_semati_nafat_bypass_enable) ? 'Semati/Nafath identity check is BYPASSED for this dealer.' : null,
        bool(u.login_without_qr_allowed) ? 'Login without QR is allowed.' : null,
        (u.maximum_devices != null && Number(u.maximum_devices) > 5) ? `Device limit is unusually high (${u.maximum_devices}).` : null
      ].filter(Boolean)
    },
    limits: { min_topup: u.min_topup_recharge, max_topup: u.max_topup_recharge,
      min_recharge: u.min_recharge_limit, max_recharge: u.max_recharge_limit },
    entitlements: { free: bool(u.free_numbers), golden: bool(u.golden_vanity_numbers),
      platinum: bool(u.platinum_vanity_numbers), silver: bool(u.silver_numbers),
      diamond: bool(u.diamond_numbers), iuc: bool(u.iuc_numbers) },
    rights: rts, sessions: ses, wallet: wal, commission: com, stock: stk, activity: act,
    app_side: app,
    source: { cluster: 'Clara MariaDB Galera (via MaxScale VIP)', schemas: SCH }
  };
}

module.exports = { dealer360, find };
