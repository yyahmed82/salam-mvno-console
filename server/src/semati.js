/* Governance › Semati Clearance — release MSISDN + ID pairs on Semati (TCC) so the number can be sold again.
 *
 * WHAT IT REPLACES
 *   A bash loop on a TCS engineer's box: read `msisdn,personId,idType` lines, curl the Semati verify
 *   endpoint with requestType 4 for each, append the raw JSON to a CSV. The API key sat in the script,
 *   the national IDs sat in a text file, nobody could say afterwards who released what, and the
 *   outcome column was a raw JSON blob a human had to read. This page keeps the exact same call —
 *   same endpoint, same payload shape, same operator block — and wraps it in the console's rules.
 *
 * WHAT COMES BACK FROM SEMATI (from a 2,935-row production run, 19 Sep 2026)
 *   {"tcn":"<uuid>","code":600,"message":"success"}               → CLEARED
 *   {"tcn":"<uuid>","code":727,"message":"MOBILE_DOESNT_EXIST"}   → NOT CLEARED: the MSISDN is not
 *        registered under this ID on Semati. TCC does not say why — it is either already released,
 *        or the ID does not match the number. The console says exactly that, and does not guess.
 *   anything else with a code                                      → NOT CLEARED, with TCC's message
 *   715 / no JSON / HTTP ≥ 500 / timeout / DNS / TLS               → ERROR: not a verdict. Retry later.
 *
 * WHERE THE CALL IS MADE FROM
 *   152 has no internet. The hosts that already talk to Semati are the API hosts (the activation
 *   flow runs there) — so by default the request is issued ON one of them over the same SSH
 *   channel the log collectors and the SMS probe use (`curl` on the remote host, the JSON body
 *   piped over stdin so the API key never appears in that host's process list). `direct` transport
 *   exists for a host that does have egress, and for the local mock.
 *
 * WHAT IS STORED — the console keeps the outcome, not the customer.
 *   Jobs and rows go to unified_console with the identifiers MASKED (last 3 digits) plus a
 *   keyed hash of msisdn|personId, so "was this number cleared?" is answerable later without a
 *   national ID ever sitting in the console database. The full values live in process memory for
 *   SEMATI_CLEAR_RESULT_TTL_MIN (120) after the run, which is the window for downloading the result
 *   file. Every run, cancel, unmask and export is audited.
 *
 * ENV (all in /apps/unified/.env, never in code or settings)
 *   SEMATI_CLEAR_API_KEY            required — the TCC api key
 *   SEMATI_CLEAR_OPERATOR_JSON      required — the "operator" block as JSON (employeeId, employeeIdType,
 *                                   employeeUsername, sourceType, sourceId, region, operatorTCN, branchAddress)
 *   SEMATI_CLEAR_OPERATOR_JSON_MOBILE / _FIXED   optional per-business overrides of the block above
 *   SEMATI_CLEAR_URL                default https://semati.tcc-ict.com/TCC-Web/api-tcc/individual/v2/verify
 *   SEMATI_CLEAR_TRANSPORT          ssh (default when a host is known) | direct
 *   SEMATI_CLEAR_HOST               host that runs curl; default: first of API_LOG_HOSTS
 *   SEMATI_CLEAR_SSH_USER / _KEY    default API_LOG_USER / API_LOG_KEY
 *   SEMATI_CLEAR_TLS_INSECURE=1     required on this integration — TCC serves a SELF-SIGNED certificate on
 *                                   semati.tcc-ict.com (issuer == subject == O=Technology Control Company,
 *                                   OU=Semati), which is why the operations script carried `curl -k`
 *   SEMATI_CLEAR_TLS_PIN_SHA256     base64 SHA-256 of TCC's public key (SPKI). Set it and the chain is no
 *                                   longer trusted blindly: the exact key must match or the call fails —
 *                                   `curl --pinnedpubkey` on the ssh path, a socket check on the direct one.
 *                                   This is what makes -k safe; without it any box on the path could answer.
 *   SEMATI_CLEAR_REQUEST_TYPE (4) · SEMATI_CLEAR_MSISDN_TYPE (N) · SEMATI_CLEAR_TIMEOUT_S (20)
 *   SEMATI_CLEAR_DELAY_MS (250)     pause between rows — this is a national registry, not a load test
 *   SEMATI_CLEAR_MAX_ROWS (5000) · SEMATI_CLEAR_RESULT_TTL_MIN (120) · SEMATI_CLEAR_HASH_SECRET (pepper)
 */
'use strict';
const { spawn, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('./db');
const xlsx = require('./xlsx');

const env = process.env;
const DEFAULT_URL = 'https://semati.tcc-ict.com/TCC-Web/api-tcc/individual/v2/verify';
const BUSINESSES = ['mobile', 'fixed'];
const BIZ_LABEL = { mobile: 'Mobile (MVNO)', fixed: 'Fixed (5G home)' };

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }
function CFG() {
  const apiHosts = String(env.API_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const host = String(env.SEMATI_CLEAR_HOST || apiHosts[0] || '').trim();
  const t = String(env.SEMATI_CLEAR_TRANSPORT || (host ? 'ssh' : 'direct')).toLowerCase();
  return {
    url: String(env.SEMATI_CLEAR_URL || DEFAULT_URL).trim(),
    apiKey: String(env.SEMATI_CLEAR_API_KEY || '').trim(),
    transport: t === 'direct' ? 'direct' : 'ssh',
    host,
    sshUser: env.SEMATI_CLEAR_SSH_USER || env.API_LOG_USER || '',
    sshKey: env.SEMATI_CLEAR_SSH_KEY || env.API_LOG_KEY || '',
    insecure: /^(1|true|yes)$/i.test(String(env.SEMATI_CLEAR_TLS_INSECURE || '')),
    timeoutS: Math.min(120, Math.max(3, Number(env.SEMATI_CLEAR_TIMEOUT_S) || 20)),
    delayMs: Math.max(0, Number(env.SEMATI_CLEAR_DELAY_MS) || 250),
    msisdnType: String(env.SEMATI_CLEAR_MSISDN_TYPE || 'N'),
    requestType: Number(env.SEMATI_CLEAR_REQUEST_TYPE) || 4,
    resultTtlMin: Math.max(5, Number(env.SEMATI_CLEAR_RESULT_TTL_MIN) || 120),
    maxRows: Math.max(1, Number(env.SEMATI_CLEAR_MAX_ROWS) || 5000),
    pepper: String(env.SEMATI_CLEAR_HASH_SECRET || ''),
    pin: String(env.SEMATI_CLEAR_TLS_PIN_SHA256 || '').replace(/^sha256\/\//, '').trim()
  };
}
function operatorFor(business) {
  const b = String(business || '').toUpperCase();
  return safeJson(env['SEMATI_CLEAR_OPERATOR_JSON_' + b]) || safeJson(env.SEMATI_CLEAR_OPERATOR_JSON) || null;
}
function missing() {
  const c = CFG(); const m = [];
  if (!c.apiKey) m.push('SEMATI_CLEAR_API_KEY');
  if (!operatorFor('mobile') && !operatorFor('fixed')) m.push('SEMATI_CLEAR_OPERATOR_JSON');
  if (c.transport === 'ssh' && !c.host) m.push('SEMATI_CLEAR_HOST (or API_LOG_HOSTS)');
  if (c.transport === 'ssh' && !c.sshUser) m.push('SEMATI_CLEAR_SSH_USER (or API_LOG_USER)');
  return m;
}
const configured = () => missing().length === 0;

/* ---------- identifiers: normalise, validate, mask, hash ---------- */
const digits = s => String(s == null ? '' : s).replace(/[^\d]/g, '');
// Excel hands a 12-digit number back as 9.66181800001E11 — read it as a number first
function cellText(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(s) || /^\d+\.0+$/.test(s)) { const n = Number(s); if (Number.isFinite(n)) return String(Math.round(n)); }
  return s;
}
function normMsisdn(raw) {
  let d = digits(cellText(raw));
  if (!d) return null;
  if (d.startsWith('00966')) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 10) d = '966' + d.slice(1);
  else if (d.length === 9) d = '966' + d;
  return /^966\d{9}$/.test(d) ? d : null;
}
function normPerson(raw) { const d = digits(cellText(raw)); return /^\d{10}$/.test(d) ? d : null; }
// on Semati a national ID starts with 1 (idType 1) and an iqama with 2 (idType 2) — 2,935 of 2,935
// rows of the reference run agree, so a missing type is inferred and a contradicting one is flagged
function inferIdType(personId) { return personId && personId[0] === '1' ? 1 : personId && personId[0] === '2' ? 2 : null; }
function mask(v) { const s = String(v || ''); return s.length <= 3 ? '***' : '*'.repeat(s.length - 3) + s.slice(-3); }
function keyHash(msisdn, personId) { return crypto.createHmac('sha256', CFG().pepper || 'semati-clear').update(`${msisdn}|${personId}`).digest('hex'); }

/* ---------- input: pasted text or an uploaded file → candidate rows ---------- */
function parseText(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim(); if (!t) return;
    const parts = t.split(/[,;\t|]+|\s+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length || !/\d{4,}/.test(t)) return;            // a header or prose line has no digit run; a bad row still shows up as invalid
    out.push({ line: i + 1, msisdn: parts[0], personId: parts[1] || '', idType: parts[2] || '' });
  });
  return out;
}
function unzip(buf) {
  const SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(SIG); if (eocd < 0) throw new Error('not a .xlsx (zip) file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    entries[buf.toString('utf8', p + 46, p + 46 + nlen)] = { method, csize, lho };
    p += 46 + nlen + elen + clen;
  }
  const read = name => { const e = entries[name]; if (!e) return null;
    const q = e.lho, nlen = buf.readUInt16LE(q + 26), elen = buf.readUInt16LE(q + 28);
    const data = buf.subarray(q + 30 + nlen + elen, q + 30 + nlen + elen + e.csize);
    return e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data); };
  return { names: Object.keys(entries), read };
}
const unxml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tText = s => (String(s).match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<t[^>]*>|<\/t>/g, '')).join('');
function parseXlsx(buf) {
  const z = unzip(buf);
  const shared = []; const ssx = z.read('xl/sharedStrings.xml');
  if (ssx) { const re = /<si>([\s\S]*?)<\/si>/g; let m; const s = ssx.toString('utf8'); while ((m = re.exec(s))) shared.push(unxml(tText(m[1]))); }
  const sheet = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  if (!sheet) throw new Error('no worksheet in the workbook');
  const x = z.read(sheet).toString('utf8');
  const rows = []; const rre = /<row[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rre.exec(x))) {
    const cells = {}; const cre = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(rm[1]))) {
      const col = cm[1], attrs = cm[2] || '', inner = cm[3] || '';
      const t = /\bt="(\w+)"/.exec(attrs); let v = '';
      if (t && t[1] === 's') { const i = /<v>(\d+)<\/v>/.exec(inner); v = i ? (shared[Number(i[1])] || '') : ''; }
      else if (t && t[1] === 'inlineStr') v = unxml(tText(inner));
      else { const i = /<v>([\s\S]*?)<\/v>/.exec(inner); v = i ? unxml(i[1]) : ''; }
      cells[col] = v;
    }
    rows.push(cells);
  }
  return rows;
}
function rowsFromTable(table) {
  if (!table.length) return [];
  const first = table[0]; const cols = Object.keys(first).sort();
  const find = re => cols.find(c => re.test(String(first[c] || '')));
  let cM = find(/msisdn|mobile|number|phone|line/i), cP = find(/^(id|customer ?id|custid|person|national|iqama|identity)/i), cT = find(/type/i);
  let start = 0;
  if (cM || cP) { start = 1; cM = cM || cols[0]; cP = cP || cols.find(c => c !== cM) || cols[1]; }
  else { cM = 'A'; cP = 'B'; cT = 'C'; }
  const out = [];
  for (let i = start; i < table.length; i++) {
    const r = table[i]; const m = cellText(r[cM]); if (!/\d{4,}/.test(m + ' ' + cellText(r[cP]))) continue;   // skip only rows with no identifier at all
    out.push({ line: i + 1, msisdn: m, personId: cellText(r[cP]), idType: cT ? cellText(r[cT]) : '' });
  }
  return out;
}
function parseUpload(name, b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (/\.xlsx$/i.test(name || '') || (buf[0] === 0x50 && buf[1] === 0x4b)) return rowsFromTable(parseXlsx(buf));
  return parseText(buf.toString('utf8'));
}
/* validate + dedupe → what the operator confirms */
function prepare(candidates, maxRows) {
  const seen = new Set(); const rows = []; let invalid = 0, duplicates = 0;
  for (const c of candidates) {
    const msisdn = normMsisdn(c.msisdn), personId = normPerson(c.personId);
    const givenType = c.idType === '' || c.idType == null ? null : Number(digits(c.idType));
    const inferred = inferIdType(personId);
    const idType = givenType || inferred;
    const issues = [];
    if (!msisdn) issues.push('MSISDN is not a 966 number');
    if (!personId) issues.push('ID is not 10 digits');
    if (personId && !idType) issues.push('ID type unknown — give 1 (national ID) or 2 (iqama)');
    if (givenType && inferred && givenType !== inferred) issues.push(`ID starts with ${personId[0]} but type says ${givenType}`);
    const key = msisdn && personId ? `${msisdn}|${personId}` : null;
    const dup = key && seen.has(key);
    if (dup) duplicates++;
    if (issues.length) invalid++;
    if (key) seen.add(key);
    rows.push({ line: c.line, msisdn: msisdn || cellText(c.msisdn), personId: personId || cellText(c.personId), idType,
      ok: !issues.length && !dup, issue: dup ? 'duplicate of an earlier row' : issues.join(' · ') });
  }
  const valid = rows.filter(r => r.ok);
  return { rows, summary: { total: rows.length, valid: valid.length, invalid, duplicates, capped: valid.length > maxRows, maxRows } };
}

/* ---------- the call: same payload as the script, body over stdin, one row at a time ---------- */
function payload(row, business) {
  const c = CFG();
  return JSON.stringify({
    apiKey: c.apiKey, requestType: c.requestType,
    mobileNumber: { msisdn: row.msisdn, msisdnType: c.msisdnType },
    person: { personId: row.personId, IdType: Number(row.idType) },
    operator: operatorFor(business) || {}
  });
}
const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
/* Pin the server's public key. TCC's certificate is self-signed, so the CA chain proves nothing — but the KEY
 * is still theirs, and pinning it is what turns `-k` from "trust the network" back into "trust TCC". curl does
 * it natively; the direct path checks the SPKI on the socket, because Node skips checkServerIdentity entirely
 * when rejectUnauthorized is false. Unset = old behaviour, so this can be adopted without a flag day. */
const pinArg = c => (c.pin ? `--pinnedpubkey ${shq('sha256//' + c.pin)} ` : '');
const spkiOf = sock => { try { const cert = sock.getPeerCertificate(); return cert && cert.pubkey ? crypto.createHash('sha256').update(cert.pubkey).digest('base64') : null; } catch (_) { return null; } };
/* A pooled TLS socket handshakes once, so a pin checked only on 'secureConnect' is enforced on the FIRST call
 * and silently skipped on every reuse — which is worse than no pin at all, because it reads as protection.
 * Every request therefore gets its own connection (`agent: false`), and the check still covers the case where
 * a socket arrives already secured. Production goes through ssh+curl, one process per row, so this is the
 * dev/direct path only — but it has to be honest there too. */
function pinSocket(req, c) {
  if (!c.pin) return;
  let done = false;
  const check = sock => {
    if (done) return; done = true;
    const got = spkiOf(sock);
    if (got === c.pin) return;
    req.destroy(new Error(`pinned public key mismatch — SEMATI_CLEAR_TLS_PIN_SHA256 expects sha256//${c.pin}, the server presented sha256//${got || 'an unreadable key'}`));
  };
  req.on('socket', sock => {
    if (sock.encrypted && spkiOf(sock)) check(sock);          // already handshaked
    else sock.once('secureConnect', () => check(sock));
  });
}
function sshArgs(c) {
  const a = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.sshKey) a.push('-i', c.sshKey);
  a.push(c.sshUser ? `${c.sshUser}@${c.host}` : c.host);
  return a;
}
/* resolve → { http, body, ms, error } — never rejects; a transport failure is a result, not an exception */
function callSsh(body) {
  const c = CFG();
  // curl on the remote host; the JSON (with the api key) arrives on its stdin, so it is in no argv and no shell history
  const remote = `curl -sS -m ${c.timeoutS} ${c.insecure ? '-k ' : ''}${pinArg(c)}-X POST -H 'Accept: application/json' -H 'Content-Type: application/json' --data-binary @- -w '\\n%{http_code}' ${shq(c.url)} 2>&1`;
  return new Promise(resolve => {
    const t0 = Date.now(); let out = '', err = '', done = false;
    const fin = r => { if (!done) { done = true; resolve(Object.assign({ ms: Date.now() - t0 }, r)); } };
    let child;
    try { child = spawn('ssh', [...sshArgs(c), remote], { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return fin({ http: 0, body: '', error: e.message }); }
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} fin({ http: 0, body: '', error: `timeout after ${c.timeoutS + 15}s` }); }, (c.timeoutS + 15) * 1000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(killer); fin({ http: 0, body: '', error: e.message }); });
    child.on('close', code => {
      clearTimeout(killer);
      const m = /\n(\d{3})\s*$/.exec(out);
      if (!m) return fin({ http: 0, body: out.trim(), error: (err || out || `ssh exit ${code}`).trim().slice(0, 300) || 'no answer' });
      const http = Number(m[1]); const text = out.slice(0, m.index).trim();
      if (http === 0) return fin({ http: 0, body: '', error: (text || err || 'transport failure').slice(0, 300) });
      fin({ http, body: text, error: null });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}
function callDirect(body) {
  const c = CFG();
  return new Promise(resolve => {
    const t0 = Date.now(); let u;
    try { u = new URL(c.url); } catch (e) { return resolve({ http: 0, body: '', ms: 0, error: 'bad SEMATI_CLEAR_URL' }); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: 'POST', agent: false, timeout: c.timeoutS * 1000, rejectUnauthorized: !c.insecure,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', d => { text += d; });
      res.on('end', () => resolve({ http: res.statusCode || 0, body: text.trim(), ms: Date.now() - t0, error: null }));
    });
    pinSocket(req, c);
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${c.timeoutS}s`)); });
    req.on('error', e => resolve({ http: 0, body: '', ms: Date.now() - t0, error: String(e.message || e).slice(0, 300) }));
    req.end(body);
  });
}
const call = body => (CFG().transport === 'ssh' ? callSsh(body) : callDirect(body));

/* Turn the transport error into the next action. Measured from 172.31.43.17 on 19 Sep 2026:
 * `strict 000 — SSL certificate problem: self signed certificate`, `-k` a clean 405, and
 * `openssl s_client` showed issuer == subject == `O=Technology Control Company, OU=Semati,
 * CN=semati.tcc-ict.com`. So this is NOT an interception proxy — TCC serves a self-signed
 * certificate on its own production endpoint. There is no CA to install; the honest fix is to
 * skip chain validation and PIN their public key instead. Without this hint an operator reads a
 * raw curl string and has no idea which switch to reach for. */
const TLS_RE = /self[- ]signed|unable to get local issuer|certificate verify failed|SSL certificate problem|CERT_|DEPTH_ZERO|unable to verify/i;
function hintFor(err, insecure) {
  const e = String(err || ''); if (!e) return null;
  if (/pinned public key|--pinnedpubkey|\(90\)/i.test(e)) return 'The key Semati presented is NOT the one pinned in SEMATI_CLEAR_TLS_PIN_SHA256. Either TCC rotated their certificate — re-read the pin and update it — or something is answering in their place. Nothing was sent; do not clear the pin to make this go away without checking which.';
  if (TLS_RE.test(e)) return insecure
    ? 'The certificate still does not verify even with chain validation off — check SEMATI_CLEAR_URL and whether anything sits in front of that host.'
    : 'The certificate chain does not verify — TCC serves a SELF-SIGNED certificate on semati.tcc-ict.com, so there is no CA to install and this will never pass strict validation. Set SEMATI_CLEAR_TLS_INSECURE=1 in /apps/unified/.env (what the operations script did with curl -k) and pin their key with SEMATI_CLEAR_TLS_PIN_SHA256 so the hop is still verified. Nothing has been sent to Semati.';
  if (/Could not resolve host|Name or service not known|getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(e)) return 'DNS does not resolve that host name from there — check the resolver on the box making the call.';
  if (/Connection refused|No route to host|Network is unreachable|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE/i.test(e)) return 'That host cannot reach Semati — check its egress/firewall rule to TCC (152 itself has no internet, which is why the call is made from an API host).';
  if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|aborted/i.test(e)) return 'The request timed out. Semati is slow or the path is blocked — retry before reading anything into it.';
  if (/Permission denied|publickey|Host key|BatchMode/i.test(e)) return 'The SSH hop to the curl host failed — check SEMATI_CLEAR_SSH_USER / SEMATI_CLEAR_SSH_KEY (they default to API_LOG_USER / API_LOG_KEY) and that 152 can still reach that box.';
  return null;
}
/* reachability only — a GET with no body; ANY http answer proves DNS + route + TLS from that vantage point */
function probe() {
  const c = CFG();
  if (c.transport === 'ssh') {
    return new Promise(resolve => {
      if (!c.host) return resolve({ reachable: false, http: null, ms: null, error: 'no host configured', hint: 'Set SEMATI_CLEAR_HOST (or API_LOG_HOSTS) to the API host that should issue the request.' });
      const remote = `curl -sS -o /dev/null -m 8 ${c.insecure ? '-k ' : ''}${pinArg(c)}-w '%{http_code} %{time_total}' ${shq(c.url)} 2>&1 || true`;
      execFile('ssh', [...sshArgs(c), remote], { timeout: 20000, encoding: 'utf8' }, (err, stdout, stderr) => {
        const out = String(stdout || '').trim(); const m = /(\d{3})\s+([\d.]+)\s*$/.exec(out);
        if (m && m[1] !== '000') return resolve({ reachable: true, http: Number(m[1]), ms: Math.round(Number(m[2]) * 1000), error: null, hint: null });
        const e = (out.replace(/\s*000\s+[\d.]+\s*$/, '') || String(stderr || '') || (err && err.message) || 'transport failure').slice(0, 300);
        resolve({ reachable: false, http: null, ms: null, error: e, hint: hintFor(e, c.insecure) });
      });
    });
  }
  return new Promise(resolve => {
    let u; try { u = new URL(c.url); } catch (_) { return resolve({ reachable: false, http: null, ms: null, error: 'bad SEMATI_CLEAR_URL', hint: 'SEMATI_CLEAR_URL is not a URL.' }); }
    const t0 = Date.now(); const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: 'GET', agent: false, timeout: 8000, rejectUnauthorized: !c.insecure }, res => { res.resume(); resolve({ reachable: true, http: res.statusCode, ms: Date.now() - t0, error: null, hint: null }); });
    pinSocket(req, c);
    req.on('timeout', () => req.destroy(new Error('timeout after 8s')));
    req.on('error', e => { const t = String(e.message || e).slice(0, 300); resolve({ reachable: false, http: null, ms: Date.now() - t0, error: t, hint: hintFor(t, c.insecure) }); });
    req.end();
  });
}

/* ---------- what an answer means ---------- */
const CODES = {
  600: { status: 'cleared', reason: 'Released on Semati — the number is free to sell again.' },
  727: { status: 'not_cleared', reason: 'MOBILE_DOESNT_EXIST — this MSISDN is not registered under this ID on Semati: it was already released, or the ID does not match the number. Semati does not say which.' },
  715: { status: 'error', reason: 'TCC says "Service not available" (715) — the provider is down, not a verdict on this row. Retry later.' }
};
function classify(r) {
  if (r.error || !r.http) { const h = hintFor(r.error, CFG().insecure); return { status: 'error', code: null, message: null, tcn: null, reason: `No answer from Semati — ${r.error || 'transport failure'}.` + (h ? ' ' + h : '') }; }
  const j = safeJson(r.body);
  if (!j || typeof j !== 'object') return { status: 'error', code: null, message: null, tcn: null, reason: `HTTP ${r.http} without a JSON answer${r.body ? ': ' + r.body.slice(0, 120) : ''}.` };
  const code = Number(j.code != null ? j.code : j.responseCode); const message = String(j.message || j.responseMessage || '').slice(0, 200); const tcn = j.tcn ? String(j.tcn).slice(0, 64) : null;
  const known = CODES[code];
  if (known) return { status: known.status, code, message, tcn, reason: known.reason };
  if (r.http >= 500) return { status: 'error', code: Number.isFinite(code) ? code : null, message, tcn, reason: `HTTP ${r.http} from Semati${message ? ' — ' + message : ''}. Retry later.` };
  if (/success/i.test(message)) return { status: 'cleared', code, message, tcn, reason: `Semati answered "${message}" (code ${code}).` };
  return { status: 'not_cleared', code: Number.isFinite(code) ? code : null, message, tcn, reason: `Semati refused with code ${Number.isFinite(code) ? code : '?'}${message ? ' — ' + message : ''}.` };
}

/* ---------- persistence: the outcome, never the customer ---------- */
const C = () => db.console;
let ready = null;
function ensure() {
  if (!ready) ready = C().query(`
    CREATE TABLE IF NOT EXISTS semati_clear_jobs (
      id bigserial PRIMARY KEY, business text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz, finished_at timestamptz, status text NOT NULL DEFAULT 'queued',
      total int NOT NULL DEFAULT 0, cleared int NOT NULL DEFAULT 0, not_cleared int NOT NULL DEFAULT 0, errors int NOT NULL DEFAULT 0, cancelled int NOT NULL DEFAULT 0,
      source text, filename text, note text, transport text, host text);
    CREATE TABLE IF NOT EXISTS semati_clear_rows (
      id bigserial PRIMARY KEY, job_id bigint NOT NULL REFERENCES semati_clear_jobs(id) ON DELETE CASCADE, seq int NOT NULL,
      msisdn_masked text NOT NULL, person_masked text NOT NULL, id_type int, key_hash text NOT NULL,
      status text NOT NULL DEFAULT 'pending', code int, message text, tcn text, reason text, http int, ms int, processed_at timestamptz);
    CREATE INDEX IF NOT EXISTS idx_semati_rows_job ON semati_clear_rows (job_id, seq);
    CREATE INDEX IF NOT EXISTS idx_semati_rows_hash ON semati_clear_rows (key_hash);
    CREATE INDEX IF NOT EXISTS idx_semati_jobs_at ON semati_clear_jobs (created_at DESC);`).then(() => true).catch(e => { ready = null; throw e; });
  return ready;
}

/* ---------- the run: one job at a time, sequential rows, cancellable ---------- */
const JOBS = new Map();          // id → { id, business, rows: [{seq,msisdn,personId,idType}], status, cancel, createdBy, ttl }
let RUNNING = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function createJob({ business, rows, source, filename, note, actor }) {
  await ensure();
  const c = CFG();
  const j = (await C().query(
    `INSERT INTO semati_clear_jobs (business, created_by, status, total, source, filename, note, transport, host) VALUES ($1,$2,'queued',$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [business, actor, rows.length, source || 'paste', filename || null, note || null, c.transport, c.transport === 'ssh' ? c.host : 'direct'])).rows[0];
  const id = Number(j.id);
  for (let i = 0; i < rows.length; i += 500) {   // a 5,000-row list is ten statements, not one 30,000-parameter one
    const chunk = rows.slice(i, i + 500); const params = []; const values = [];
    chunk.forEach((r, k) => { const b = params.length;
      params.push(id, i + k + 1, mask(r.msisdn), mask(r.personId), r.idType, keyHash(r.msisdn, r.personId));
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`); });
    await C().query(`INSERT INTO semati_clear_rows (job_id, seq, msisdn_masked, person_masked, id_type, key_hash) VALUES ${values.join(',')}`, params);
  }
  const job = { id, business, rows: rows.map((r, i) => ({ seq: i + 1, msisdn: r.msisdn, personId: r.personId, idType: r.idType, status: 'pending' })),
    status: 'queued', cancel: false, createdBy: actor, createdAt: j.created_at, finishedAt: null, counts: { cleared: 0, not_cleared: 0, errors: 0, cancelled: 0, done: 0 } };
  JOBS.set(id, job);
  return job;
}
async function runJob(job) {
  const c = CFG();
  RUNNING = job.id; job.status = 'running';
  await C().query(`UPDATE semati_clear_jobs SET status='running', started_at=now() WHERE id=$1`, [job.id]);
  for (const row of job.rows) {
    if (job.cancel) { row.status = 'cancelled'; row.reason = 'Cancelled before it was sent.'; job.counts.cancelled++;
      await C().query(`UPDATE semati_clear_rows SET status='cancelled', reason=$3 WHERE job_id=$1 AND seq=$2`, [job.id, row.seq, row.reason]); continue; }
    const r = await call(payload(row, job.business));
    const v = classify(r);
    Object.assign(row, v, { http: r.http || null, ms: r.ms || null, processedAt: new Date().toISOString() });
    job.counts.done++; job.counts[v.status === 'error' ? 'errors' : v.status]++;
    await C().query(`UPDATE semati_clear_rows SET status=$3, code=$4, message=$5, tcn=$6, reason=$7, http=$8, ms=$9, processed_at=now() WHERE job_id=$1 AND seq=$2`,
      [job.id, row.seq, v.status, v.code, v.message, v.tcn, v.reason, r.http || null, r.ms || null]);
    await C().query(`UPDATE semati_clear_jobs SET cleared=$2, not_cleared=$3, errors=$4 WHERE id=$1`, [job.id, job.counts.cleared, job.counts.not_cleared, job.counts.errors]);
    if (c.delayMs) await sleep(c.delayMs);
  }
  job.status = job.cancel ? 'cancelled' : 'done'; job.finishedAt = new Date().toISOString();
  await C().query(`UPDATE semati_clear_jobs SET status=$2, finished_at=now(), cleared=$3, not_cleared=$4, errors=$5, cancelled=$6 WHERE id=$1`,
    [job.id, job.status, job.counts.cleared, job.counts.not_cleared, job.counts.errors, job.counts.cancelled]);
  RUNNING = null;
  // the full identifiers leave memory after the download window — only the masked rows in the DB remain
  job.ttl = setTimeout(() => { JOBS.delete(job.id); }, c.resultTtlMin * 60000); job.ttl.unref?.();
}

/* ---------- views: masked by default; full values only from memory, for the right caller, audited ---------- */
const ksa = v => v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false }).replace(',', '') : '';
function rowView(r, full) {
  return { seq: r.seq, msisdn: full ? r.msisdn : mask(r.msisdn), personId: full ? r.personId : mask(r.personId), idType: r.idType,
    status: r.status, code: r.code == null ? null : r.code, message: r.message || null, tcn: r.tcn || null, reason: r.reason || null,
    http: r.http || null, ms: r.ms || null, processedAt: r.processedAt || null };
}
function jobView(job, full) {
  return { id: job.id, business: job.business, businessLabel: BIZ_LABEL[job.business] || job.business, createdBy: job.createdBy, createdAt: job.createdAt,
    finishedAt: job.finishedAt, status: job.status, total: job.rows.length, counts: job.counts, inMemory: true, full: !!full,
    rows: job.rows.map(r => rowView(r, full)) };
}
async function jobFromDb(id) {
  await ensure();
  const j = (await C().query(`SELECT * FROM semati_clear_jobs WHERE id=$1`, [id])).rows[0]; if (!j) return null;
  const rows = (await C().query(`SELECT seq, msisdn_masked, person_masked, id_type, status, code, message, tcn, reason, http, ms, processed_at FROM semati_clear_rows WHERE job_id=$1 ORDER BY seq`, [id])).rows;
  return { id: Number(j.id), business: j.business, businessLabel: BIZ_LABEL[j.business] || j.business, createdBy: j.created_by, createdAt: j.created_at, finishedAt: j.finished_at,
    status: j.status, total: j.total, counts: { cleared: j.cleared, not_cleared: j.not_cleared, errors: j.errors, cancelled: j.cancelled, done: j.cleared + j.not_cleared + j.errors },
    inMemory: false, full: false, source: j.source, filename: j.filename, note: j.note, transport: j.transport, host: j.host,
    rows: rows.map(r => ({ seq: r.seq, msisdn: r.msisdn_masked, personId: r.person_masked, idType: r.id_type, status: r.status, code: r.code, message: r.message, tcn: r.tcn, reason: r.reason, http: r.http, ms: r.ms, processedAt: r.processed_at })) };
}
const STATUS_LABEL = { cleared: 'Cleared', not_cleared: 'Not cleared', error: 'Error — retry', cancelled: 'Cancelled', pending: 'Pending' };
function exportXlsx(view) {
  const rows = [['#', 'MSISDN', 'Customer ID', 'ID type', 'Status', 'Semati code', 'Semati message', 'Why', 'TCN', 'Processed (KSA)']];
  for (const r of view.rows) rows.push([r.seq, r.msisdn, r.personId, r.idType == null ? '' : r.idType, STATUS_LABEL[r.status] || r.status, r.code == null ? '' : r.code, r.message || '', r.reason || '', r.tcn || '', ksa(r.processedAt)]);
  const c = view.counts || {};
  const about = [['Field', 'Value'], ['Job', `#${view.id}`], ['Business', view.businessLabel], ['Run by', view.createdBy], ['Created (KSA)', ksa(view.createdAt)], ['Finished (KSA)', ksa(view.finishedAt)],
    ['Status', view.status], ['Rows', view.total], ['Cleared', c.cleared || 0], ['Not cleared', c.not_cleared || 0], ['Errors (retry)', c.errors || 0], ['Cancelled', c.cancelled || 0],
    ['Identifiers', view.full ? 'FULL — capability-verified and audited' : 'MASKED — the full values left the console after the download window'],
    ['Not cleared means', 'Semati code 727 MOBILE_DOESNT_EXIST: the MSISDN is not registered under this ID — already released, or the ID does not match. Semati does not say which.']];
  return xlsx.build([{ name: 'Clearance', rows, numericCols: [0, 3, 5], widths: [6, 16, 14, 8, 14, 12, 26, 60, 40, 20] }, { name: 'About', rows: about, widths: [22, 90] }]);
}

/* ---------- routes ---------- */
function mount(app, { requireView, requireCap, audit } = {}) {
  const gate = [requireView('governance'), requireCap('sematiClear')];
  const actorOf = req => String(req.sessionEmail || req.actor || 'console').toLowerCase();
  const scope = req => (req.business === 'mobile' || req.business === 'fixed') ? req.business : null;
  const bizOk = (req, b) => BUSINESSES.includes(b) && (!scope(req) || scope(req) === b);
  const canSeeFull = (req, job) => !!(req.caps && req.caps.unmaskPII) || (job && job.createdBy === actorOf(req));

  ensure().catch(e => console.error('[SEMATI] tables:', e.message));

  app.get('/api/semati/health', gate, async (req, res) => {
    const c = CFG(); const miss = missing();
    const p = miss.length ? { reachable: null, http: null, ms: null, error: null } : await probe();
    res.json({ configured: !miss.length, missing: miss, transport: c.transport, host: c.transport === 'ssh' ? c.host : null, sshUser: c.transport === 'ssh' ? c.sshUser : null,
      url: c.url, tlsInsecure: c.insecure, tlsPinned: !!c.pin, requestType: c.requestType, delayMs: c.delayMs, timeoutS: c.timeoutS, maxRows: c.maxRows, resultTtlMin: c.resultTtlMin,
      operator: { mobile: !!operatorFor('mobile'), fixed: !!operatorFor('fixed'), username: (operatorFor('mobile') || operatorFor('fixed') || {}).employeeUsername || null },
      running: RUNNING, probe: p, businesses: BUSINESSES.filter(b => bizOk(req, b)).map(b => ({ key: b, label: BIZ_LABEL[b] })) });
  });

  app.post('/api/semati/parse', gate, (req, res) => {
    try {
      const b = req.body || {}; const c = CFG();
      const candidates = b.file && b.file.b64 ? parseUpload(b.file.name, b.file.b64) : parseText(b.text);
      const out = prepare(candidates, c.maxRows);
      res.json(Object.assign(out, { source: b.file && b.file.b64 ? 'file' : 'paste', filename: b.file ? String(b.file.name || '').slice(0, 120) : null }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/semati/jobs', gate, async (req, res) => {
    try {
      const b = req.body || {}; const c = CFG(); const miss = missing();
      if (miss.length) return res.status(503).json({ error: `Semati clearance is not configured on this server — missing ${miss.join(', ')} in /apps/unified/.env.` });
      if (!bizOk(req, b.business)) return res.status(400).json({ error: 'business must be mobile or fixed, within your scope' });
      if (!operatorFor(b.business)) return res.status(503).json({ error: `No Semati operator block for ${BIZ_LABEL[b.business]} — set SEMATI_CLEAR_OPERATOR_JSON_${b.business.toUpperCase()} or SEMATI_CLEAR_OPERATOR_JSON.` });
      if (RUNNING) return res.status(409).json({ error: `A clearance run is already in progress (job #${RUNNING}). Wait for it to finish or cancel it.`, running: RUNNING });
      const prep = prepare(Array.isArray(b.rows) ? b.rows.map((r, i) => ({ line: i + 1, msisdn: r.msisdn, personId: r.personId, idType: r.idType })) : [], c.maxRows);
      const rows = prep.rows.filter(r => r.ok).slice(0, c.maxRows);
      if (!rows.length) return res.status(400).json({ error: 'No valid rows to send.' });
      const job = await createJob({ business: b.business, rows, source: b.source, filename: b.filename, note: b.note, actor: actorOf(req) });
      if (audit) await audit(req, 'semati.clear.start', `job:${job.id}`, { business: b.business, rows: rows.length, source: b.source || 'paste', filename: b.filename || null, transport: c.transport, host: c.transport === 'ssh' ? c.host : 'direct' });
      runJob(job).catch(async e => { job.status = 'failed'; job.finishedAt = new Date().toISOString(); RUNNING = null;
        try { await C().query(`UPDATE semati_clear_jobs SET status='failed', finished_at=now(), note=COALESCE(note,'') || $2 WHERE id=$1`, [job.id, ' · failed: ' + String(e.message).slice(0, 200)]); } catch (_) {} });
      res.json({ id: job.id, total: rows.length, skipped: prep.summary.total - rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/semati/jobs', gate, async (req, res) => {
    try {
      await ensure();
      const sc = scope(req); const lim = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const r = await C().query(`SELECT id, business, created_by, created_at, started_at, finished_at, status, total, cleared, not_cleared, errors, cancelled, source, filename, note, transport, host
        FROM semati_clear_jobs ${sc ? 'WHERE business=$2' : ''} ORDER BY id DESC LIMIT $1`, sc ? [lim, sc] : [lim]);
      res.json({ jobs: r.rows.map(j => ({ id: Number(j.id), business: j.business, businessLabel: BIZ_LABEL[j.business] || j.business, createdBy: j.created_by, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
        status: j.status, total: j.total, cleared: j.cleared, notCleared: j.not_cleared, errors: j.errors, cancelled: j.cancelled, source: j.source, filename: j.filename, note: j.note, transport: j.transport, host: j.host, inMemory: JOBS.has(Number(j.id)) })), running: RUNNING });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/semati/jobs/:id', gate, async (req, res) => {
    try {
      const id = Number(req.params.id); const wantFull = req.query.full === '1';
      const mem = JOBS.get(id);
      const view = mem ? jobView(mem, wantFull && canSeeFull(req, mem)) : await jobFromDb(id);
      if (!view) return res.status(404).json({ error: 'no such job' });
      if (!bizOk(req, view.business)) return res.status(403).json({ error: 'This run belongs to the other business.' });
      if (wantFull && !view.full) return res.status(mem ? 403 : 410).json({ error: mem ? 'Full identifiers need the Unmask PII capability, or the run must be yours.' : 'The full identifiers left the console after the download window — only the masked outcome is kept.' });
      if (wantFull && view.full && audit) await audit(req, 'pii.unmask', `semati:job:${id}`, { rows: view.rows.length });
      res.json(view);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/semati/jobs/:id/cancel', gate, async (req, res) => {
    const id = Number(req.params.id); const mem = JOBS.get(id);
    if (!mem) return res.status(404).json({ error: 'no running job with that id' });
    if (!bizOk(req, mem.business)) return res.status(403).json({ error: 'This run belongs to the other business.' });
    mem.cancel = true;
    if (audit) await audit(req, 'semati.clear.cancel', `job:${id}`, { done: mem.counts.done, total: mem.rows.length });
    res.json({ ok: true, id, status: mem.status });
  });

  app.get('/api/semati/jobs/:id/export', gate, async (req, res) => {
    try {
      const id = Number(req.params.id); const mem = JOBS.get(id);
      const full = !!(mem && canSeeFull(req, mem));
      const view = mem ? jobView(mem, full) : await jobFromDb(id);
      if (!view) return res.status(404).json({ error: 'no such job' });
      if (!bizOk(req, view.business)) return res.status(403).json({ error: 'This run belongs to the other business.' });
      if (audit) await audit(req, 'semati.export', `job:${id}`, { rows: view.rows.length, full });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="semati-clearance_${view.business}_job${id}_${stamp}${full ? '' : '_masked'}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(exportXlsx(view));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // "was this pair ever cleared?" — hashed lookup; the answer carries masked identifiers and the outcome only
  app.get('/api/semati/lookup', gate, async (req, res) => {
    try {
      await ensure();
      const msisdn = normMsisdn(req.query.msisdn), personId = normPerson(req.query.personId);
      if (!msisdn || !personId) return res.status(400).json({ error: 'Give a 966 MSISDN and a 10-digit ID.' });
      const sc = scope(req);
      const r = await C().query(`SELECT r.job_id, r.seq, r.msisdn_masked, r.person_masked, r.id_type, r.status, r.code, r.message, r.reason, r.processed_at, j.business, j.created_by
        FROM semati_clear_rows r JOIN semati_clear_jobs j ON j.id=r.job_id WHERE r.key_hash=$1 ${sc ? 'AND j.business=$2' : ''} ORDER BY r.processed_at DESC NULLS LAST LIMIT 20`, sc ? [keyHash(msisdn, personId), sc] : [keyHash(msisdn, personId)]);
      if (audit) await audit(req, 'semati.lookup', mask(msisdn), { hits: r.rows.length });
      res.json({ hits: r.rows.map(x => ({ job: Number(x.job_id), seq: x.seq, msisdn: x.msisdn_masked, personId: x.person_masked, idType: x.id_type, status: x.status, code: x.code, message: x.message, reason: x.reason, processedAt: x.processed_at, business: x.business, businessLabel: BIZ_LABEL[x.business], by: x.created_by })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mount, CFG, configured, missing, probe, classify, prepare, parseText, parseXlsx, parseUpload, rowsFromTable, normMsisdn, normPerson, inferIdType, mask, keyHash, payload, exportXlsx, createJob, runJob, JOBS, _call: call };
