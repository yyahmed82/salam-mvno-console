#!/usr/bin/env node
/* perfmail.cjs — the console's performance report as a MAIL (the D5 measurement block, 7 Oct 2026). Run ON 152:
 *
 *   cd /apps/unified/server && node perfmail.cjs --to y.yahmed.sns@salam.sa          # send now
 *   node perfmail.cjs --to a@salam.sa,b@salam.sa --dry                                # print, send nothing
 *   node perfmail.cjs --to report                                                     # the "Mail report" users (Sync Health list)
 *   options: --html /path/report.html (save a copy; default snapshots/perf/PERFMAIL-<stamp>.html) · --no-rotate (keep the baseline)
 *            --no-reset (leave the /api/perf counters running; by default they are reset after a sent mail, so the next
 *            mail's routes / pools / slow lists cover exactly the window since this one — like the scan deltas)
 *
 * What it reports, as deltas SINCE THE PREVIOUS MAIL (state: snapshots/perf/perfmail-state.json; the first run seeds its
 * scan baseline from the scans-*-141-before.txt files the deploy wrote):
 *   - GET /api/perf (loopback, as CONSOLE_ADMIN_USER): event loop, CPU/RSS, routes (n/avg/p50/p95/max/slow/5xx), the last slow
 *     requests, every pool's waits and slowest statements (pool.query AND checked-out clients), the per-minute table
 *   - [SLOW] / [LAG] lines of console.err.log since the previous mail
 *   - Postgres 121, replica + console db (read-only): sequential/index scan deltas per table, buffer-cache hit ratio for the
 *     window, the console-made indexes' usage, connections used / max, statements running longer than 3 s right now
 *   - /api/cache-stats: entries, URLs kept warm, the last keep-warm cycle
 * Mail goes through the console's own mailer (server/src/notify.js — SMTP, branding and the Bcc rule from .env).
 * Read-only on every database; it writes only the state file and the saved HTML copy. */
'use strict';
process.env.TZ = 'UTC';                                     // node-pg parses `timestamp without time zone` in the process TZ — same pin as the app
const fs = require('fs'), path = require('path'), http = require('http');

/* ---- environment: the app's own .env, parsed in node (never `set -a; . .env`) — same loader as cli.js / sql.cjs ---- */
(function loadAppEnv() {
  const file = [process.env.ENV_FILE, path.join(__dirname, '..', '.env'), '/apps/unified/.env'].filter(Boolean)
    .find(p => { try { fs.accessSync(p); return true; } catch (_) { return false; } });
  if (!file) return;
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line); if (!m) continue;
    let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) { process.env[m[1]] = v; n++; }
  }
  console.error(`[perfmail] environment: ${n} key(s) from ${file}`);
})();

const ARGS = process.argv.slice(2);
const opt = (name, dflt) => { const i = ARGS.indexOf(name); if (i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) return ARGS[i + 1]; const kv = ARGS.find(a => a.startsWith(name + '=')); return kv ? kv.slice(name.length + 1) : dflt; };
const flag = name => ARGS.includes(name);
const DRY = flag('--dry'), ROTATE = !flag('--no-rotate'), RESET = !flag('--no-reset');
const PORT = Number(process.env.PORT || 4701);
const ADMIN = process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa';
const ROOT = path.resolve(__dirname, '..');                                   // /apps/unified
const PERF_DIR = process.env.PERFMAIL_DIR || path.join(ROOT, 'snapshots', 'perf');
const STATE = path.join(PERF_DIR, 'perfmail-state.json');
const ERRLOG = process.env.PERFMAIL_ERRLOG || path.join(ROOT, 'logs', 'console.err.log');
const TO = opt('--to', ADMIN);
const KSA = 'Asia/Riyadh';
const ksa = (d, withSec) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: KSA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: withSec ? '2-digit' : undefined, hour12: false }).format(new Date(d)).replace(',', '') ; } catch (_) { return String(d); } };
const ksaIso = d => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: KSA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(d)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const num = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US');
const msf = n => n == null ? '—' : (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms');
const pad = (s, w) => String(s == null ? '' : s).padEnd(w);
const rpad = (s, w) => String(s == null ? '' : s).padStart(w);

const TABLES = {
  replica: ['onboarding_orders', 'otps', 'checkouts', 'service_logs', 'change_plan_logs', 'users', 'payments', 'delivery_requests', 'activation_logs'],
  console: ['api_traffic_events', 'fixed_app_events', 'infra_probes', 'apigw_trace_stats', 'alerts', 'llm_calls', 'metric_snapshots', 'api_error_events']
};
const NEW_INDEXES = ['idx_src_payments_id_text', 'idx_src_onb_id_text', 'idx_src_onb_nid_upper', 'idx_src_users_created', 'idx_src_svclog_mobile', 'idx_src_svclog_msisdn', 'idx_src_otps_created', 'idx_src_otps_for', 'idx_src_checkouts_id_text'];

function getJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { 'X-Console-User': ADMIN, 'X-Cache-Warm': '1' }, timeout: 60000 }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(`${p}: HTTP ${res.statusCode} — ${b.slice(0, 120)}`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error(p + ': timeout')); });
    req.on('error', reject);
  });
}

/* the previous mail's counters (or the deploy-time files) → deltas */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
  const seed = { at: null, scans: {}, hit: {}, seeded: true };
  for (const [name, file] of [['replica', 'scans-replica-141-before.txt'], ['console', 'scans-console-141-before.txt']]) {
    try {
      const f = path.join(PERF_DIR, file); const out = {};
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/[\w]+/g) || []; const nums = m.filter(x => /^\d+$/.test(x));
        if (nums.length >= 3 && m.length && !/^\d+$/.test(m[0])) out[m[0]] = { seq_scan: +nums[0], seq_tup_read: +nums[1], idx_scan: +nums[2] };
      }
      if (Object.keys(out).length) { seed.scans[name] = out; seed.at = seed.at || fs.statSync(f).mtime.toISOString(); }
    } catch (_) {}
  }
  return seed;
}

async function dbFacts(pool, name) {
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows, e => ({ error: e.message }));
  const scans = await q(`SELECT relname, seq_scan::bigint, seq_tup_read::bigint, idx_scan::bigint, n_live_tup::bigint FROM pg_stat_user_tables WHERE relname = ANY($1) ORDER BY 1`, [TABLES[name]]);
  const hit = await q(`SELECT blks_hit::bigint, blks_read::bigint FROM pg_stat_database WHERE datname = current_database()`);
  const conns = await q(`SELECT current_setting('max_connections')::int AS max_conn, (SELECT count(*) FROM pg_stat_activity)::int AS used, (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::int AS active`);
  const long = await q(`SELECT application_name, state, round(extract(epoch FROM now() - query_start))::int AS age_s, left(regexp_replace(query, '\\s+', ' ', 'g'), 110) AS q FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND query_start < now() - interval '3 seconds' AND pid <> pg_backend_pid() ORDER BY query_start LIMIT 8`);
  const idx = name === 'replica' ? await q(`SELECT i.indexrelname, i.idx_scan::bigint, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size, x.indisvalid AS valid FROM pg_stat_user_indexes i JOIN pg_index x ON x.indexrelid = i.indexrelid WHERE i.indexrelname = ANY($1) ORDER BY 1`, [NEW_INDEXES]) : [];
  return { scans, hit, conns, long, idx };
}

function readSlowLines(sinceKsaIso) {
  try {
    const st = fs.statSync(ERRLOG); const fd = fs.openSync(ERRLOG, 'r'); const size = Math.min(st.size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(size); fs.readSync(fd, buf, 0, size, st.size - size); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(l => /\[(SLOW|LAG)\]/.test(l));
    const since = lines.filter(l => { const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(l); return !m || !sinceKsaIso || m[1] >= sinceKsaIso; });
    return { lag: since.filter(l => l.includes('[LAG]')).length, slow: since.filter(l => l.includes('[SLOW]')).length,
      lines: since.slice(-25).map(l => l.replace(/^(\d{4}-\d{2}-\d{2}T)/, '').replace(/ \/api\/\S*/, '').replace(/inflight=/, 'inflight ').slice(0, 110)) };
  } catch (e) { return { lag: null, slow: null, lines: ['(cannot read ' + ERRLOG + ': ' + e.message + ')'] }; }
}

/* ---- the report text (same layout as perfsum.py, so the mail and the terminal read alike) ---- */
function perfText(d) {
  const L = [];
  const n = (d.loop && d.loop.nowMs) || {};
  const v = x => (x == null ? '—' : x);
  L.push(`since ${d.since.slice(0, 16).replace('T', ' ')} UTC · up ${d.uptimeMin} min · node ${d.node}`);
  L.push(`box: ${d.box.cpus} cpus · load ${JSON.stringify(d.box.load)} · free ${d.box.memFreeMb}/${d.box.memTotalMb} MB`);
  L.push(`process: cpu 1m=${v(d.process.cpuPctLastMin)}% 5m=${v(d.process.cpuPct5m)}% 60m=${v(d.process.cpuPct60m)}% (100 = one core)`);
  L.push(`         rss ${d.process.rssMb} MB · heap ${d.process.heapUsedMb}/${d.process.heapTotalMb} MB`);
  L.push(`event loop: now p50=${v(n.p50)} p95=${v(n.p95)} max=${v(n.max)} ms · avg p95 5m=${v(d.loop.p95Avg5m)} 60m=${v(d.loop.p95Avg60m)}`);
  L.push(`            worst-minute avg 60m=${v(d.loop.maxAvg60m)} ms (floor ~10 ms = no lag; healthy p95 < 30)`);
  L.push('  stalls (loop blocked): ' + ((d.loop.stalls || []).slice(0, 10).map(s => `${s.at.slice(11, 19)} ${s.blockedMs} ms`).join(', ') || 'none'));
  L.push(`gc: ${d.gc.count} runs ${d.gc.totalMs} ms · major ${d.gc.major} (${d.gc.majorMs} ms) · longest ${d.gc.maxMs} ms`);
  const r = d.requests;
  L.push(`requests: ${r.total} total · ${r.inflight} in flight · max in flight ${r.maxInflight} · slow (>${d.slowMs} ms): ${r.slowCount}`);
  L.push('  ' + pad('route', 38) + rpad('n', 5) + rpad('avg', 7) + rpad('p95', 7) + rpad('max', 7) + rpad('slow', 5) + rpad('5xx', 4));
  for (const x of (r.routes || []).slice(0, 22)) L.push('  ' + pad(x.route.slice(0, 38), 38) + rpad(x.n, 5) + rpad(Math.round(x.avgMs), 7) + rpad(x.p95 == null ? '—' : Math.round(x.p95), 7) + rpad(x.maxMs, 7) + rpad(x.slow, 5) + rpad(x.err5xx, 4));
  L.push('  last slow requests:');
  for (const s of (r.slow || []).slice(0, 12)) L.push(`    ${s.at.slice(11, 19)} ${rpad(s.ms, 6)} ms ${s.status} ${s.route.slice(0, 38)} ${String(s.actor || '').split('@')[0]}`);
  L.push('db pools:');
  for (const [k, w] of Object.entries(d.db || {})) {
    const q = w.queries;
    L.push(`  ${pad(k, 9)} conns ${w.total}/${w.max} idle ${w.idle} · waited ${w.waitPct}% of the time (max ${w.maxWaiting} queued)`);
    L.push(`            queries ${q.n} · avg ${Math.round(q.avgMs)} ms · max ${q.maxMs} ms · errors ${q.errors}`);
    for (const s of (q.slow || []).slice(0, 6)) L.push(`      ${s.at.slice(11, 19)} ${rpad(s.ms, 6)} ms ${s.via === 'client' ? '[client] ' : ''}${s.err ? '[ERR] ' : ''}${s.sql.slice(0, 88)}`);
  }
  L.push('minutes (last 15): t     | loop p95 | max  | cpu% | rss | req | slow | waiting');
  for (const m of (d.loop.minutes || []).slice(-15)) L.push(`  ${m.t.slice(11, 16)} | ${rpad(v(m.p95), 8)} | ${rpad(v(m.max), 4)} | ${rpad(v(m.cpuPct), 4)} | ${rpad(m.rssMb, 3)} | ${rpad(m.req, 3)} | ${rpad(m.slow, 4)} | ${m.waiting}`);
  return L.join('\n');
}
function clientText(d) {
  const L = [];
  for (const [k, v] of Object.entries(d.db || {})) for (const s of v.queries.slow || []) if (s.via === 'client') L.push(`${pad(k, 8)} ${s.at.slice(11, 19)} ${rpad(s.ms, 6)} ms ${s.err ? '[ERR] ' : ''}${s.sql.slice(0, 88)}`);
  return L.length ? L.join('\n') : '(none over the threshold)';
}
function scanText(name, now, before) {
  if (now.error) return `(${name}: ${now.error})`;
  const L = [pad('table', 20) + rpad('seq_scans', 10) + rpad('rows_read', 15) + rpad('idx_scans', 11) + rpad('live rows', 13)];
  for (const r of now) {
    const b = before && before[r.relname];
    const d = k => b ? num(Number(r[k]) - Number(b[k])) : num(r[k]) + '*';
    L.push(pad(r.relname, 20) + rpad(d('seq_scan'), 10) + rpad(d('seq_tup_read'), 15) + rpad(d('idx_scan'), 11) + rpad(num(r.n_live_tup), 13));
  }
  if (!before) L.push('* no baseline yet — cumulative since the statistics reset; the next mail shows the window');
  return L.join('\n');
}
function hitText(now, before) {
  if (!now || now.error || !now[0]) return '—';
  if (!before) return `cumulative ${(100 * Number(now[0].blks_hit) / Math.max(1, Number(now[0].blks_hit) + Number(now[0].blks_read))).toFixed(1)} % (since the statistics reset; the window figure starts with the next mail)`;
  const h = Number(now[0].blks_hit) - Number(before[0]), r = Number(now[0].blks_read) - Number(before[1]);
  return `${(100 * h / Math.max(1, h + r)).toFixed(1)} % in the window (hit ${num(h)} · read from disk ${num(r)} blocks)`;
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pre = t => `<pre style="margin:0 0 18px;padding:12px 14px;background:#f6f8fa;border:1px solid #e5e9ee;border-radius:8px;font:11px/1.45 Menlo,Consolas,'Courier New',monospace;color:#1f2937;white-space:pre-wrap;word-break:break-word;">${esc(t)}</pre>`;
const h2 = t => `<div style="font-family:Arial,sans-serif;font-size:14px;font-weight:800;color:#0f5132;margin:0 0 8px;">${esc(t)}</div>`;

async function main() {
  const notify = require(path.join(__dirname, 'src', 'notify'));
  const db = require(path.join(__dirname, 'src', 'db'));
  const now = new Date();
  const state = loadState();
  const sinceIso = state.at || null;
  const [perf, cache, version] = await Promise.all([getJson('/api/perf'), getJson('/api/cache-stats').catch(e => ({ error: e.message })), getJson('/api/version').catch(() => ({}))]);
  if (!perf || perf.uptimeMin == null) throw new Error('/api/perf did not answer with a report: ' + JSON.stringify(perf).slice(0, 200));
  const [rep, con] = await Promise.all([dbFacts(db.source, 'replica'), dbFacts(db.console, 'console')]);
  const log = readSlowLines(sinceIso ? ksaIso(sinceIso) : null);

  /* headline + verdict */
  const pools = Object.entries(perf.db || {});
  const worstWait = pools.reduce((a, [, v]) => Math.max(a, Number(v.waitPct) || 0), 0);
  const maxWaiting = pools.reduce((a, [, v]) => Math.max(a, Number(v.maxWaiting) || 0), 0);
  const loopP95 = Number(perf.loop.p95Avg60m != null ? perf.loop.p95Avg60m : (perf.loop.nowMs || {}).p95) || 0;   // the 60-min average, or the live value right after a restart
  const errs = pools.reduce((a, [, v]) => a + (Number(v.queries.errors) || 0), 0);
  const clientSlow = pools.reduce((a, [, v]) => a + (v.queries.slow || []).filter(s => s.via === 'client').length, 0);
  const watch = [];
  if (loopP95 > 30) watch.push(`event loop p95 ${loopP95} ms`);
  if (worstWait >= 1) watch.push(`pool waits ${worstWait} % (max ${maxWaiting} queued)`);
  if (log.lag) watch.push(`${log.lag} [LAG] lines`);
  if (errs) watch.push(`${errs} query errors`);
  const pill = watch.length ? 'WATCH' : 'OK';
  const windowTxt = sinceIso ? `${ksa(sinceIso)} → ${ksa(now)} KSA` : `up to ${ksa(now)} KSA (first mail — no previous window)`;
  const rows = [
    ['Window', windowTxt], ['Console', `v${version.version || '?'} · up ${perf.uptimeMin} min · node ${perf.node}`],
    ['Event loop', `p95 ${loopP95} ms (60 min avg) · worst minute ${perf.loop.maxAvg60m == null ? '—' : perf.loop.maxAvg60m} ms · stalls ${(perf.loop.stalls || []).length}`],
    ['Process', `CPU ${perf.process.cpuPct60m == null ? (perf.process.cpuPct5m == null ? '—' : perf.process.cpuPct5m) : perf.process.cpuPct60m} % of one core · RSS ${perf.process.rssMb} MB`],
    ['Requests', `${num(perf.requests.total)} since ${ksa(perf.since)} KSA (perf counters) · slow (> ${perf.slowMs} ms): ${perf.requests.slowCount} · max in flight ${perf.requests.maxInflight}`],
    ['Pools', pools.map(([k, v]) => `${k} ${v.waitPct}% (max ${v.maxWaiting})`).join(' · ')],
    ['Slow statements', `${pools.reduce((a, [, v]) => a + (v.queries.slow || []).length, 0)} over ${perf.slowQueryMs} ms (${clientSlow} on checked-out clients) · ${errs} errors`],
    ['Log', log.slow == null ? '—' : `${log.slow} [SLOW] · ${log.lag} [LAG] since the previous mail`],
    ['Cache', cache.error ? cache.error : `${cache.entries} entries · ${cache.active} kept warm · last cycle refreshed ${cache.lastWarm && cache.lastWarm.refreshed} of ${cache.lastWarm && cache.lastWarm.candidates}`],
    ['121 connections', `console db ${con.conns.error ? '—' : con.conns[0].used + '/' + con.conns[0].max_conn + ' (' + con.conns[0].active + ' active)'}`],
    ['Cache hit — console db', hitText(con.hit, state.hit && state.hit.console)],
    ['Cache hit — replica', hitText(rep.hit, state.hit && state.hit.replica)],
  ];
  const table = `<table style="border-collapse:collapse;width:100%;margin:0 0 18px;font-family:Arial,sans-serif;font-size:13px;">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#475569;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eef2f6;">${esc(k)}</td><td style="padding:6px 0;color:#0f172a;border-bottom:1px solid #eef2f6;">${esc(v)}</td></tr>`).join('')}</table>`;
  const idxText = rep.idx.error ? rep.idx.error : (rep.idx.length ? rep.idx.map(i => `${pad(i.indexrelname, 26)} scans ${rpad(num(i.idx_scan), 11)} ${rpad(i.size, 8)} ${i.valid ? 'valid' : 'NOT VALID (building or failed)'}`).join('\n') : '(none of the expected indexes exist)');
  const longText = [['console db', con.long], ['replica', rep.long]].map(([n, l]) => l.error ? `${n}: ${l.error}` : (l.length ? l.map(x => `${n}: ${x.age_s}s ${x.state} ${x.application_name || ''}\n    ${x.q.slice(0, 88)}`).join('\n') : `${n}: nothing over 3 s right now`)).join('\n');
  const sections = [
    ['Verdict', watch.length ? 'WATCH — ' + watch.join('; ') : 'OK — loop clean, no pool waits, no [LAG]'],
    ['Perf report (/api/perf)', perfText(perf)],
    ['Statements on checked-out clients (prod-sync, refund radar, index builds)', clientText(perf)],
    ['Scan deltas — replica (salam_replica on 121)', scanText('replica', rep.scans, state.scans && state.scans.replica)],
    ['Scan deltas — console db (unified_console on 121)', scanText('console', con.scans, state.scans && state.scans.console)],
    ['Console-made replica indexes', idxText],
    ['Running longer than 3 s on 121 right now', longText],
    ['[SLOW] / [LAG] log lines (last 25 of the window)', log.lines.length ? log.lines.join('\n') : '(none)'],
  ];
  const bodyHtml = table + sections.map(([t, b]) => h2(t) + pre(b)).join('') +
    `<div style="color:#94a3b8;font-family:Arial,sans-serif;font-size:12px;">Deltas are since the previous mail; this mail becomes the baseline of the next one. perfmail.cjs on 152 · read-only on 121.</div>`;
  const stamp = ksaIso(now).replace(/[-:]/g, '').replace('T', '-').slice(0, 13);     // YYYYMMDD-HHMM (KSA)
  const title = `Console performance — ${ksa(now)} KSA`;
  const subject = `[Salam Ops] Console performance — ${ksa(now)} KSA — ${pill} · loop p95 ${loopP95} ms · waits ${worstWait} % · slow requests ${perf.requests.slowCount}`;
  const html = notify.shell({ title, pill, pillColor: pill === 'OK' ? '#16a34a' : '#d97706', bodyHtml });
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + sections.map(([t, b]) => `=== ${t} ===\n${b}`).join('\n\n');

  const htmlPath = opt('--html', path.join(PERF_DIR, `PERFMAIL-${stamp}.html`));
  try { fs.mkdirSync(path.dirname(htmlPath), { recursive: true }); fs.writeFileSync(htmlPath, html); } catch (e) { console.error('[perfmail] could not save html:', e.message); }

  let to = TO === 'report' ? await notify.recipients('mail_report') : TO.split(',').map(s => s.trim()).filter(Boolean);
  let sent = { sent: false, dry: true };
  if (DRY) { console.log(text); console.log(`\n[perfmail] DRY — not sent; would go to ${JSON.stringify(to)}; html saved: ${htmlPath}`); }
  else {
    sent = await notify.sendHtml(to, subject, html, [], text);
    console.log(JSON.stringify({ sent: sent.sent, dev: sent.dev, error: sent.error, reason: sent.reason, recipients: sent.recipients, subject, html: htmlPath }, null, 1));
  }
  /* rotate the baseline so the next mail covers the window from now */
  if (ROTATE && !DRY) {
    const packScans = rows => rows.error ? undefined : Object.fromEntries(rows.map(r => [r.relname, { seq_scan: Number(r.seq_scan), seq_tup_read: Number(r.seq_tup_read), idx_scan: Number(r.idx_scan) }]));
    const packHit = h => (h && !h.error && h[0]) ? [Number(h[0].blks_hit), Number(h[0].blks_read)] : undefined;
    const next = { at: now.toISOString(), scans: { replica: packScans(rep.scans) || (state.scans || {}).replica, console: packScans(con.scans) || (state.scans || {}).console }, hit: { replica: packHit(rep.hit) || (state.hit || {}).replica, console: packHit(con.hit) || (state.hit || {}).console } };
    try { fs.mkdirSync(PERF_DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(next, null, 1)); } catch (e) { console.error('[perfmail] could not save state:', e.message); }
  }
  /* the perf counters start again now, so the next mail's /api/perf section is the window since this one */
  if (RESET && !DRY && sent.sent) { try { await getJson('/api/perf?reset=1'); } catch (e) { console.error('[perfmail] perf reset failed:', e.message); } }
  for (const k of ['source', 'console', 'ops', 'opsBeta', 'upg', 'nexus', 'payments']) { try { if (db[k] && typeof db[k].end === 'function') await db[k].end(); } catch (_) {} }
  process.exit(sent.sent || sent.dev || DRY ? 0 : 1);
}
main().catch(e => { console.error('[perfmail] failed:', e.message); process.exit(1); });
