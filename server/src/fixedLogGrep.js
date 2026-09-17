/* FIXED APP-LOG GREP — "show me everything the log has about this" for Fixed › Troubleshoot (17 Sep 2026).
 *
 * WHY. The error board reads the sda_ops read models and the app-log lane reads fixed_app_events — both keep
 * only FAILED steps, and only the fields the collector parses. So a customer id that an L2 engineer finds in
 * one `grep -rn '1054887433' /app/log/sda/combined.log` on RUH-App-P01 answers "No errors in this window" on
 * the console. This module is that grep, run from the console: ANY free-text term, matched against the WHOLE
 * winston line (every field — msisdn, iccid, imsi, custCode, custID, personId, dealerId, operatorTCN, requestId,
 * staffId, order no, plate, an error phrase …), returning SUCCESSES AND FAILURES with their request / response
 * bodies, grouped into the journey the requestId stitches together.
 *
 * It is ADDITIVE. The collector (fixedAppLogCollector), fixed_app_events, the lane and the board are untouched;
 * nothing here writes to the database. Same host / identity / path as the collector: FIXED_LOG_HOSTS (146),
 * FIXED_LOG_USER/KEY (console_ro + api_log_ed25519), FIXED_LOG_PATH (/app/log/sda/combined.log).
 *
 * PROD-SAFETY RULES (146 is the live Fixed app node — same rules as dmsLogGrep):
 *  · EXPLICIT ACTION ONLY. A person presses Search. Never on a timer, never from the board's auto-refresh.
 *  · STAGED. Default touches ONLY the current combined.log. Rotated / .gz siblings are searched only when the
 *    operator asks for them (deep=1) — under `nice -n 19` + ionice, one hard remote `timeout`.
 *  · BOUNDED EVERYWHERE: remote timeout < nginx's 60 s, per-file line cap, per-line cut, total byte cap,
 *    ssh maxBuffer. Errors travel with results (per-host `error` field — house rule).
 *  · CREDENTIALS MASKED AT SOURCE, before anything crosses the wire: Nafath iamAppToken JWTs, apiKey values,
 *    "password" values, SOAP wsse:Password. Those are secrets, not data.
 *  · CUSTOMER DATA IS NOT MASKED — the same decision as the DMS log grep (Yosri, 3 Sep): Troubleshoot is
 *    L2-gated, L2 reads this exact file raw on the node, and masking here only slows a live case down. The
 *    route is gated on the `fixed` view and EVERY search is written to the audit log with the term.
 *  · The term never reaches the remote shell as text: it is base64'd here and decoded into a variable there,
 *    so no quote / metacharacter / newline can escape. grep -F by default; grep -E only when asked.
 *
 * Env: FIXED_GREP=0 disables · FIXED_GREP_REMOTE_SECS (50) · FIXED_GREP_TIMEOUT_MS (56000)
 *      FIXED_GREP_MAX_LINES (1000 hard cap) · FIXED_GREP_CAP_MB (3) · plus the collector's FIXED_LOG_* vars. */
'use strict';
const { execFile } = require('child_process');
const crypto = require('crypto');
const MB = 1024 * 1024;
const col = require('./fixedAppLogCollector');

const CFG = () => {
  const c = col.CFG();
  return {
    enabled: process.env.FIXED_GREP !== '0',
    hosts: c.hosts, user: c.user, key: c.key, path: c.path,
    remoteSecs: Number(process.env.FIXED_GREP_REMOTE_SECS) || 50,
    timeoutMs: Number(process.env.FIXED_GREP_TIMEOUT_MS) || 56000,
    maxLines: Math.max(20, Number(process.env.FIXED_GREP_MAX_LINES) || 1000),
    capBytes: Math.max(1, Number(process.env.FIXED_GREP_CAP_MB) || 3) * MB
  };
};
const configured = () => { const c = CFG(); return c.enabled && c.hosts.length > 0; };

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
/* the rotated siblings of the configured file: combined.log → /app/log/sda/combined*.log* */
function globs(p) {
  const i = p.lastIndexOf('/');
  const dir = i > 0 ? p.slice(0, i) : '.', base = p.slice(i + 1).replace(/\.log$/, '');
  return `${dir}/${base}*.log*`;
}

const MASK_SED = `sed -e 's/eyJ[A-Za-z0-9_.\\-]\\{20,\\}/***JWT***/g' ` +
  `-e 's/"iamAppToken" *: *"[^"]*"/"iamAppToken":"***"/g' ` +
  `-e 's/"apiKey" *: *"[^"]*"/"apiKey":"***"/g' ` +
  `-e 's/"password" *: *"[^"]*"/"password":"***"/g' ` +
  `-e 's/"authorization" *: *"[^"]*"/"authorization":"***"/g' ` +
  `-e 's/<wsse:Password[^>]*>[^<]*<\\/wsse:Password>/<wsse:Password>***<\\/wsse:Password>/g'`;

/* One remote script. TERM and FILES travel base64-encoded and are decoded into exported variables, so the
 * remote shell never parses operator text. `tail -N` per file = the NEWEST matches (the log is append-ordered). */
function remoteScript(term, { deep, limit, regex }) {
  const c = CFG();
  const files = deep ? globs(c.path) : c.path;
  const FLAG = regex ? '-E' : '-F';
  /* `timeout`, `ionice` and `zgrep` are all probed, never assumed: a missing one must degrade (no cap /
   * no niceness / plain grep on the uncompressed file), never make the search silently return nothing. */
  return `T=$(printf %s '${b64(term)}' | base64 -d); F=$(printf %s '${b64(files)}' | base64 -d); export T F LC_ALL=C; ` +
    `TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout ${c.remoteSecs}"; $TO sh -c '
NI="nice -n 19"; command -v ionice >/dev/null 2>&1 && NI="ionice -c3 nice -n 19"
G="zgrep"; command -v zgrep >/dev/null 2>&1 || G="grep"
for f in $F; do
  [ -f "$f" ] || continue
  c=$($NI $G -c ${FLAG} -e "$T" "$f" 2>/dev/null); [ "\${c:-0}" -gt 0 ] || continue
  echo "@@FILE $f $c"
  $NI $G -h ${FLAG} -e "$T" "$f" 2>/dev/null | tail -${limit} | cut -c1-20000
done' | ${MASK_SED} | head -c ${c.capBytes}`;
}

function sshExec(host, remoteCmd, timeoutMs) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.key) args.push('-i', c.key);
  args.push(c.user ? `${c.user}@${host}` : host, remoteCmd);
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: 32 * MB, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 300)));
      resolve(String(stdout || ''));                      // partial output beats no output
    });
  });
}

/* ---- line → entry ---------------------------------------------------------------------------
 * The winston line is `{channel,forwardedFor,ip,level,message,path,platform,rawInput,request,response,
 * requestId,service,source,staffId,timestamp,type,version}`. Everything is kept as-is; `ok` is DERIVED
 * (never asserted when the line does not say): an `error` object, level=error, a "mutation … fail" or a
 * response.resultCode other than '0' is a failure; a "… Response" line with none of those is a success;
 * anything else stays null ("—"), because a Request line has no verdict of its own. */
const ID_KEYS = ['msisdn', 'mobile', 'mobileNumber', 'iccid', 'imsi', 'custCode', 'custID', 'customerId', 'customerID',
  'personId', 'idNumber', 'nationalId', 'dealerId', 'operatorTCN', 'orderNumber', 'orderNo', 'plateNumber', 'odb',
  'serviceNumber', 'workflowId', 'stateId', 'accountNumber', 'email'];
function collectIds(o, out = {}, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'object') { collectIds(v, out, depth + 1); continue; }
    const hit = ID_KEYS.find(i => i.toLowerCase() === String(k).toLowerCase());
    if (hit && out[hit] == null && String(v).length <= 64) out[hit] = String(v);
  }
  return out;
}
const tsOf = t => {
  const s = String(t || '').trim(); if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) ? new Date(s.replace(' ', 'T') + (/[+Z]/.test(s.slice(10)) ? '' : '+03:00')) : new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
const MUT_RE = /^mutation\s+(\S+)\s+(success|succeeded|fail|failed|error)\b(?:.*?(\d+)\s*ms)?/i;
function parseLine(line, file) {
  /* a line that is not the app's JSON (a stack-trace continuation, a plain console line) is KEPT as-is —
   * it matched the operator's term, so hiding it would be lying about what the log holds. */
  const plain = () => ({ at: null, ts: null, level: null, message: line.slice(0, 4000), unparsed: true, ids: {}, ok: null,
    key: crypto.createHash('sha1').update(line).digest('hex').slice(0, 16), file });
  const i = line.indexOf('{'); if (i < 0) return plain();
  let o; try { o = JSON.parse(line.slice(i)); } catch (e) { return plain(); }
  if (!o || typeof o !== 'object') return plain();
  const msg = String(o.message || ''), level = String(o.level || '').toLowerCase();
  const err = o.error && typeof o.error === 'object' ? o.error : (o.error ? { message: String(o.error) } : null);
  const resp = o.response && typeof o.response === 'object' ? o.response : null;
  const m = MUT_RE.exec(msg);
  let ok = null, ms = null;
  if (m) { ok = /^succ/i.test(m[2]); ms = m[3] ? Number(m[3]) : null; }
  else if (err || level === 'error') ok = false;
  else if (resp && resp.resultCode != null) ok = String(resp.resultCode) === '0';
  else if (resp && resp.statusCode != null) ok = Number(resp.statusCode) < 400;
  else if (/Response\b/i.test(msg)) ok = true;
  const status = (o.shape && o.shape.data && o.shape.data.httpStatus) || (err && (err.statusCode || err.status || err.httpStatus))
    || (resp && resp.statusCode) || null;
  return {
    ts: tsOf(o.timestamp), at: o.timestamp || null, level: level || null, message: msg.slice(0, 1000),
    path: o.path || null, type: o.type || null, service: o.service || null, source: o.source || null,
    channel: o.channel || null, request_id: o.requestId || null, staff_id: o.staffId || null,
    platform: o.platform || null, app_version: o.version || null, ip: o.ip || o.forwardedFor || null,
    ok, ms, status: status != null && Number.isFinite(Number(status)) ? Number(status) : null,
    error: err || null, request: o.request != null ? o.request : null, response: o.response != null ? o.response : null,
    input: o.rawInput != null ? o.rawInput : (o.input != null ? o.input : null),
    ids: collectIds({ r: o.request, i: o.rawInput || o.input, p: o.response, t: o }),
    key: crypto.createHash('sha1').update(line).digest('hex').slice(0, 16), file
  };
}

function parseHost(host, raw) {
  const files = [], entries = [];
  let file = null;
  for (const line of String(raw || '').split('\n')) {
    if (line.startsWith('@@FILE ')) {
      const mm = /^@@FILE (\S+) (\d+)$/.exec(line);
      if (mm) { file = mm[1]; files.push({ file: mm[1], hits: Number(mm[2]) }); }
      continue;
    }
    if (!line.trim()) continue;
    const e = parseLine(line, file);
    if (e) entries.push({ ...e, host });
  }
  return { host, files, entries };
}

/* group the lines into the cases they belong to: one group per requestId (the app stamps every line of one
 * tRPC call with it), everything without one lands in a single "no request id" group, time-ordered. */
function group(entries) {
  const by = new Map();
  for (const e of entries) {
    if (!e) continue;
    const k = e.request_id || '-';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  const groups = [];
  for (const [request_id, rows] of by) {
    rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')) || 0);
    const ids = {}; for (const r of rows) for (const [k, v] of Object.entries(r.ids || {})) if (ids[k] == null) ids[k] = v;
    const fails = rows.filter(r => r.ok === false);
    groups.push({
      request_id: request_id === '-' ? null : request_id,
      from: rows[0].ts, to: rows[rows.length - 1].ts,
      channel: (rows.find(r => r.channel) || {}).channel || null,
      path: (rows.find(r => r.path) || {}).path || null,
      staff_id: (rows.find(r => r.staff_id) || {}).staff_id || null,
      platform: (rows.find(r => r.platform) || {}).platform || null,
      app_version: (rows.find(r => r.app_version) || {}).app_version || null,
      steps: rows.length, failed: fails.length,
      outcome: fails.length ? 'failed' : (rows.some(r => r.ok === true) ? 'success' : 'unknown'),
      reason: fails.length ? ((fails[fails.length - 1].error && fails[fails.length - 1].error.message) || fails[fails.length - 1].message || null) : null,
      ids, rows
    });
  }
  groups.sort((a, b) => String(b.to || '').localeCompare(String(a.to || '')));
  return groups;
}

/* ONE HOST PASS: run the script, parse, return { hosts, entries }. */
async function pass(term, o) {
  const c = CFG();
  const script = remoteScript(term, o);
  const settled = await Promise.allSettled(c.hosts.map(h => sshExec(h, script, c.timeoutMs)));
  const hosts = [], entries = [];
  let totalHits = 0;
  settled.forEach((s, i) => {
    const host = c.hosts[i];
    if (s.status === 'rejected') { hosts.push({ host, error: String(s.reason.message || s.reason).slice(0, 220) }); return; }
    const p = parseHost(host, s.value);
    totalHits += p.files.reduce((a, f) => a + f.hits, 0);
    entries.push(...p.entries);
    hosts.push({ host, files: p.files, lines: p.entries.length });
  });
  return { hosts, entries, totalHits };
}

async function search(rawTerm, opts = {}) {
  const c = CFG();
  if (!configured()) return { configured: false, error: 'app-log grep not configured (FIXED_LOG_HOSTS / FIXED_GREP=0)' };
  const term = String(rawTerm == null ? '' : rawTerm).trim();
  if (term.length < 3) return { configured: true, ok: false, error: 'search term must be at least 3 characters' };
  if (term.length > 200) return { configured: true, ok: false, error: 'search term too long (200 characters max)' };
  const regex = !!opts.regex, deep = !!opts.deep;
  if (regex) { try { new RegExp(term); } catch (e) { return { configured: true, ok: false, error: 'not a valid regular expression: ' + e.message }; } }
  const limit = Math.min(c.maxLines, Math.max(20, Number(opts.limit) || 200));
  const t0 = Date.now();
  const one = await pass(term, { deep, limit, regex });
  const hosts = one.hosts.slice();
  const seen = new Set(), entries = [];
  for (const e of one.entries) { if (e.key && seen.has(e.key)) continue; if (e.key) seen.add(e.key); entries.push(e); }
  const totalHits = one.totalHits;
  let truncated = totalHits > one.entries.length;

  /* SECOND PASS — THE POINT OF THIS FEATURE. A term matches only the lines that literally carry it, so a
   * customer id finds the validate step but NOT the `mutation … success 936ms` verdict or the SIM-creation
   * call that followed under the same requestId. So: take the requestIds the first pass found and grep them
   * back, which returns the WHOLE journey — every step, success and failure, with its request / response.
   * grep -F treats a newline-separated pattern as a list, so all ids are fetched in ONE remote pass.
   * Bounded: at most 12 ids, skipped when the first pass already used most of the time budget, and never
   * fatal (its own failure leaves the first pass's answer standing). */
  const ids = [...new Set(entries.map(e => e.request_id).filter(x => x && /^[\w.:-]{4,64}$/.test(x)))].slice(0, 12);
  let expanded = 0, expandSkipped = null;
  const wantExpand = opts.expand !== false && opts.expand !== '0' && ids.length > 0;
  if (wantExpand && Date.now() - t0 > 0.55 * c.timeoutMs) expandSkipped = 'first pass used most of the time budget';
  else if (wantExpand) {
    try {
      const two = await pass(ids.join('\n'), { deep, limit, regex: false });
      for (const e of two.entries) {
        if (e.key && seen.has(e.key)) continue;
        if (e.key) seen.add(e.key);
        entries.push({ ...e, via: 'request_id' });
        expanded++;
      }
      for (const h of two.hosts) if (h.error) hosts.push({ host: h.host, error: 'journey expansion: ' + h.error });
    } catch (e) { expandSkipped = String(e.message || e).slice(0, 200); }
  }
  entries.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  const errors = hosts.filter(h => h.error).map(h => `${h.host}: ${h.error}`);
  const groups = group(entries);
  return {
    configured: true, ok: true, term, regex, deep, limit, ms: Date.now() - t0,
    scope: `${deep ? 'current + rotated' : 'current'} ${c.path} on ${c.hosts.join(', ')}`,
    total_hits: totalHits, returned: entries.length, truncated,
    expanded, expand_skipped: expandSkipped, request_ids: ids,
    hosts, groups, entries,
    errors: errors.length ? errors : null,
    note: totalHits === 0
      ? (deep ? 'Nothing in the current or rotated app log carries this term.'
              : 'Nothing in the CURRENT app log carries this term — the rotated files are not searched unless you ask for them (include rotated).')
      : (truncated ? `Showing the newest ${limit} matching lines per file out of ${totalHits} — narrow the term or raise the line cap.` : null)
  };
}

const status = () => { const c = CFG(); return { configured: configured(), hosts: c.hosts, user: c.user || null, path: c.path, maxLines: c.maxLines }; };

function mount(app, { requireView, audit } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/applog/grep', gate, async (req, res) => {
    try {
      const term = String(req.query.q || '').trim();
      if (audit) await audit(req, 'fixed.applog.grep', term.slice(0, 120), { deep: req.query.deep === '1', regex: req.query.regex === '1' });
      res.json(await search(term, { deep: req.query.deep === '1', regex: req.query.regex === '1', limit: req.query.limit }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/fixed/applog/grep/status', gate, (req, res) => res.json(status()));
}

module.exports = { mount, search, status, configured, parseLine, group, remoteScript };

// CLI:  node src/fixedLogGrep.js <term> [--deep] [--regex] [--limit N]
if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2);
    const term = a.filter(x => !x.startsWith('--'))[0];
    if (!term) { console.error('usage: node src/fixedLogGrep.js <term> [--deep] [--regex] [--limit N]'); process.exit(1); }
    const li = a.indexOf('--limit');
    const r = await search(term, { deep: a.includes('--deep'), regex: a.includes('--regex'), limit: li > 0 ? a[li + 1] : null });
    console.log(JSON.stringify({ ...r, entries: (r.entries || []).slice(0, 3), groups: (r.groups || []).map(g => ({ ...g, rows: g.rows.length })) }, null, 2));
  })().catch(e => { console.error('grep failed:', e.message); process.exit(1); });
}
