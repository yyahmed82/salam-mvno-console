/* BULK WALLET BALANCE — "current balance for the users listed below", self-service.
 *
 * THE ASK (INC0027800, 17 Sep 2026, NPM → Operation Center → L1 → MVNO-MS-App-Digital-Chnls):
 * a partner mails a list of 40-odd dealer usernames (dis_011149, mtl_010765 …) and asks for their
 * current wallet balance. Today that is a P4 ticket, and the app team answers with a two-column
 * sheet (username · running_balance) built by hand. This module is that sheet, on demand.
 *
 * HOW THE APP TEAM GETS THE NUMBER — and why we cannot read it from the table:
 * trms_wallet.wallet_balance.current_balance is stored ENCRYPTED (jasypt PBEWithMD5AndTripleDES,
 * key on the wallet host — see trms_wallet_service cryptography/WalletBalanceCrypto, decompiled
 * 17 Sep 2026). The wallet service itself exposes the decrypt-and-list call the report is made
 * from: POST /was/account/decrypt {"account_no":[…]} → [{account_no, wallet_balance}] with the
 * balance already divided by 100 (SAR) and "" for accounts that are not ACTIVE / unknown
 * (AccountServiceImpl.getWalletBalanceByAccountNumberList). No key ever reaches the console.
 *
 * FLOW: usernames / dealer codes → dms_v1.dms_users (account_number, status) → wallet service
 * (direct HTTP to the APP nodes; if 152 cannot reach :9002, the same call is made from the node
 * itself over the console_ro SSH identity the log search already uses) → merged rows, with
 * wallet_accounts.status + wallet_balance.updated_on read from Clara for the "as of" column.
 *
 * Env: DMS_WALLET_URLS (comma list; default the 4 APP nodes on :9002/was) ·
 *      DMS_WALLET_SSH=0 disables the SSH fallback · DMSLOG_HOSTS / DMSLOG_SSH_USER / DMSLOG_SSH_KEY
 *      (shared with the log search) · DMS_WALLET_TIMEOUT_MS (8000 per attempt)
 * Read-only; balances are money, not PII — names beside them are masked by the route as usual. */
'use strict';
const http = require('http');
const { execFile } = require('child_process');
const D = require('./dmsDb');

const SCH = { dms: 'dms_v1', wal: 'trms_wallet' };
const MAX = 500;
const CFG = () => ({
  urls: String(process.env.DMS_WALLET_URLS || 'http://172.31.43.136:9002/was,http://172.31.43.137:9002/was,http://172.31.43.138:9002/was,http://172.31.43.139:9002/was')
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
  ssh: process.env.DMS_WALLET_SSH !== '0',
  hosts: String(process.env.DMSLOG_HOSTS || '172.31.43.136,172.31.43.137,172.31.43.138,172.31.43.139').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.DMSLOG_SSH_USER || 'console_ro',
  key: process.env.DMSLOG_SSH_KEY || '/root/.ssh/api_log_ed25519',
  timeoutMs: Number(process.env.DMS_WALLET_TIMEOUT_MS) || 8000
});

/* the pasted list: one per line / comma / space; usernames and dealer codes only (no free text
 * reaches SQL as anything but a bound parameter, but a sane charset keeps the IN() short) */
function parseList(raw) {
  const seen = new Set(); const keys = []; const rejected = [];
  String(raw || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).forEach(s => {
    const k = s.toLowerCase();
    if (!/^[a-z0-9_.@-]{2,64}$/i.test(k)) { rejected.push(s.slice(0, 40)); return; }
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  });
  return { keys: keys.slice(0, MAX), rejected, truncated: keys.length > MAX ? keys.length - MAX : 0 };
}

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('bad wallet url')); }
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'username': 'unified-console' }, timeout: timeoutMs },
      res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => {
        const txt = Buffer.concat(c).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${txt.slice(0, 160)}`));
        try { resolve(JSON.parse(txt)); } catch (e) { reject(new Error('non-JSON reply: ' + txt.slice(0, 120))); } }); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}
const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
function sshPost(host, path, body, timeoutMs) {
  const c = CFG();
  const cmd = `curl -s -m ${Math.ceil(timeoutMs / 1000)} -X POST http://127.0.0.1:9002${path} -H 'Content-Type: application/json' -H 'username: unified-console' -d ${shq(JSON.stringify(body))}`;
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-i', c.key, `${c.user}@${host}`, cmd];
  return new Promise((resolve, reject) => execFile('ssh', args, { timeout: timeoutMs + 6000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
    (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(String(stderr || err.message || 'ssh failed').trim().slice(0, 200)));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error('non-JSON reply via ssh: ' + String(stdout).slice(0, 120))); }
    }));
}

/* ask the wallet service; every transport is tried in order and the one that answered is named */
async function decrypt(accountNos) {
  const c = CFG(); const tried = [];
  if (!accountNos.length) return { rows: [], via: null, tried };
  for (const base of c.urls) {
    try { const r = await postJson(base + '/account/decrypt', { account_no: accountNos }, c.timeoutMs);
      return { rows: Array.isArray(r) ? r : [], via: base + '/account/decrypt', tried }; }
    catch (e) { tried.push({ via: base, error: e.message.slice(0, 160) }); if (/^HTTP 4\d\d/.test(e.message)) break; }
  }
  if (c.ssh) for (const h of c.hosts) {
    try { const r = await sshPost(h, '/was/account/decrypt', { account_no: accountNos }, c.timeoutMs);
      return { rows: Array.isArray(r) ? r : [], via: `ssh ${c.user}@${h} → 127.0.0.1:9002/was/account/decrypt`, tried }; }
    catch (e) { tried.push({ via: 'ssh ' + h, error: e.message.slice(0, 160) }); }
  }
  const err = new Error('wallet service unreachable from the console (' + tried.map(t => t.via + ': ' + t.error).join(' · ').slice(0, 600) + ')');
  err.tried = tried; throw err;
}

async function bulkBalance(raw) {
  const { keys, rejected, truncated } = parseList(raw);
  if (!keys.length) throw new Error('paste at least one username or dealer code');
  const have = await D.columnsOf(SCH.dms, 'dms_users');
  if (!have.size) throw new Error(`${SCH.dms}.dms_users is not visible to this account`);
  const col = c => have.has(c) ? c : null;
  const want = ['id', 'username', 'dealer_code', 'account_number', 'status', 'first_name', 'last_name', 'dealer_type', 'user_type', 'channel_id', 'shop_code', 'region', 'city'].filter(col);
  const sel = await D.selectList(SCH.dms, 'dms_users', want);
  const ph = keys.map(() => '?').join(',');
  const where = [`LOWER(username) IN (${ph})`, col('dealer_code') && `LOWER(dealer_code) IN (${ph})`].filter(Boolean).join(' OR ');
  const params = col('dealer_code') ? [...keys, ...keys] : keys;
  const users = await D.qSlow(`SELECT ${sel} FROM \`${SCH.dms}\`.\`dms_users\` WHERE ${where} LIMIT ${MAX * 2}`, params, 30000);

  /* one input key can be a username or a dealer code; keep the caller's order and spelling */
  const byKey = new Map();
  users.forEach(u => { [u.username, u.dealer_code].forEach(k => { if (k) { const kk = String(k).toLowerCase(); if (!byKey.has(kk)) byKey.set(kk, []); byKey.get(kk).push(u); } }); });
  const accts = [...new Set(users.map(u => u.account_number).filter(Boolean).map(String))];

  /* wallet-side status + last movement of the balance row (Clara, read-only) */
  const wal = new Map();
  if (accts.length && await D.hasTable(SCH.wal, 'wallet_accounts')) {
    const wb = await D.hasTable(SCH.wal, 'wallet_balance');
    const rows = await D.qSlow(`SELECT wa.account_number, wa.status${wb ? ', wb.updated_on' : ''} FROM \`${SCH.wal}\`.\`wallet_accounts\` wa`
      + (wb ? ` LEFT JOIN \`${SCH.wal}\`.\`wallet_balance\` wb ON wb.account_id = wa.id` : '')
      + ` WHERE wa.account_number IN (${accts.map(() => '?').join(',')})`, accts, 30000).catch(() => []);
    rows.forEach(r => wal.set(String(r.account_number), r));
  }

  let dec = { rows: [], via: null, tried: [] }, walletError = null;
  try { dec = await decrypt(accts); } catch (e) { walletError = e.message; dec.tried = e.tried || []; }
  const bal = new Map(dec.rows.map(r => [String(r.account_no), r.wallet_balance]));

  const out = []; const notFound = [];
  for (const k of keys) {
    const us = byKey.get(k);
    if (!us) { notFound.push(k); out.push({ input: k, found: false, note: 'no dms_users row with this username / dealer code' }); continue; }
    for (const u of us) {
      const w = u.account_number ? wal.get(String(u.account_number)) : null;
      const b = u.account_number ? bal.get(String(u.account_number)) : undefined;
      const num = b == null || b === '' ? null : Number(b);
      out.push({ input: k, found: true, username: u.username, dealer_code: u.dealer_code || null, account_number: u.account_number || null,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null, dealer_type: u.dealer_type || u.user_type || null,
        user_status: u.status == null ? null : String(u.status), wallet_status: w ? String(w.status) : null,
        balance_updated_on: w && w.updated_on ? new Date(w.updated_on).toISOString().replace('T', ' ').slice(0, 19) : null,
        running_balance: Number.isFinite(num) ? num : null,
        note: !u.account_number ? 'dealer has no wallet account_number' : walletError ? 'wallet service not reached' : b === undefined ? 'wallet service returned no entry for this account' : b === '' ? 'wallet account not ACTIVE or unknown to the wallet service' : null });
    }
  }
  const withBal = out.filter(r => r.running_balance != null);
  return { ok: true, asked: keys.length, rejected, truncated, found: out.filter(r => r.found).length, not_found: notFound,
    with_balance: withBal.length, total_balance: Number(withBal.reduce((s, r) => s + r.running_balance, 0).toFixed(2)),
    rows: out, wallet: { via: dec.via, error: walletError, tried: dec.tried, basis: 'trms_wallet_service POST /was/account/decrypt — current_balance ÷ 100 (SAR), decrypted by the wallet service itself; the console holds no key' },
    generated: new Date().toISOString() };
}

module.exports = { bulkBalance, parseList };
