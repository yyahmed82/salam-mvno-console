/* OSB LOG ARCHIVE — importer + correlation queries (3 Sep 2026).
 * The OSB team delivers WebLogic log archives over SFTP (/sftp_data/uploads/osb_serverX_logs_*.tar.gz,
 * sha256-verified). Two file kinds inside (discovered 3 Sep, both days verified):
 *
 *  access.log*  — WebLogic extended access log, machine-parseable:
 *                 c-ip date time time-taken cs-method ctx-ecid ctx-rid cs-uri sc-status bytes
 *                 Covers BOTH the UIL-facing proxies (/bss/subscription/…, same paths as the UIL
 *                 tier) and the BSS backends they fan into (RedkneeSoap_v3_0 = Optiva, UIM,
 *                 Siebel/BRM bridges, Arqami…). OSB answers HTTP 200 even for SOAP faults —
 *                 status is nearly useless; faults live in the .out payloads.
 *  osb_serverN.out* — oracle.osb.logging.pipeline records with FULL payloads: MSISDNs, ECID
 *                 headers (X-ORACLE-DMS-ECID — joins to access rows), OSB-382000 / <faultcode> /
 *                 errorCode 1500 details, plus ZATCA→BRM, SADAD notifications, Siebel flows.
 *
 * CORRELATION KEYS (proved by discovery): uilTransactionId / Sleuth ids DO NOT appear in OSB —
 * the chain is msisdn+time → pipeline record → ECID → access row (uri/latency/backend), and
 * upward to the UIL tier by uri+timestamp window.
 *
 * USAGE (on 152, after extracting the archives):
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/osbArchive.js import /tmp/osb        # parses + loads into console PG (idempotent)
 *   node src/osbArchive.js status
 * Import is batch-inserted, per-file try/catch (errors travel), and safe to re-run: rows carry
 * a unique key and duplicates are skipped. Raw payloads are stored TRUNCATED (600 chars; 4000
 * for fault records) — enough for diagnosis, bounded for the DB.
 * PII: Troubleshoot surfaces are L2-gated and unmasked by decision (Yosri, 3 Sep). */
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');

/* ---------- schema ---------- */
let _ensured = false;
async function ensure() {
  if (_ensured) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS osb_access_events (
    id bigserial PRIMARY KEY, ts timestamptz NOT NULL, server text, c_ip text, method text,
    ecid text, uri text, qs_msisdn text, status int, ms int, bytes bigint, batch text)`);
  await db.console.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_osb_acc ON osb_access_events (ecid, uri, ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_ts ON osb_access_events (ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_uri ON osb_access_events (uri, ts)`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS osb_pipeline_events (
    id bigserial PRIMARY KEY, ts timestamptz NOT NULL, server text, pipeline text, stage text,
    direction text, label text, ecid text, msisdns text[], fault boolean NOT NULL DEFAULT false,
    fault_kind text, payload text, batch text)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ts ON osb_pipeline_events (ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ms ON osb_pipeline_events USING gin (msisdns)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ecid ON osb_pipeline_events (ecid)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_fault ON osb_pipeline_events (ts) WHERE fault`);
  _ensured = true;
}

/* ---------- parsers ---------- */
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/* "<Sep 1, 2026 12:00:28,902 AM AST>" → ISO with the +03:00 the logs run in */
function wlTs(s) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2}),(\d{3}) (AM|PM)/.exec(s);
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[8] === 'PM') h += 12;
  const d = new Date(Date.UTC(Number(m[3]), MON[m[1]], Number(m[2]), h - 3, Number(m[5]), Number(m[6]), Number(m[7])));
  return isNaN(d) ? null : d.toISOString();
}

function parseAccessFile(file, server, batch) {
  const rows = [];
  const txt = fs.readFileSync(file, 'utf8');
  for (const line of txt.split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 9) continue;
    // c-ip date time taken method ecid rid uri status bytes
    const ts = `${p[1]}T${p[2]}+03:00`;
    const uriFull = p[7] || '';
    const q = /[?&]msisdn=(\d{9,15})/.exec(uriFull);
    rows.push({ ts, server, c_ip: p[0], method: p[4], ecid: p[5],
      uri: uriFull.replace(/\?.*$/, '').slice(0, 200), qs_msisdn: q ? q[1] : null,
      status: Number(p[8]) || null, ms: Math.round(parseFloat(p[3]) * 1000) || 0,
      bytes: Number(p[9]) || null, batch });
  }
  return rows;
}

const FAULT_RE = /OSB-382000|<faultcode|errorCode>\s*1500|<soapenv:Fault|<soap:Fault/i;
function parseOutFile(file, server, batch) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  // split on the WebLogic record marker "<Mon D, YYYY …>"; spring-style lines are kept inside
  // the preceding record's payload (they are continuations of the stream, e.g. SADAD controller)
  const parts = txt.split(/\n(?=<[A-Z][a-z]{2} \d{1,2}, 20\d{2} )/);
  for (const rec of parts) {
    const ts = wlTs(rec.replace(/^</, ''));
    if (!ts) continue;
    // "< [Pipeline, request-id, Stage, REQUEST] label: payload>"
    const hm = /<\s*\[([^,\]]+),\s*([^,\]]*),\s*([^,\]]*),\s*(REQUEST|RESPONSE)\]\s*([^:>]{0,120}):?/.exec(rec);
    const pipeline = hm ? hm[1].trim().slice(0, 80) : 'osb';
    const stage = hm ? hm[3].trim().slice(0, 60) : null;
    const direction = hm ? hm[4] : null;
    const label = hm ? hm[5].trim().slice(0, 140) : rec.slice(0, 100).replace(/\s+/g, ' ');
    const ecid = (/X-ORACLE-DMS-ECID" value="([\w-]+)"/.exec(rec) || [])[1] || null;
    const msisdns = [...new Set((rec.match(/9665\d{8}/g) || []))].slice(0, 8);
    const fault = FAULT_RE.test(rec);
    const fault_kind = fault
      ? (/OSB-382000/.test(rec) ? 'OSB-382000' : /errorCode>\s*1500/.test(rec) ? '1500' : 'soap-fault') : null;
    rows.push({ ts, server, pipeline, stage, direction, label, ecid, msisdns, fault, fault_kind,
      payload: rec.slice(0, fault ? 4000 : 600), batch });
  }
  return rows;
}

/* ---------- bulk load ---------- */
async function insertBatch(table, cols, rows) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [], ph = [];
    chunk.forEach((r, j) => {
      ph.push('(' + cols.map((c, k) => `$${j * cols.length + k + 1}`).join(',') + ')');
      cols.forEach(c => vals.push(r[c]));
    });
    const conflict = table === 'osb_access_events' ? ' ON CONFLICT (ecid, uri, ts) DO NOTHING' : '';
    const res = await db.console.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')}${conflict}`, vals);
    n += res.rowCount || 0;
  }
  return n;
}

async function importDir(dir) {
  await ensure();
  const out = { files: 0, access_rows: 0, pipeline_rows: 0, errors: [] };
  const walk = d => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(dir);
  const batch = path.basename(dir) + '@' + new Date().toISOString().slice(0, 10);
  for (const f of files) {
    const server = /osb_server(\d)/.exec(f) ? 'osb_server' + /osb_server(\d)/.exec(f)[1]
      : /\/s(\d)\//.exec(f) ? 'osb_server' + /\/s(\d)\//.exec(f)[1] : '?';
    try {
      const base = path.basename(f);
      if (/^access\.log/.test(base)) {
        const rows = parseAccessFile(f, server, batch);
        out.access_rows += await insertBatch('osb_access_events',
          ['ts', 'server', 'c_ip', 'method', 'ecid', 'uri', 'qs_msisdn', 'status', 'ms', 'bytes', 'batch'], rows);
        out.files++;
      } else if (/\.out\d*/.test(base)) {
        const rows = parseOutFile(f, server, batch);
        out.pipeline_rows += await insertBatch('osb_pipeline_events',
          ['ts', 'server', 'pipeline', 'stage', 'direction', 'label', 'ecid', 'msisdns', 'fault', 'fault_kind', 'payload', 'batch'], rows);
        out.files++;
      }
      if (out.files % 10 === 0) console.log(`[osb-archive] ${out.files} files · ${out.access_rows} access · ${out.pipeline_rows} pipeline`);
    } catch (e) { out.errors.push(`${path.basename(f)}: ${e.message.slice(0, 140)}`); }
  }
  return out;
}

/* ---------- queries (console PG only — instant) ---------- */
async function status() {
  await ensure();
  const a = (await db.console.query(
    `SELECT count(*)::bigint n, min(ts) lo, max(ts) hi FROM osb_access_events`)).rows[0];
  const p = (await db.console.query(
    `SELECT count(*)::bigint n, count(*) FILTER (WHERE fault)::bigint faults, min(ts) lo, max(ts) hi
       FROM osb_pipeline_events`)).rows[0];
  return { access: a, pipeline: p };
}

async function topology({ from, to } = {}) {
  await ensure();
  const w = from && to ? `WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const params = from && to ? [from, to] : [];
  return (await db.console.query(
    `SELECT uri, count(*)::bigint calls, (avg(ms))::int avg_ms, max(ms) max_ms,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY ms)::int p95_ms
       FROM osb_access_events ${w} GROUP BY uri ORDER BY calls DESC LIMIT 60`, params)).rows;
}

async function faults({ from, to, limit = 60 } = {}) {
  await ensure();
  const w = from && to ? `AND ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const params = from && to ? [from, to] : [];
  const list = (await db.console.query(
    `SELECT ts, server, pipeline, stage, label, ecid, msisdns, fault_kind, left(payload, 1200) payload
       FROM osb_pipeline_events WHERE fault ${w} ORDER BY ts DESC LIMIT ${Math.min(300, limit)}`, params)).rows;
  const byKind = (await db.console.query(
    `SELECT fault_kind, count(*)::bigint n FROM osb_pipeline_events WHERE fault ${w} GROUP BY 1`, params)).rows;
  return { byKind, list };
}

/* everything OSB saw for one customer in a window — the journey feed */
async function eventsFor(msisdn, fromIso, toIso, limit = 80) {
  await ensure();
  const m = String(msisdn || '').replace(/\D/g, '');
  const norm = /^05\d{8}$/.test(m) ? '966' + m.slice(1) : /^5\d{8}$/.test(m) ? '966' + m : m;
  if (!/^9665\d{8}$/.test(norm)) return [];
  const pipe = (await db.console.query(
    `SELECT ts, server, pipeline, stage, direction, label, ecid, fault, fault_kind, left(payload, 900) payload
       FROM osb_pipeline_events
      WHERE msisdns @> ARRAY[$1] AND ts >= $2::timestamptz AND ts < $3::timestamptz
      ORDER BY ts LIMIT ${Math.min(200, limit)}`, [norm, fromIso, toIso])).rows;
  // pull the access rows for the same ECIDs (uri + latency + backend for each hop)
  const ecids = [...new Set(pipe.map(x => x.ecid).filter(Boolean))].slice(0, 100);
  let acc = [];
  if (ecids.length) acc = (await db.console.query(
    `SELECT ts, ecid, uri, method, status, ms FROM osb_access_events WHERE ecid = ANY($1) ORDER BY ts`, [ecids])).rows;
  // plus direct query-string hits (Siebel bridges carry ?msisdn=)
  const qs = (await db.console.query(
    `SELECT ts, ecid, uri, method, status, ms FROM osb_access_events
      WHERE qs_msisdn = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz ORDER BY ts LIMIT 60`,
    [norm, fromIso, toIso])).rows;
  return { pipeline: pipe, access: acc, access_by_msisdn: qs };
}

const available = async () => { try { await ensure(); const r = await db.console.query(`SELECT 1 FROM osb_pipeline_events LIMIT 1`); return !!r.rows.length; } catch (e) { return false; } };

/* ---- ORACLE STACK FLOW (dashboard POC, 3 Sep) ------------------------------------------------
 * Classify every OSB access row into the HLD's Oracle components by URI (order matters — the
 * Siebel→BRM bridges contain both names; ZATCA before BRM for the same reason), and count the
 * pipeline-only flows (ZATCA conversions, SADAD notifications) + faults per component. */
const STACK = [
  { key: 'zatca',   label: 'ZATCA e-invoicing',        re: /zatca/i },
  { key: 'redknee', label: 'Redknee · charging (ECE)', re: /redknee/i },
  { key: 'uim',     label: 'UIM · inventory',          re: /uim/i },
  { key: 'arqami',  label: 'Arqami',                   re: /arqami/i },
  { key: 'siebel',  label: 'Siebel CRM',               re: /siebel|appcrm/i },
  { key: 'brm',     label: 'BRM · billing',            re: /brm/i },
  { key: 'proxy',   label: 'OSB proxy (UIL-facing)',   re: /^\/(bss|uil)\/|^\/get[a-z]+(subscription|account|balance)/i }
];
const sqlCase = col => 'CASE ' + STACK.map(s =>
  `WHEN ${col} ~* '${s.re.source.replace(/'/g, "''")}' THEN '${s.key}'`).join(' ') + ` ELSE 'other' END`;

async function stack({ from = null, to = null } = {}) {
  await ensure();
  const st = await status();
  /* PERF (3 Sep): grouping 6M rows by a regex CASE plus percentile sorts took tens of seconds
   * and froze the dashboard while the import was still writing. Instead: ONE hash-aggregate
   * GROUP BY uri (few dozen distinct URIs) and classify the small result in JS. No percentile
   * here — the dashboard shows avg/max; p95 stays in /api/osb/archive/topology on demand.
   * WINDOWED (3 Sep pm): from/to filter every count, so the dashboard date range drives the
   * section — POC on the archive today, unchanged when the watcher makes it a rolling feed. */
  const W = from && to ? ` WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const P = from && to ? [from, to] : [];
  const perUri = (await db.console.query(
    `SELECT uri, count(*)::bigint calls, sum(ms)::bigint ms_sum, max(ms) max_ms
       FROM osb_access_events${W} GROUP BY uri`, P)).rows;
  const compMap = {};
  for (const r of perUri) {
    let key = 'other';
    for (const s of STACK) if (s.re.test(r.uri)) { key = s.key; break; }
    const c = compMap[key] || (compMap[key] = { calls: 0, ms_sum: 0, max_ms: 0 });
    c.calls += Number(r.calls); c.ms_sum += Number(r.ms_sum); c.max_ms = Math.max(c.max_ms, Number(r.max_ms || 0));
  }
  const comps = Object.entries(compMap).map(([comp, c]) => ({ comp, calls: c.calls,
    avg_ms: c.calls ? Math.round(c.ms_sum / c.calls) : null, p95_ms: null, max_ms: c.max_ms }));
  const WF = from && to ? ` AND ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const pfaults = (await db.console.query(
    `SELECT ${sqlCase("coalesce(pipeline,'') || ' ' || coalesce(label,'') || ' ' || coalesce(stage,'')")} AS comp,
            count(*)::bigint n FROM osb_pipeline_events WHERE fault${WF} GROUP BY 1`, P)).rows;
  const pflows = (await db.console.query(
    `SELECT ${sqlCase("coalesce(pipeline,'') || ' ' || coalesce(label,'')")} AS comp, count(*)::bigint n
       FROM osb_pipeline_events WHERE true${WF} GROUP BY 1`, P)).rows;
  const sadad = (await db.console.query(
    `SELECT count(*)::bigint n FROM osb_pipeline_events WHERE payload ILIKE '%sadad%'${WF}`, P)).rows[0];
  const byKey = k => ({
    ...(comps.find(c => c.comp === k) || { calls: 0, avg_ms: null, p95_ms: null, max_ms: null }),
    faults: Number((pfaults.find(c => c.comp === k) || {}).n || 0),
    pipeline_records: Number((pflows.find(c => c.comp === k) || {}).n || 0)
  });
  const winCalls = comps.reduce((a, c) => a + c.calls, 0);
  const winFaults = pfaults.reduce((a, c) => a + Number(c.n), 0);
  return {
    ok: true, window: { lo: st.access.lo, hi: st.access.hi },        // full ARCHIVE span (the UI's honesty note)
    filtered: !!(from && to), from, to,
    totals: { access: winCalls, pipeline: pflows.reduce((a, c) => a + Number(c.n), 0), faults: winFaults },
    entry: byKey('proxy'),
    components: STACK.filter(s => s.key !== 'proxy').map(s => ({ key: s.key, label: s.label, ...byKey(s.key) })),
    other: byKey('other'),
    sadad_notifications: Number(sadad.n || 0)
  };
}

/* ALERT WATCH — `osb:fault-surge` (P3, day-1-lag aware). Compares the LAST FULL DAY of data
 * against the prior-days baseline; a FRESHNESS GATE (newest row < 48h old) keeps a stale
 * archive silent and arms the rule automatically once the SFTP feed becomes daily. */
async function faultWatch() {
  await ensure();
  const fresh = (await db.console.query(`SELECT max(ts) hi FROM osb_pipeline_events`)).rows[0];
  const now = new Date().toISOString();
  const key = 'osb:fault-surge';
  const resolveOpen = async () => db.console.query(
    `UPDATE alerts SET status='resolved', resolved_at=$2 WHERE status='open' AND rule_key=$1`, [key, now]);
  if (!fresh.hi || Date.now() - new Date(fresh.hi).getTime() > 48 * 3600e3) { await resolveOpen(); return { stale: true }; }
  const days = (await db.console.query(
    `SELECT date_trunc('day', ts) d, count(*) FILTER (WHERE fault)::int faults FROM osb_pipeline_events
      GROUP BY 1 ORDER BY 1`)).rows;
  if (days.length < 2) { await resolveOpen(); return { days: days.length }; }
  const last = days[days.length - 1], base = days.slice(0, -1);
  const baseAvg = base.reduce((a, d) => a + d.faults, 0) / base.length;
  const trip = last.faults >= 100 && last.faults >= 1.5 * Math.max(1, baseAvg);
  if (!trip) { await resolveOpen(); return { last: last.faults, base: Math.round(baseAvg) }; }
  const cur = (await db.console.query(
    `SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  const msg = `OSB faults on ${String(last.d).slice(0, 10)}: ${last.faults} vs a ${Math.round(baseAvg)}/day baseline `
    + `(OSB-382000 / SOAP faults from the imported OSB logs — data arrives with up to a day's lag). `
    + `Drill: Monitoring → Gateway & API → OSB panel fault feed; correlate with the BSS 1500 watch.`;
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
       peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, last.faults, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,$2,'P3','Digital Ops','open',$3,'>=',$4,$5,$6,24,$7,$8,$9,$9,$5,1)`,
    [key, 'OSB fault surge (day-lag data)', 'osb_fault_surge', Math.round(1.5 * baseAvg), last.faults,
     JSON.stringify({ day: String(last.d).slice(0, 10), baseline: Math.round(baseAvg) }), 'osb', msg, now]);
  return { tripped: true, last: last.faults, base: Math.round(baseAvg) };
}

module.exports = { importDir, status, topology, faults, eventsFor, available, stack, faultWatch, parseAccessFile, parseOutFile, wlTs };

/* ---------- CLI ---------- */
if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'import') {
      if (!arg || !fs.existsSync(arg)) { console.error('usage: node src/osbArchive.js import /tmp/osb'); process.exit(1); }
      const t0 = Date.now();
      const r = await importDir(arg);
      console.log(JSON.stringify(r, null, 2), `\n${Math.round((Date.now() - t0) / 1000)}s`);
    } else if (cmd === 'status') console.log(JSON.stringify(await status(), null, 2));
    else console.error('commands: import <dir> | status');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
