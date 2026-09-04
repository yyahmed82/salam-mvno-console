#!/usr/bin/env node
/* DEALER 360 — command-line check, in-process.
 *
 * WHY THIS INSTEAD OF curl
 * Every /api/* route is behind a session gate (api.js OPEN_PATHS), so `curl localhost:4600/...`
 * answers "Not signed in." — correctly. These endpoints return dealer PII: name, mobile, national
 * id, wallet balance, commission. Adding them to OPEN_PATHS to make a smoke test convenient would
 * expose that to anything that can reach the port. So the test calls the module DIRECTLY instead:
 * it already requires shell access on 152, which is a stronger control than an HTTP session.
 *
 * Usage (from /apps/console/server, after `set -a; . ../.env; set +a`):
 *   node dealer-check.cjs --health              # can we reach the Clara cluster at all?
 *   node dealer-check.cjs <dealer code | username | account no | national id | 05…>
 *   node dealer-check.cjs <query> --json        # full payload
 *   node dealer-check.cjs --sample              # pick a real dealer automatically and show it
 *
 * Read-only. Prints masked identifiers by default (--unmask to see them in full).
 */
'use strict';
process.env.TZ = 'UTC';
process.env.STATIC_DIR = process.env.STATIC_DIR || require('path').join(__dirname, '..', 'web');

const args = process.argv.slice(2);
const has = f => args.includes(f);
const JSONOUT = has('--json');
const UNMASK = has('--unmask');
const query = args.filter(a => !a.startsWith('--'))[0] || '';

const mask = s => {
  if (UNMASK || s == null || s === '') return s;
  const t = String(s);
  return t.length <= 4 ? '***' : t.slice(0, 2) + '*'.repeat(Math.max(3, t.length - 5)) + t.slice(-3);
};
const money = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const line = (k, v) => console.log('  ' + String(k).padEnd(22) + (v == null || v === '' ? '—' : v));

(async () => {
  const D = require('../server/src/dmsDb.js');
  if (has('--health') || !query && !has('--sample')) {
    const p = await D.ping();
    console.log('\nDMS cluster health');
    if (!p.configured) { console.log('  ✗ not configured — set DMS_DB_URL, or OSB_LOG_URL to reuse its credential'); process.exit(2); }
    if (!p.ok) { console.log(`  ✗ ${p.error}  (target ${p.target})`); process.exit(1); }
    line('target', p.target); line('answered as', p.host); line('version', p.version); line('round trip', p.ms + ' ms');
    if (p.galera) { line('galera size', p.galera.wsrep_cluster_size); line('galera state', p.galera.wsrep_local_state_comment); }
    console.log('\n  (the VIP load-balances, so "answered as" may differ between runs — that is correct)');
    if (!query && !has('--sample')) { console.log('\n  Give a dealer code / username / national id / 05…, or --sample\n'); process.exit(0); }
  }

  let q = query;
  if (has('--sample')) {
    /* Pick a dealer with real HISTORY, not the most recently updated one — the first --sample
     * returned an account created the day before, with zero of everything, which exercises none
     * of the sections and tells you nothing about whether they work. Start from the commission
     * ledger so the sample is guaranteed to have money, and fall back only if that is empty. */
    let rows = await D.q(
      `SELECT u.dealer_code, u.username, count(*) n
         FROM \`trms_commission\`.\`commission_history\` c
         JOIN \`dms_v1\`.\`dms_users\` u ON u.id = c.channel_user_id
        GROUP BY u.dealer_code, u.username ORDER BY n DESC LIMIT 1`).catch(() => []);
    if (!rows.length) rows = await D.q(
      `SELECT dealer_code, username FROM \`dms_v1\`.\`dms_users\`
        WHERE dealer_code IS NOT NULL AND dealer_code <> '' AND status = 'Active'
        ORDER BY updated_at DESC LIMIT 1`);
    if (!rows.length) { console.log('no dealer found to sample'); process.exit(1); }
    q = rows[0].dealer_code || rows[0].username;
    console.log(`\n(sample dealer: ${mask(q)}${rows[0].n ? ` · ${rows[0].n} commission rows` : ''})`);
  }

  const out = await require('../server/src/dealer360.js').dealer360(q);
  if (JSONOUT) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
  if (!out.ok) { console.log('\n✗ ' + out.error); process.exit(1); }
  if (!out.found) { console.log('\nNo dealer matched "' + q + '".\n' + out.note); process.exit(0); }

  const d = out.dealer, s = out.security, c = out.commission, w = out.wallet, st = out.stock, se = out.sessions;
  console.log('\n' + '='.repeat(64));
  console.log(`DEALER 360 · ${mask(d.name) || d.username} · code ${d.dealer_code || '—'}`);
  console.log('='.repeat(64));
  console.log('\nPROFILE');
  line('id / channel_id', `${d.id} / ${d.channel_id}`);
  line('username', d.username); line('type', d.dealer_type); line('status', d.status);
  line('shop / terminal', `${d.shop_code || '—'} / ${d.terminal_id || '—'}`);
  line('contact', mask(d.contact_number)); line('national id', mask(d.national_id));
  line('area', d.area || d.location_of_sales); line('lat,lng', d.lat != null ? `${d.lat}, ${d.lng}` : null);
  line('created', d.created_at); line('wallet account', mask(d.account_number));
  if (d.deactivation_reason) line('deactivated', d.deactivation_reason);

  console.log('\nSECURITY');
  line('QR', `${s.qr_enabled ? 'on' : 'off'}${s.login_without_qr ? ' · login WITHOUT QR allowed' : ''}`);
  line('devices', `${s.device_registration ? 'registration on' : 'registration off'} · max ${s.max_devices ?? '—'}`);
  line('sessions max', s.max_sessions);
  line('vpn / fingerprint', `${s.vpn ? 'on' : 'off'} / ${s.fingerprint ? 'on' : 'off'}`);
  line('IAM token / OTP', `${s.iam_token ? 'on' : 'off'} / ${s.iam_otp ? 'on' : 'off'}`);
  line('Semati/Nafath', s.semati_nafath_bypass ? '⚠ BYPASSED' : 'enforced');
  (s.warnings || []).forEach(x => console.log('  ⚠ ' + x));

  console.log('\nSESSIONS');
  if (!se.available) line('', se.why || se.error || 'not available');
  else { line('last login', se.last_login); line('last logout', se.last_logout);
    line('open now', se.open_now ? 'YES' : (se.dangling_no_logout ? 'no — logout never written' : 'no'));
    line('logout coverage', se.logout_coverage); line('rows', (se.rows || []).length);
    if (se.dangling_no_logout) console.log('  ⚠ ' + se.note); }

  console.log('\nWALLET');
  if (!w.available) line('', w.why || w.error || 'not available');
  else { line('account', w.account ? `${mask(w.account.account_number)} · ${w.account.status}` : '—');
    line('balance', w.balance ? (w.balance.amount != null ? money(w.balance.amount) + (w.balance.amount_column ? ` (${w.balance.amount_column})` : '')
      : (w.balance.amount_raw != null ? 'raw: ' + w.balance.amount_raw : '—')) : '—');
    if (w.balance_note) console.log('  ⚠ ' + w.balance_note);
    line('recent refills', (w.refills || []).length); }

  console.log('\nCOMMISSION');
  if (!c.available) line('', c.why || c.error || 'not available');
  else {
    line('rows', money(c.rows)); line('earned', money(c.earned));
    line('paid out', c.paid == null ? '—' : money(c.paid));
    line('paid basis', c.paid_basis);
    line('UNPAID', c.unpaid == null ? '—' : money(c.unpaid));
    line('to wallet', c.to_wallet == null ? '—' : money(c.to_wallet));
    line('pending milestones', c.pending_milestones ? money(c.pending_milestones.rows) + ' (NOT money owed)' : '—');
    (c.by_month || []).slice(0, 6).forEach(m =>
      console.log(`    ${String(m.month).padEnd(10)} earned ${String(money(m.earned)).padStart(12)}  paid ${String(money(m.paid)).padStart(12)}`));
  }

  console.log('\nSTOCK');
  if (!st.available) line('', st.why || st.error || 'not available');
  else { line('ranges', (st.ranges || []).length); line('total sims', money(st.total_sims));
    line('sold / unsold', `${money(st.sold)} / ${money(st.unsold)}`); }

  console.log('\nACTIVITY');
  if (out.activity.available) { line('recent activations', (out.activity.activations || []).length);
    line('source', out.activity.source + ' via ' + out.activity.key_column); }
  else console.log('  ⚠ ' + (out.activity.why || 'not available'));
  if (out.activity.report_pulls) line('report pulls', out.activity.report_pulls.count
    + (out.activity.report_pulls.last_at ? ' · last ' + out.activity.report_pulls.last_at : '') + '  (report requests, NOT sales)');

  console.log('\nAPP-SIDE (Postgres sellers)');
  if (!out.app_side.found) line('', out.app_side.note || out.app_side.error || 'no match');
  else {
    line('seller id', out.app_side.seller.id);
    if (!out.app_side.mismatches.length) line('agreement', '✓ fields match');
    else out.app_side.mismatches.forEach(m => console.log(`  ⚠ ${m.field}: DMS "${mask(m.dms)}" vs app "${mask(m.app)}"`));
  }
  console.log('\n(identifiers masked — add --unmask to see them in full)\n');
  process.exit(0);
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
