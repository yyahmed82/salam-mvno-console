/* FIXED APP-LOG GREP — "show me everything the log has about this" for Fixed › Troubleshoot.
 * 17 Sep 2026 · v2 (single-pass + byte window + async job) after the first live run on 146.
 *
 * WHY. The error board reads the sda_ops read models and the app-log lane reads fixed_app_events — both keep
 * only FAILED steps, and only the fields the collector parses. So a customer id that an L2 engineer finds in
 * one `grep -rn '1054887433' /app/log/sda/combined.log` on RUH-App-P01 answers "No errors in this window" on
 * the console. This module is that grep, run from the console: ANY free-text term, matched against the WHOLE
 * winston line (every field — msisdn, iccid, imsi, custCode, custID, personId, dealerId, operatorTCN, requestId,
 * staffId, order no, plate, an error phrase …), returning SUCCESSES AND FAILURES with their request / response
 * bodies, grouped into the journey the requestId stitches together.
 *
 * WHAT THE FIRST LIVE RUN TAUGHT (v1 → v2). v1 reported "219 matching lines · 0 returned · 50.3s": it counted
 * with `zgrep -c` and then re-read the file to print the lines, i.e. TWO full passes over a multi-GB log. The
 * first pass ate the whole 50 s budget, the remote `timeout` killed the second, and the count survived while
 * every line was lost. Three changes, in order of how much they matter:
 *   1. ONE PASS. grep feeds an awk ring buffer that keeps the newest N lines AND the true total count — the
 *      file is read once, never twice.
 *   2. READ FROM THE END. The log is chronological and operators search recent cases, so the default reads
 *      only the last FIXED_GREP_TAIL_MB (512 MB) via `tail -c`, which SEEKS — the earlier gigabytes are never
 *      touched. Each file reports its size and the first timestamp inside the window, so the answer always
 *      says what it actually covered instead of implying the whole log.
 *   3. NO 60 s WALL. nginx cuts a request at 60 s, which capped any honest full-file or rotated search. The
 *      search now runs as a background JOB the page polls, so "whole file" and "+ rotated" get minutes
 *      (FIXED_GREP_DEEP_SECS) instead of being killed half way.
 *
 * It is ADDITIVE. The collector (fixedAppLogCollector), fixed_app_events, the lane and the board are untouched;
 * nothing here writes to the database. Same host / identity / path as the collector: FIXED_LOG_HOSTS (146),
 * FIXED_LOG_USER/KEY (console_ro + api_log_ed25519), FIXED_LOG_PATH (/app/log/sda/combined.log).
 *
 * PROD-SAFETY RULES (146 is the live Fixed app node — same rules as dmsLogGrep):
 *  · EXPLICIT ACTION ONLY. A person presses Search. Never on a timer, never from the board's auto-refresh.
 *  · STAGED. Default = the tail window of the current combined.log. The whole file, and the rotated / .gz
 *    siblings, only when the operator picks that depth — under `nice -n 19` + `ionice`, one hard remote
 *    `timeout`, and only ONE search at a time per host (a second one queues on the first).
 *  · Bounded everywhere: newest-N lines per file, 20 000 characters per line, output byte cap, ssh maxBuffer,
 *    ssh timeout > remote timeout. Errors travel with results (per-host `error` field — house rule).
 *  · CREDENTIALS MASKED AT SOURCE, before anything crosses the wire: Nafath iamAppToken JWTs, apiKey values,
 *    "password" / "authorization" values, SOAP wsse:Password, and (alpha.158) the SIM keys BSS querySimCard
 *    answers carry — ki, opc, pin / puk, adm. Those are secrets, not data; secretMask.js masks them again here.
 *  · CUSTOMER DATA IS NOT MASKED — the same decision as the DMS log grep (Yosri, 3 Sep): Troubleshoot is
 *    L2-gated, L2 reads this exact file raw on the node, and masking here only slows a live case down. The
 *    route is gated on the `fixed` view and EVERY search is written to the audit log.
 *  · The term never reaches the remote shell as text: term, file list and the awk program are base64'd here
 *    and decoded into variables there, so no quote / metacharacter / newline can escape.
 *
 * Env: FIXED_GREP=0 disables · FIXED_GREP_TAIL_MB (512 default window) · FIXED_GREP_REMOTE_SECS (50)
 *      FIXED_GREP_DEEP_SECS (240, whole-file / rotated) · FIXED_GREP_MAX_LINES (1000) · FIXED_GREP_CAP_MB (3)
 *      FIXED_GREP_JOB_TTL_MIN (15) · plus the collector's FIXED_LOG_* vars. */
'use strict';
const { execFile } = require('child_process');
const crypto = require('crypto');
const { maskSecrets } = require('./secretMask');   // SIM secrets in logged BSS answers (alpha.158)
const MB = 1024 * 1024;
const col = require('./fixedAppLogCollector');

const CFG = () => {
  const c = col.CFG();
  return {
    enabled: process.env.FIXED_GREP !== '0',
    hosts: c.hosts, user: c.user, key: c.key, path: c.path,
    tailMb: Math.max(0, Number(process.env.FIXED_GREP_TAIL_MB) === 0 ? 0 : (Number(process.env.FIXED_GREP_TAIL_MB) || 512)),
    remoteSecs: Number(process.env.FIXED_GREP_REMOTE_SECS) || 50,
    deepSecs: Number(process.env.FIXED_GREP_DEEP_SECS) || 240,
    maxLines: Math.max(20, Number(process.env.FIXED_GREP_MAX_LINES) || 1000),
    capBytes: Math.max(1, Number(process.env.FIXED_GREP_CAP_MB) || 3) * MB,
    jobTtlMs: Math.max(1, Number(process.env.FIXED_GREP_JOB_TTL_MIN) || 15) * 60000,
    cacheMs: Math.max(0, Number(process.env.FIXED_GREP_CACHE_SEC) === 0 ? 0 : (Number(process.env.FIXED_GREP_CACHE_SEC) || 180)) * 1000
  };
};
const configured = () => { const c = CFG(); return c.enabled && c.hosts.length > 0; };

/* the depth the operator picks. `mb` = bytes read from the END of the current file (0 = whole file);
 * `rotated` also reads the .gz siblings, which are always read whole (a byte window into a compressed
 * file means nothing). Anything past the tail window needs the long budget, hence `deep`. */
const DEPTHS = {
  recent: { mb: 256, rotated: false, label: 'last 256 MB of the current log' },
  window: { mb: 512, rotated: false, label: 'last 512 MB of the current log' },
  wide: { mb: 2048, rotated: false, label: 'last 2 GB of the current log' },
  full: { mb: 0, rotated: false, label: 'the whole current log', deep: true },
  all: { mb: 0, rotated: true, label: 'the whole current log + every rotated file', deep: true }
};
const depthOf = o => DEPTHS[String(o || '').toLowerCase()] || null;

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
/* the rotated siblings of the configured file: /app/log/sda/combined.log → /app/log/sda/combined*.log* */
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
  `-e 's/<wsse:Password[^>]*>[^<]*<\\/wsse:Password>/<wsse:Password>***<\\/wsse:Password>/g' ` +
  /* SIM secrets in BSS querySimCard answers (ki, opc, pin / puk, adm …) — alpha.158; the console masks again (secretMask.js) */
  `-e 's/"\\(ki\\|k\\|eki\\|opc\\|op\\|kic\\|kid\\|kik\\|pin\\|pin1\\|pin2\\|puk\\|puk1\\|puk2\\|adm\\|adm1\\)" *: *"[^"]*"/"\\1":"***"/gI' ` +
  `-e 's/"\\(pin\\|pin1\\|pin2\\|puk\\|puk1\\|puk2\\)" *: *[0-9][0-9]*/"\\1":"***"/gI'`;

/* ONE PASS PER FILE. grep streams into an awk ring buffer that holds only the newest N lines and counts
 * every match, so the total and the sample come out of the SAME read. This is the fix for v1's "219
 * matching lines · 0 returned": counting separately meant reading the log twice. */
const AWK = `{c++; b[c%n]=substr($0,1,20000)}
END{printf "@@FILE %s %d\\n", f, c; s=(c>n)?c-n:0; for(i=s+1;i<=c;i++) print b[i%n]}`;

function remoteScript(term, { rotated, tailMb, limit, regex, secs }) {
  const c = CFG();
  const files = rotated ? globs(c.path) : c.path;
  const FLAG = regex ? '-E' : '-F';
  const TB = Math.max(0, Number(tailMb) || 0) * MB;
  /* `timeout`, `ionice`, `stat` and `zcat` are each probed, never assumed: a missing one must degrade
   * (no cap / no niceness / no size / gzip -cd), never make the search silently return nothing. */
  return `T=$(printf %s '${b64(term)}' | base64 -d); F=$(printf %s '${b64(files)}' | base64 -d); ` +
    `A=$(printf %s '${b64(AWK)}' | base64 -d); TB=${TB}; export T F A TB LC_ALL=C; ` +
    `TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout ${secs}"; $TO sh -c '
NI="nice -n 19"; command -v ionice >/dev/null 2>&1 && NI="ionice -c3 nice -n 19"
Z="zcat"; command -v zcat >/dev/null 2>&1 || Z="gzip -cd"
feed() { case "$1" in *.gz) $NI $Z "$1";; *) if [ "$TB" = "0" ]; then $NI cat "$1"; else $NI tail -c "$TB" "$1"; fi;; esac; }
for f in $F; do
  [ -f "$f" ] || continue
  echo "@@SIZE $f $(stat -c %s "$f" 2>/dev/null || echo 0)"
  printf "@@HEAD %s " "$f"; feed "$f" 2>/dev/null | head -c 2000 | tr -d "\\n"; echo ""
  feed "$f" 2>/dev/null | $NI grep ${FLAG} -e "$T" | $NI awk -v n=${limit} -v f="$f" "$A"
done' | ${MASK_SED} | head -c ${c.capBytes}`;
}

function sshExec(host, remoteCmd, timeoutMs) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15'];
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
const hash = line => crypto.createHash('sha1').update(line).digest('hex').slice(0, 16);
function parseLine(line, file) {
  /* a line that is not the app's JSON (a stack-trace continuation, a plain console line) is KEPT as-is —
   * it matched the operator's term, so hiding it would be lying about what the log holds. */
  const plain = () => ({ at: null, ts: null, level: null, message: maskSecrets(line.slice(0, 4000)), unparsed: true, ids: {}, ok: null, key: hash(line), file });
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
    error: err || null, request: o.request != null ? maskSecrets(o.request) : null, response: o.response != null ? maskSecrets(o.response) : null,
    input: o.rawInput != null ? maskSecrets(o.rawInput) : (o.input != null ? maskSecrets(o.input) : null),
    ids: collectIds({ r: o.request, i: o.rawInput || o.input, p: o.response, t: o }),
    key: hash(line), file
  };
}

const firstTsIn = head => {
  const m = /"timestamp"\s*:\s*"([^"]{8,40})"/.exec(String(head || ''));
  return m ? tsOf(m[1]) : null;
};
function parseHost(host, raw) {
  const files = new Map(), entries = [];
  const F = f => { if (!files.has(f)) files.set(f, { file: f, hits: 0, size: null, from: null }); return files.get(f); };
  let file = null;
  for (const line of String(raw || '').split('\n')) {
    if (line.startsWith('@@SIZE ')) { const mm = /^@@SIZE (\S+) (\d+)$/.exec(line); if (mm) F(mm[1]).size = Number(mm[2]); continue; }
    if (line.startsWith('@@HEAD ')) { const mm = /^@@HEAD (\S+) ?(.*)$/.exec(line); if (mm) F(mm[1]).from = firstTsIn(mm[2]); continue; }
    if (line.startsWith('@@FILE ')) { const mm = /^@@FILE (\S+) (\d+)$/.exec(line); if (mm) { file = mm[1]; F(mm[1]).hits = Number(mm[2]); } continue; }
    if (!line.trim()) continue;
    entries.push({ ...parseLine(line, file), host });
  }
  return { host, files: [...files.values()], entries };
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

/* ONE SEARCH AT A TIME PER HOST. Two operators hitting Search together would double the IO on a live app
 * node for no benefit, so a second pass waits for the first instead of racing it. */
const _lane = new Map();
function serialize(host, fn) {
  const prev = _lane.get(host) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _lane.set(host, next.catch(() => {}));
  return next;
}
async function pass(term, o) {
  const c = CFG();
  const script = remoteScript(term, o);
  const settled = await Promise.allSettled(c.hosts.map(h => serialize(h, () => sshExec(h, script, o.secs * 1000 + 8000))));
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

async function search(rawTerm, opts = {}, onPhase = () => {}) {
  const c = CFG();
  if (!configured()) return { configured: false, error: 'app-log grep not configured (FIXED_LOG_HOSTS / FIXED_GREP=0)' };
  const term = String(rawTerm == null ? '' : rawTerm).trim();
  if (term.length < 3) return { configured: true, ok: false, error: 'search term must be at least 3 characters' };
  if (term.length > 200) return { configured: true, ok: false, error: 'search term too long (200 characters max)' };
  const regex = !!opts.regex;
  if (regex) { try { new RegExp(term); } catch (e) { return { configured: true, ok: false, error: 'not a valid regular expression: ' + e.message }; } }
  /* depth: the named steps above, or the legacy deep=1 flag (= "all"), or the configured default window */
  const D = depthOf(opts.depth) || (opts.deep ? DEPTHS.all : { mb: c.tailMb, rotated: false, label: c.tailMb ? `last ${c.tailMb} MB of the current log` : 'the whole current log', deep: !c.tailMb });
  const secs = D.deep ? c.deepSecs : c.remoteSecs;
  const limit = Math.min(c.maxLines, Math.max(20, Number(opts.limit) || 200));
  const t0 = Date.now();

  onPhase('scanning the log');
  const one = await pass(term, { rotated: D.rotated, tailMb: D.mb, limit, regex, secs });
  const hosts = one.hosts.slice();
  const seen = new Set(), entries = [];
  for (const e of one.entries) { if (e.key && seen.has(e.key)) continue; if (e.key) seen.add(e.key); entries.push(e); }
  const totalHits = one.totalHits;
  const truncated = totalHits > entries.length;

  /* SECOND PASS — THE POINT OF THIS FEATURE. A term matches only the lines that literally carry it, so a
   * customer id finds the validate step but NOT the `mutation … success 936ms` verdict or the SIM-creation
   * call that followed under the same requestId. So: take the requestIds the first pass found and grep them
   * back, which returns the WHOLE journey — every step, success and failure, with its request / response.
   * grep -F treats a newline-separated pattern as a list, so all ids are fetched in ONE remote pass over the
   * SAME window. Capped at 12 ids, skipped when the first pass already had no id or ran long, never fatal. */
  const ids = [...new Set(entries.map(e => e.request_id).filter(x => x && /^[\w.:-]{4,64}$/.test(x)))].slice(0, 12);
  let expanded = 0, expandSkipped = null;
  const wantExpand = opts.expand !== false && opts.expand !== '0' && ids.length > 0;
  if (wantExpand && (Date.now() - t0) > 0.6 * secs * 1000) expandSkipped = 'the first pass used most of the time budget';
  else if (wantExpand) {
    onPhase(`pulling the full journey for ${ids.length} request id${ids.length === 1 ? '' : 's'}`);
    try {
      const two = await pass(ids.join('\n'), { rotated: D.rotated, tailMb: D.mb, limit, regex: false, secs });
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

  /* what was ACTUALLY covered — the operator must never read "no match" as "not in the log" when only the
   * last 512 MB of a 9 GB file was read. Every file reports its size, the bytes read and the first
   * timestamp inside that window. */
  const files = [];
  for (const h of hosts) for (const f of (h.files || [])) {
    const win = f.file.endsWith('.gz') || !D.mb ? (f.size || 0) : Math.min(f.size || 0, D.mb * MB);
    files.push({ ...f, host: h.host, window_bytes: win, partial: !!(f.size && win < f.size) });
  }
  const partial = files.some(f => f.partial);
  const oldest = files.map(f => f.from).filter(Boolean).sort()[0] || null;
  return {
    configured: true, ok: true, term, regex, depth: opts.depth || (D.rotated ? 'all' : 'window'), depth_label: D.label,
    limit, ms: Date.now() - t0, secs_budget: secs,
    scope: `${D.label} on ${c.hosts.join(', ')}`, covers_from: oldest, partial,
    total_hits: totalHits, returned: entries.length, truncated,
    expanded, expand_skipped: expandSkipped, request_ids: ids,
    hosts, files, groups, entries,
    errors: errors.length ? errors : null,
    note: totalHits === 0
      ? (partial ? `Nothing in the searched window carries this term${oldest ? ` — it covers back to ${oldest}` : ''}. Search deeper for an older case.`
                 : 'Nothing in the searched files carries this term.')
      : (truncated ? `${totalHits} lines match; the newest ${limit} per file were returned — narrow the term or raise the line cap.` : null)
  };
}

/* ---- background jobs ------------------------------------------------------------------------
 * nginx cuts a proxied request at 60 s, so a synchronous route could never honestly offer a whole-file or
 * rotated search. The page starts a job and polls it; the search keeps running server-side either way. */
const _jobs = new Map();
const jobKey = o => JSON.stringify([o.term, o.depth || '', !!o.regex, o.limit || '', o.expand !== false]);
function reap() {
  const ttl = CFG().jobTtlMs, now = Date.now();
  for (const [id, j] of _jobs) if (now - j.at > ttl && j.status !== 'running') _jobs.delete(id);
  if (_jobs.size > 40) for (const [id, j] of [..._jobs].slice(0, 10)) if (j.status !== 'running') _jobs.delete(id);
}
function start(term, opts = {}) {
  reap();
  const key = jobKey({ ...opts, term });
  const c = CFG();
  /* The same search asked twice is answered once: an identical search already RUNNING is joined rather
   * than raced (two greps of a multi-GB file on a live app node for one answer), and one that finished
   * seconds ago is served from its result instead of re-reading the log. */
  for (const [id, j] of _jobs) if (j.key === key && j.status === 'running') return { id, status: 'running', joined: true };
  if (c.cacheMs) for (const [id, j] of [..._jobs].reverse())
    if (j.key === key && j.status === 'done' && Date.now() - j.at < c.cacheMs) return { id, status: 'done', cached: true };
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, key, term, startedAt: Date.now(), at: Date.now(), status: 'running', phase: 'starting', result: null, error: null };
  _jobs.set(id, job);
  search(term, opts, ph => { job.phase = ph; })
    .then(r => { job.result = r; job.status = r && r.ok === false ? 'failed' : 'done'; if (r && r.ok === false) job.error = r.error; job.at = Date.now(); })
    .catch(e => { job.status = 'failed'; job.error = String(e.message || e).slice(0, 300); job.at = Date.now(); });
  return { id, status: 'running', joined: false };
}
function job(id) {
  const j = _jobs.get(String(id || ''));
  if (!j) return { ok: false, error: 'no such search (it may have expired — run it again)' };
  return { ok: true, id: j.id, status: j.status, phase: j.phase, term: j.term, error: j.error,
    elapsed_ms: j.status === 'running' ? Date.now() - j.startedAt : (j.result ? j.result.ms : Date.now() - j.startedAt),
    result: j.status === 'done' ? j.result : null };
}

const status = () => { const c = CFG(); return { configured: configured(), hosts: c.hosts, user: c.user || null, path: c.path, tailMb: c.tailMb, maxLines: c.maxLines, depths: Object.entries(DEPTHS).map(([k, v]) => ({ key: k, label: v.label, deep: !!v.deep })) }; };

function mount(app, { requireView, audit } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  const opts = q => ({ depth: q.depth || null, deep: q.deep === '1', regex: q.regex === '1', limit: q.limit, expand: q.expand === '0' ? false : true });
  app.get('/api/fixed/applog/grep', gate, async (req, res) => {
    try {
      const term = String(req.query.q || '').trim();
      if (audit) await audit(req, 'fixed.applog.grep', term.slice(0, 120), { depth: req.query.depth || null, regex: req.query.regex === '1' });
      if (req.query.async === '1') {
        if (!configured()) return res.json({ configured: false, error: 'app-log grep not configured (FIXED_LOG_HOSTS / FIXED_GREP=0)' });
        if (term.length < 3) return res.json({ configured: true, ok: false, error: 'search term must be at least 3 characters' });
        return res.json({ configured: true, ok: true, ...start(term, opts(req.query)) });
      }
      res.json(await search(term, opts(req.query)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/fixed/applog/grep/job', gate, (req, res) => { try { res.json(job(req.query.id)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/fixed/applog/grep/status', gate, (req, res) => res.json(status()));
}

module.exports = { mount, search, start, job, status, configured, parseLine, parseHost, group, remoteScript, DEPTHS };

// CLI:  node src/fixedLogGrep.js <term> [--depth recent|window|wide|full|all] [--regex] [--limit N] [--no-expand]
if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2);
    const term = a.filter(x => !x.startsWith('--'))[0];
    if (!term) { console.error('usage: node src/fixedLogGrep.js <term> [--depth recent|window|wide|full|all] [--regex] [--limit N] [--no-expand]'); process.exit(1); }
    const val = f => { const i = a.indexOf(f); return i > 0 ? a[i + 1] : null; };
    const t0 = Date.now();
    const r = await search(term, { depth: val('--depth'), regex: a.includes('--regex'), limit: val('--limit'), expand: !a.includes('--no-expand') },
      ph => console.error(`… ${ph} (${Math.round((Date.now() - t0) / 1000)}s)`));
    console.log(JSON.stringify({ ...r, entries: (r.entries || []).slice(0, 3), groups: (r.groups || []).map(g => ({ ...g, rows: g.rows.length })) }, null, 2));
  })().catch(e => { console.error('grep failed:', e.message); process.exit(1); });
}
