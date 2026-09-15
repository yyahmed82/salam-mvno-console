/* yakeenProbe.js — Yakeen / ELM synthetic probe (15 Sep 2026).
 *
 * WHY: on 14 Sep sales reported "problem in the system" at 17:45 KSA; it was ELM (Yakeen) unstable, confirmed by hand
 * in Postman, INC0027205, cleared 19:31. Nothing in the console could say "Yakeen is down" — the app log only shows
 * it once a customer fails. This probe calls the SAME four ELM endpoints the Postman collection holds, on a schedule
 * (default 10:00 / 16:00 / 22:00 KSA) and on demand from Troubleshoot, keeps every run in unified_console
 * (yakeen_probe_runs) and mails the result to the super admins (or a configured list).
 *
 * COST: every call is billed by ELM. Scheduled runs are the only automatic ones; manual runs are capped per day
 * (YAKEEN_PROBE_MANUAL_CAP, default 2). Nothing runs unless the credentials are in the env.
 *
 * FLOW (from Yakeen-api-collection.postman_collection.json, production folder):
 *   login  GET  /api/v2/yakeen/login      headers app-id, app-key, username, password, accept-language, service-identifier
 *          → bearer token (JWT, `exp` honoured; cached in memory until 60 s before expiry)
 *   data   GET  /api/v1/yakeen/data?nin=<nin>&dateString=<hijri yyyy-mm>        (Saudi national)
 *          GET  /api/v1/yakeen/data?iqama=<iqama>&birthDateG=<gregorian yyyy-mm> (expat)
 *          headers app-id, app-key, usage-code, operator-id, Authorization: Bearer <token>, accept-language,
 *          service-identifier = which SERVICE (info vs address) — the URL is the same for both.
 *   The four probes = info-national · address-national · info-expat · address-expat.
 *
 * PII: the probe subjects (a NIN and an Iqama with their dates) live in the env; the ELM response holds a real
 * person's record — it is NEVER stored or mailed. Per call the console keeps: http status, ms, class
 * (ok / business / technical), a masked one-line message, and which top-level keys came back.
 *
 * Env (all in /apps/unified/.env — never in the repo):
 *   YAKEEN_BASE=https://yakeencore.api.elm.sa
 *   YAKEEN_APP_ID  YAKEEN_APP_KEY  YAKEEN_USERNAME  YAKEEN_PASSWORD  YAKEEN_USAGE_CODE  YAKEEN_OPERATOR_ID
 *   YAKEEN_SVC_INFO_NAT  YAKEEN_SVC_ADDR_NAT  YAKEEN_SVC_INFO_EXPAT  YAKEEN_SVC_ADDR_EXPAT   (service-identifier UUIDs)
 *   YAKEEN_SVC_LOGIN (service-identifier used on login; default = YAKEEN_SVC_ADDR_EXPAT as in the collection)
 *   YAKEEN_PROBE_NIN  YAKEEN_PROBE_NIN_DOB (hijri yyyy-mm)  YAKEEN_PROBE_IQAMA  YAKEEN_PROBE_IQAMA_DOB (yyyy-mm)
 *   YAKEEN_PROBE_TIMES=10:00,16:00,22:00 (KSA)  YAKEEN_PROBE_MANUAL_CAP=2  YAKEEN_PROBE_TIMEOUT_MS=15000
 *   YAKEEN_PROBE_MAIL_TO=a@salam.sa,b@salam.sa   (default: every enabled console user whose role is super_admin)
 *   YAKEEN_PROBE_MAIL=1|0 (default 1) */
'use strict';
const db = require('./db');

const KSA = 3 * 3600e3;
const CFG = () => ({
  base: (process.env.YAKEEN_BASE || 'https://yakeencore.api.elm.sa').replace(/\/+$/, ''),
  appId: process.env.YAKEEN_APP_ID || '', appKey: process.env.YAKEEN_APP_KEY || '',
  user: process.env.YAKEEN_USERNAME || '', pass: process.env.YAKEEN_PASSWORD || '',
  usage: process.env.YAKEEN_USAGE_CODE || 'USC20001', operator: process.env.YAKEEN_OPERATOR_ID || '',
  svc: { infoNat: process.env.YAKEEN_SVC_INFO_NAT || '', addrNat: process.env.YAKEEN_SVC_ADDR_NAT || '',
    infoExpat: process.env.YAKEEN_SVC_INFO_EXPAT || '', addrExpat: process.env.YAKEEN_SVC_ADDR_EXPAT || '' },
  svcLogin: process.env.YAKEEN_SVC_LOGIN || process.env.YAKEEN_SVC_ADDR_EXPAT || '',
  nin: process.env.YAKEEN_PROBE_NIN || '', ninDob: process.env.YAKEEN_PROBE_NIN_DOB || '',
  iqama: process.env.YAKEEN_PROBE_IQAMA || '', iqamaDob: process.env.YAKEEN_PROBE_IQAMA_DOB || '',
  times: String(process.env.YAKEEN_PROBE_TIMES || '10:00,16:00,22:00').split(',').map(s => s.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t)).map(t => t.padStart(5, '0')),
  manualCap: Math.max(0, Number(process.env.YAKEEN_PROBE_MANUAL_CAP ?? 2)),
  timeoutMs: Math.max(3000, Number(process.env.YAKEEN_PROBE_TIMEOUT_MS) || 15000),
  mailTo: String(process.env.YAKEEN_PROBE_MAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean),
  mail: process.env.YAKEEN_PROBE_MAIL !== '0',
  /* TRANSPORT — 152 has no internet egress, so by default the calls are made FROM the Fixed app server (146, which
   * reaches ELM for the app itself) over the collector's ssh channel: `curl -K -` with the headers on STDIN (never
   * on a command line / in `ps`). YAKEEN_PROBE_VIA=direct forces fetch from this box (a lab with egress). */
  via: (process.env.YAKEEN_PROBE_VIA || (process.env.FIXED_LOG_HOSTS ? 'ssh' : 'direct')).toLowerCase(),
  sshHost: process.env.YAKEEN_PROBE_SSH_HOST || String(process.env.FIXED_LOG_HOSTS || '').split(',')[0].trim(),
  sshUser: process.env.FIXED_LOG_USER || process.env.API_LOG_USER || '', sshKey: process.env.FIXED_LOG_KEY || process.env.API_LOG_KEY || '',
  proxy: process.env.YAKEEN_PROBE_PROXY || '',   // optional http(s) proxy for curl on the ssh host
});
function configured() { const c = CFG(); return !!(c.appId && c.appKey && c.user && c.pass && (c.nin || c.iqama)); }
function missing() { const c = CFG(); const m = [];
  for (const [k, v] of [['YAKEEN_APP_ID', c.appId], ['YAKEEN_APP_KEY', c.appKey], ['YAKEEN_USERNAME', c.user], ['YAKEEN_PASSWORD', c.pass]]) if (!v) m.push(k);
  if (!c.nin && !c.iqama) m.push('YAKEEN_PROBE_NIN or YAKEEN_PROBE_IQAMA'); return m; }

const PROBES = [
  { key: 'info_national',    label: 'Yakeen info · national (NIN)',    svc: 'infoNat',   subject: 'nin' },
  { key: 'address_national', label: 'Yakeen address · national (NIN)', svc: 'addrNat',   subject: 'nin' },
  { key: 'info_expat',       label: 'Yakeen info · expat (Iqama)',     svc: 'infoExpat', subject: 'iqama' },
  { key: 'address_expat',    label: 'Yakeen address · expat (Iqama)',  svc: 'addrExpat', subject: 'iqama' },
];

const mask = s => String(s == null ? '' : s).replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2)).replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 2) + '*******' + m.slice(-2));
const short = (s, n) => mask(s).replace(/\s+/g, ' ').trim().slice(0, n);
const TECH_RE = /timed? ?out|timeout|gateway|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|TLS|certificate|unavailable|internal server error|<h1>|bad gateway|aborted/i;

async function hit(url, headers, timeoutMs) {
  const t0 = Date.now(); const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: ac.signal, redirect: 'manual' });
    const text = await r.text().catch(() => '');
    let body = null; try { body = JSON.parse(text); } catch (_) {}
    return { status: r.status, ms: Date.now() - t0, text, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: '', body: null, error: e.name === 'AbortError' ? `timeout ${timeoutMs} ms` : (e.message || 'connection error') };
  } finally { clearTimeout(to); }
}
/* the same request executed on the ssh host with curl; config (url + headers) goes through stdin */
function hitSsh(url, headers, timeoutMs) {
  const c = CFG(); const t0 = Date.now();
  const cfg = [`url = ${JSON.stringify(url)}`, `max-time = ${Math.ceil(timeoutMs / 1000)}`, 'silent', 'show-error', `write-out = "\\n__YK__ %{http_code} %{time_total}"`]
    .concat(c.proxy ? [`proxy = ${JSON.stringify(c.proxy)}`] : [])
    .concat(Object.entries(headers).map(([k, v]) => `header = ${JSON.stringify(k + ': ' + v)}`)).join('\n') + '\n';
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.sshKey) args.push('-i', c.sshKey);
  args.push(c.sshUser ? `${c.sshUser}@${c.sshHost}` : c.sshHost, 'curl -K -');
  return new Promise(resolve => {
    const { execFile } = require('child_process');
    const child = execFile('ssh', args, { timeout: timeoutMs + 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || ''); const m = out.match(/\n__YK__ (\d{3}) ([\d.]+)\s*$/);
      const text = m ? out.slice(0, m.index) : out;
      const status = m ? Number(m[1]) : 0; const ms = m ? Math.round(Number(m[2]) * 1000) : Date.now() - t0;
      let body = null; try { body = JSON.parse(text); } catch (_) {}
      if (!m || !status) return resolve({ status: 0, ms, text: '', body: null, error: (String(stderr || '').trim() || (err && err.message) || 'curl failed on ' + c.sshHost).slice(0, 200) });
      resolve({ status, ms, text, body });
    });
    child.stdin.on('error', () => {}); child.stdin.end(cfg);
  });
}
const doHit = (url, headers, timeoutMs) => CFG().via === 'ssh' ? hitSsh(url, headers, timeoutMs) : hit(url, headers, timeoutMs);
const deepFind = (o, keys, depth = 0) => { if (!o || typeof o !== 'object' || depth > 4) return null;
  for (const k of Object.keys(o)) { if (keys.includes(k.toLowerCase()) && typeof o[k] === 'string' && o[k].length > 20) return o[k]; }
  for (const k of Object.keys(o)) { const v = deepFind(o[k], keys, depth + 1); if (v) return v; } return null; };
const jwtExp = t => { try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64').toString('utf8')); return p && p.exp ? p.exp * 1000 : null; } catch (_) { return null; } };
const msgOf = r => { const b = r.body; if (b && typeof b === 'object') { const m = b.message || b.error || b.errorMessage || b.description || (b.errors && JSON.stringify(b.errors)); if (m) return typeof m === 'string' ? m : JSON.stringify(m); }
  return r.error || (r.text ? r.text.replace(/<[^>]+>/g, ' ') : `HTTP ${r.status}`); };
function classify(r) {
  if (r.status === 0) return 'technical';
  if (r.status >= 500) return 'technical';
  if (r.status >= 200 && r.status < 300 && !(r.body && typeof r.body === 'object' && (r.body.error || r.body.errorCode || r.body.errors))) return 'ok';
  if (TECH_RE.test(msgOf(r))) return 'technical';
  return 'business';
}

let _tok = { token: null, exp: 0 };
async function login(c, force) {
  if (!force && _tok.token && Date.now() < _tok.exp - 60000) return { ok: true, cached: true, ms: 0, status: 200 };
  const r = await doHit(`${c.base}/api/v2/yakeen/login`, { 'app-id': c.appId, 'app-key': c.appKey, 'username': c.user, 'password': c.pass, 'accept-language': 'EN', ...(c.svcLogin ? { 'service-identifier': c.svcLogin } : {}) }, c.timeoutMs);
  const token = deepFind(r.body, ['token', 'accesstoken', 'access_token', 'jwt', 'bearer', 'authorization']) || (r.body == null && /^eyJ/.test(r.text.trim()) ? r.text.trim() : null);
  if (r.status === 200 && token) { const exp = jwtExp(token); _tok = { token: token.replace(/^Bearer\s+/i, ''), exp: exp || (Date.now() + 20 * 60000) }; return { ok: true, cached: false, ms: r.ms, status: r.status, exp: new Date(_tok.exp).toISOString() }; }
  _tok = { token: null, exp: 0 };
  return { ok: false, cached: false, ms: r.ms, status: r.status, cls: classify(r), message: short(msgOf(r), 200) };
}

async function runOnce({ trigger = 'scheduled', actor = null, mailTo = null } = {}) {
  const c = CFG(); const startedAt = new Date();
  if (!configured()) throw Object.assign(new Error('Yakeen probe not configured: set ' + missing().join(', ') + ' in /apps/unified/.env'), { status: 409 });
  const lg = await login(c, false);
  const results = [];
  for (const p of PROBES) {
    const sid = c.svc[p.svc];
    if (!sid) { results.push({ key: p.key, label: p.label, skipped: true, cls: 'skipped', message: `service-identifier missing (${p.svc})`, status: null, ms: null }); continue; }
    if (!lg.ok) { results.push({ key: p.key, label: p.label, cls: 'technical', status: lg.status, ms: null, message: `login failed: ${lg.message || 'HTTP ' + lg.status}` }); continue; }
    const q = p.subject === 'nin' ? (c.nin ? `nin=${encodeURIComponent(c.nin)}&dateString=${encodeURIComponent(c.ninDob)}` : null)
                                  : (c.iqama ? `iqama=${encodeURIComponent(c.iqama)}&birthDateG=${encodeURIComponent(c.iqamaDob)}` : null);
    if (!q) { results.push({ key: p.key, label: p.label, skipped: true, cls: 'skipped', message: `no probe subject for ${p.subject}`, status: null, ms: null }); continue; }
    let r = await doHit(`${c.base}/api/v1/yakeen/data?${q}`, { 'app-id': c.appId, 'app-key': c.appKey, 'usage-code': c.usage, 'operator-id': c.operator, 'Authorization': `Bearer ${_tok.token}`, 'accept-language': 'EN', 'service-identifier': sid }, c.timeoutMs);
    if (r.status === 401 && lg.cached) { const again = await login(c, true); if (again.ok) r = await doHit(`${c.base}/api/v1/yakeen/data?${q}`, { 'app-id': c.appId, 'app-key': c.appKey, 'usage-code': c.usage, 'operator-id': c.operator, 'Authorization': `Bearer ${_tok.token}`, 'accept-language': 'EN', 'service-identifier': sid }, c.timeoutMs); }
    const cls = classify(r);
    results.push({ key: p.key, label: p.label, cls, status: r.status, ms: r.ms, message: cls === 'ok' ? 'answered' : short(msgOf(r), 200),
      keys: r.body && typeof r.body === 'object' ? Object.keys(r.body).slice(0, 12) : [] });
  }
  const okCount = results.filter(x => x.cls === 'ok').length, total = results.filter(x => !x.skipped).length;
  const transportDown = !lg.ok && (lg.status === 0);
  const verdict = !lg.ok ? (transportDown ? 'unreachable' : 'down') : okCount === total ? 'up' : results.some(x => x.cls === 'technical') ? 'degraded' : 'answering';
  const row = { run_at: startedAt.toISOString(), trigger, actor, verdict, ok_count: okCount, total, via: c.via === 'ssh' ? `ssh ${c.sshHost}` : 'direct', login: { ok: lg.ok, ms: lg.ms, status: lg.status, cached: lg.cached, message: lg.message || null, via: c.via === 'ssh' ? `ssh ${c.sshHost}` : 'direct' }, results };
  await ensureTable();
  const ins = await db.console.query(`INSERT INTO yakeen_probe_runs (run_at, trigger_kind, actor, verdict, ok_count, total, login, results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [row.run_at, trigger, actor, verdict, okCount, total, JSON.stringify(row.login), JSON.stringify(results)]);
  row.id = ins.rows[0].id;
  if (c.mail) { try { row.mailed_to = await mailRun(row, mailTo); await db.console.query(`UPDATE yakeen_probe_runs SET mailed_to=$2 WHERE id=$1`, [row.id, row.mailed_to]); } catch (e) { row.mail_error = e.message; } }
  console.log(`[YAKEEN-PROBE] ${trigger}${actor ? ' by ' + actor : ''}: ${verdict} · ${okCount}/${total} ok · login ${lg.ok ? 'ok' : 'FAILED'}`);
  return row;
}

async function mailRun(row, override) {
  const notify = require('./notify');
  const c = CFG();
  let to = Array.isArray(override) && override.length ? override : c.mailTo;
  if (!to.length) { try { const r = await db.console.query(`SELECT email FROM console_users WHERE enabled = true AND (role = 'super_admin' OR 'super_admin' = ANY(roles)) ORDER BY email`); to = r.rows.map(x => x.email); } catch (_) {} }
  if (!to.length) return [];
  const esc = notify.esc; const ksa = new Date(new Date(row.run_at).getTime() + KSA).toISOString().replace('T', ' ').slice(0, 16) + ' KSA';
  const color = row.verdict === 'up' ? '#1e5c44' : row.verdict === 'answering' ? '#2563eb' : row.verdict === 'unreachable' ? '#6b7280' : '#b91c1c';
  const rows = row.results.map(r => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px">${esc(r.label)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:${r.cls === 'ok' ? '#1e5c44' : r.cls === 'business' ? '#2563eb' : r.cls === 'skipped' ? '#6b7280' : '#b91c1c'}">${esc(r.cls.toUpperCase())}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px">${r.status == null ? '—' : esc(String(r.status))}${r.ms != null ? ` · ${r.ms} ms` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;color:#374151">${esc(r.message || '')}</td></tr>`).join('');
  const body = `<p style="font-family:Arial,sans-serif;font-size:13px;color:#111827;margin:0 0 12px">Run <b>${esc(ksa)}</b> · ${esc(row.trigger)}${row.actor ? ' by ' + esc(row.actor) : ''} · via ${esc(row.via || 'direct')} · login ${row.login.ok ? `ok (${row.login.cached ? 'cached token' : row.login.ms + ' ms'})` : `<b style="color:#b91c1c">FAILED</b> ${esc(row.login.message || '')}`}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${['API', 'Result', 'HTTP · time', 'Detail'].map(h => `<th align="left" style="padding:6px 8px;border-bottom:2px solid #d1d5db;font-family:Arial,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase">${h}</th>`).join('')}</tr>${rows}</table>
    ${row.verdict === 'unreachable' ? `<p style="font-family:Arial,sans-serif;font-size:12px;color:#b91c1c;margin:0 0 12px"><b>UNREACHABLE = the probe could not reach ELM from ${esc(row.via || 'the console')} — a transport / egress problem on our side, not an ELM answer.</b> ${esc(row.login.message || '')}</p>` : ''}<p style="font-family:Arial,sans-serif;font-size:11px;color:#6b7280;margin:14px 0 0">OK = ELM answered the record · BUSINESS = ELM answered with a refusal (inputs / record) — the service is reachable · TECHNICAL = timeout, 5xx or transport — the service is not answering. Every call is billed by ELM; scheduled ${esc(c.times.join(' / '))} KSA, manual runs capped at ${c.manualCap}/day. History: ${esc(notify.CONSOLE_URL || '')}#fixed?tab=errors</p>`;
  const html = notify.shell({ title: `Yakeen / ELM probe — ${row.verdict.toUpperCase()} · ${row.ok_count}/${row.total} ok`, pill: row.verdict.toUpperCase(), pillColor: color, bodyHtml: body });
  const subj = `[Salam Ops] Yakeen / ELM probe ${row.verdict.toUpperCase()} — ${row.ok_count}/${row.total} ok · ${ksa}`;
  await notify.sendHtml(to, subj, html);
  return to;
}

let _tableOk = false;
async function ensureTable() {
  if (_tableOk) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS yakeen_probe_runs (
    id bigserial PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now(), trigger_kind text NOT NULL, actor text,
    verdict text NOT NULL, ok_count int NOT NULL, total int NOT NULL, login jsonb NOT NULL DEFAULT '{}', results jsonb NOT NULL DEFAULT '[]', mailed_to text[]);
    CREATE INDEX IF NOT EXISTS idx_yakeen_probe_runs_at ON yakeen_probe_runs (run_at DESC);`);
  _tableOk = true;
}
const ksaDay = d => new Date(d.getTime() + KSA).toISOString().slice(0, 10);
async function manualUsedToday() {
  await ensureTable();
  const r = await db.console.query(`SELECT count(*)::int AS n FROM yakeen_probe_runs WHERE trigger_kind = 'manual' AND (run_at + interval '3 hours')::date = ((now() + interval '3 hours')::date)`);
  return r.rows[0].n;
}
async function history(limit = 30) {
  await ensureTable();
  const r = await db.console.query(`SELECT id, run_at, trigger_kind AS trigger, actor, verdict, ok_count, total, login, results, mailed_to FROM yakeen_probe_runs ORDER BY run_at DESC LIMIT $1`, [Math.min(200, Math.max(1, limit))]);
  return r.rows;
}
async function status() {
  const c = CFG(); let last = null, used = 0;
  try { last = (await history(1))[0] || null; used = await manualUsedToday(); } catch (_) {}
  return { configured: configured(), missing: configured() ? [] : missing(), via: c.via === 'ssh' ? `ssh ${c.sshUser}@${c.sshHost}` : 'direct', times: c.times, manualCap: c.manualCap, manualUsedToday: used, manualLeft: Math.max(0, c.manualCap - used),
    mailTo: c.mailTo.length ? c.mailTo : 'super admins', mail: c.mail, probes: PROBES.map(p => ({ key: p.key, label: p.label, ready: !!c.svc[p.svc] && !!(p.subject === 'nin' ? c.nin : c.iqama) })), last };
}

/* scheduler — once a minute, fire when KSA HH:MM is in the list and not already run for that slot today */
let _timer = null;
async function tick() {
  if (!configured()) return;
  const c = CFG(); const now = new Date(); const k = new Date(now.getTime() + KSA);
  const hhmm = k.toISOString().slice(11, 16); if (!c.times.includes(hhmm)) return;
  const slot = `${ksaDay(now)} ${hhmm}`;
  try {
    const r = await db.console.query(`SELECT value FROM console_settings WHERE key = 'yakeen_probe_last_slot'`);
    if (r.rowCount && r.rows[0].value && r.rows[0].value.slot === slot) return;
    await db.console.query(`INSERT INTO console_settings (key, value) VALUES ('yakeen_probe_last_slot', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ slot })]);
    await runOnce({ trigger: 'scheduled' });
  } catch (e) { console.error('[YAKEEN-PROBE] scheduled run failed: ' + e.message); }
}
function start() {
  if (!configured()) { console.log('[YAKEEN-PROBE] not configured (' + missing().join(', ') + ') — probe idle'); return { armed: false }; }
  _timer = setInterval(() => { tick().catch(() => {}); }, 60000); _timer.unref?.();
  console.log(`[YAKEEN-PROBE] armed — ${CFG().times.join(' / ')} KSA · manual cap ${CFG().manualCap}/day`);
  return { armed: true };
}

function mount(app, { requireView, audit } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/yakeen/probe/status', gate, async (req, res) => { try { res.json(await status()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/fixed/yakeen/probe/history', gate, async (req, res) => { try { res.json({ runs: await history(Number(req.query.limit) || 30) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/fixed/yakeen/probe/run', gate, async (req, res) => {
    try {
      const c = CFG(); const used = await manualUsedToday();
      if (used >= c.manualCap) return res.status(429).json({ error: `manual cap reached (${used}/${c.manualCap} today) — every call is billed by ELM; the next scheduled run is at ${c.times.join(' / ')} KSA` });
      const actor = (req.user && req.user.email) || req.get('X-Console-User') || null;
      const row = await runOnce({ trigger: 'manual', actor });
      if (audit) { try { audit(req, 'fixed.yakeen.probe', row.verdict, { id: row.id, ok: row.ok_count, total: row.total }); } catch (_) {} }
      res.json({ ...row, manualLeft: Math.max(0, c.manualCap - used - 1) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
module.exports = { mount, start, runOnce, status, history, configured, PROBES };

// CLI: node src/yakeenProbe.js --once   (manual run from the box; counts as a manual run)
if (require.main === module) {
  const ti = process.argv.indexOf('--to'); const mailTo = ti > 0 ? String(process.argv[ti + 1] || '').split(',').map(x => x.trim()).filter(Boolean) : null;
  runOnce({ trigger: 'manual', actor: 'cli', mailTo }).then(r => { console.log(JSON.stringify(r, null, 2)); return db.console.end(); })
    .catch(e => { console.error('probe failed:', e.message); process.exit(1); });
}
