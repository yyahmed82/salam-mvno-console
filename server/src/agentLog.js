/* agentLog.js — AGENT 1 · LOG INTELLIGENCE (separate PM2 service `salam-agent-log`, 10 Sep 2026).
 *
 * Loop (every AGENT_LOG_INTERVAL_MIN, default 15): take the increment of what the collectors already store in
 * the console DB — api_error_events (app errors from 17/18), api_traffic_events technical failures, alerts —
 * AND, since 15 Sep 2026, the FIXED side straight from the two sda_ops read models (see ingestFixed): the
 * error board's error_events and the integration calls in api_calls, for all four channels — SDA and QR from
 * sda_ops.public, Web e-purchase and the Salam Home app from sda_ops.beta. Until then the agent had only ever
 * seen MVNO rows, so nothing on Fixed was being triaged at all; signatures carry segment 'mvno' or 'fixed'.
 * fold it into SIGNATURES (a signature = source + endpoint/controller + code + the message with digits, ids
 * and hex masked out), keep first/last seen, counts, hosts and one sample per signature in agent_signatures,
 * and ask the LLM ONLY about signatures never seen before (batches of ≤ 15, JSON out): category from the console
 * taxonomy, class (business/technical), severity hint, probable cause, suggested owner team, one-line runbook.
 * Deterministic work (dedup, counting, retention, roll-ups) never touches the model, which is what keeps a
 * CPU-only 8B model viable: on a normal day there are a handful of new signatures, not thousands of lines.
 *
 * Every night at REPORT_HOUR KSA (default 06:00) it writes agent_reports (kind 'daily-log'): top signatures,
 * new signatures with their LLM assessment, hourly volume, error-class split, and mails it (PDF+XLSX via the
 * console's exporters) to the Mail-report audience. The console shows the same data in Settings › Agents.
 *
 * Runs with the console's own modules (db, llm, notify, xlsx, pdfout) and .env; it never writes to the
 * production or replica DBs, only to unified_console. Disable with AGENT_LOG_ENABLED=0 (process idles). */
'use strict';
process.env.TZ = process.env.TZ || 'UTC';
const db = require('./db');
const llm = require('./llm');

const CFG = {
  enabled: process.env.AGENT_LOG_ENABLED !== '0',
  intervalMin: Math.max(2, Number(process.env.AGENT_LOG_INTERVAL_MIN) || 15),
  reportHour: Number.isFinite(Number(process.env.AGENT_LOG_REPORT_HOUR)) ? Number(process.env.AGENT_LOG_REPORT_HOUR) : 6,   // KSA
  llmBatch: 15, maxNewPerTick: 60, retentionDays: 180,
};
const log = (...a) => console.log(`[AGENT-LOG] ${new Date().toISOString()}`, ...a);

/* ---- schema ---- */
async function ensureSchema() {
  const C = db.console;
  await C.query(`CREATE TABLE IF NOT EXISTS agent_signatures (
      id bigserial PRIMARY KEY, sig_hash text UNIQUE NOT NULL, source text NOT NULL, segment text NOT NULL DEFAULT 'mvno',
      endpoint text, code text, message_pattern text, sample text, hosts text[] NOT NULL DEFAULT '{}',
      first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, total bigint NOT NULL DEFAULT 0, last_24h integer NOT NULL DEFAULT 0,
      class text, category text, severity_hint text, probable_cause text, owner_team text, runbook text, assessed_by text, assessed_at timestamptz, confidence real,
      status text NOT NULL DEFAULT 'new', reviewed_by text, reviewed_at timestamptz, note text)`);
  await C.query(`CREATE INDEX IF NOT EXISTS idx_agent_sig_last ON agent_signatures (last_seen DESC)`);
  await C.query(`CREATE TABLE IF NOT EXISTS agent_state (key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now())`);
  await C.query(`CREATE TABLE IF NOT EXISTS agent_reports (
      id bigserial PRIMARY KEY, kind text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
      summary jsonb NOT NULL DEFAULT '{}', narrative text, mailed_to integer, created_at timestamptz NOT NULL DEFAULT now())`);
  await C.query(`CREATE TABLE IF NOT EXISTS agent_runs (id bigserial PRIMARY KEY, agent text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, ok boolean, stats jsonb NOT NULL DEFAULT '{}', error text)`);
}
const getState = async k => ((await db.console.query(`SELECT value FROM agent_state WHERE key=$1`, [k])).rows[0] || {}).value || {};
const setState = (k, v) => db.console.query(`INSERT INTO agent_state (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [k, JSON.stringify(v)]);

/* ---- signatures ---- */
const crypto = require('crypto');
const normalise = s => String(s || '').replace(/\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>').replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
  .replace(/\b9665\d{8}\b|\b05\d{8}\b/g, '<msisdn>').replace(/\b[12]\d{9}\b/g, '<nid>').replace(/\b\d{6,}\b/g, '<n>').replace(/\b\d+\b/g, '<d>').slice(0, 300);
const hashOf = (...parts) => crypto.createHash('sha1').update(parts.map(x => String(x || '')).join('|')).digest('hex').slice(0, 20);

/* ---- FIXED sources: the two sda_ops read models ----------------------------------------------
 * sda_ops.public (db.ops)   → channels sda + qr        · the dealer world
 * sda_ops.beta   (db.opsBeta) → channels web + salamhome · Web e-purchase + the Salam Home app
 * Partitioned exactly like the Fixed error board (fixedErrors.js SRC_BUCKETS) so nothing is counted twice.
 * Read-only: this agent never writes to sda_ops, only to unified_console.
 *
 * Watermark: sda_ops is a LAGGING source — ops-ingest-watch can stall and then backfill rows whose
 * occurred_at is already in the past. Advancing the cursor to "now" like the console-DB sources do would
 * skip every one of those permanently, so the fixed cursor advances to the newest row actually SEEN
 * (capped at now). It never runs ahead of the data, so a late batch is still picked up on a later tick. */
const FIXED_POOLS = () => [
  { src: 'ops', label: 'sda_ops.public', pool: db.ops },
  { src: 'beta', label: 'sda_ops.beta', pool: db.opsBeta },
].filter(x => x.pool);
/* which channel buckets each read model owns — same split the error board uses */
const FIXED_BUCKETS = { ops: ['sda', 'qr'], beta: ['web', 'salamhome'] };
const CHANNEL_SQL = `CASE WHEN e.channel='sda' THEN 'sda' WHEN e.channel='salamhome' THEN 'salamhome'
                          WHEN e.referral_code IS NOT NULL THEN 'qr' ELSE 'web' END`;
const API_FAMILY = `regexp_replace(regexp_replace(split_part(ac.endpoint,'?',1),'^https?://[^/]+',''),'/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*','/{id}','g')`;

async function ingestFixed(since, now, add) {
  let newest = null, rows = 0; const per = [];
  const pools = FIXED_POOLS(), both = pools.length > 1;
  const API_SRC = pools.some(x => x.src === 'ops') ? 'ops' : (pools[0] && pools[0].src);
  for (const { src, label, pool } of pools) {
    /* with only one read model configured it serves every channel, exactly like the error board */
    const buckets = both ? FIXED_BUCKETS[src] : ['sda', 'qr', 'web', 'salamhome'];
    const bucketWhere = `AND ${CHANNEL_SQL} IN (${buckets.map(b => `'${b}'`).join(',')})`;
    let e = 0, a = 0;
    try {
      const er = (await pool.query(
        `SELECT e.occurred_at, e.category, e.code, e.message, e.step, e.client_side, ${CHANNEL_SQL} AS channel
           FROM error_events e
          WHERE e.occurred_at > $1 AND e.occurred_at <= $2 ${bucketWhere}
          ORDER BY e.occurred_at LIMIT 100000`, [since, now])).rows;
      for (const r of er) {
        /* the endpoint slot carries channel + the journey step, which is what makes a Fixed signature
         * actionable — "salamhome · ePurchaseSubmitOrder" rather than a bare category */
        add('fixed-error', 'fixed', `${r.channel} · ${r.step || r.category || '?'}`,
          r.code != null ? r.code : r.category, r.message || r.category,
          r.message, label, r.occurred_at);
        if (!newest || r.occurred_at > newest) newest = r.occurred_at;
      }
      e = er.length; rows += e;
    } catch (err) { log(`fixed ${label} error_events failed:`, err.message); per.push({ src, label, error: err.message }); }
    /* api_calls is read from ONE read model only. It has no channel column to partition on, so reading it
     * from both would fold the same call into one signature twice and double its count. The public read
     * model is the one that ingests api_logs (beta runs with DB_WATCH_API_LOGS=0, see fixedChannel.js). */
    if (src === API_SRC) {
      try {
        /* integration failures behind those journeys — Yakeen/ELM, Nafath, BSS, payments, geo */
        const ar = (await pool.query(
          `SELECT ac.created_at, ${API_FAMILY} AS family, ac.status, ac.error_class
             FROM api_calls ac
            WHERE ac.created_at > $1 AND ac.created_at <= $2
              AND (ac.status >= 400 OR ac.error_class IS NOT NULL)
            ORDER BY ac.created_at LIMIT 100000`, [since, now])).rows;
        for (const r of ar) {
          add('fixed-api', 'fixed', r.family, r.status, r.error_class || `HTTP ${r.status}`, r.error_class, label, r.created_at);
          if (!newest || r.created_at > newest) newest = r.created_at;
        }
        a = ar.length; rows += a;
      } catch (err) { log(`fixed ${label} api_calls failed:`, err.message); }
    }
    per.push({ src, label, buckets, errorEvents: e, apiFailures: a, apiCallsRead: src === API_SRC });
  }
  const cursor = newest && newest < now ? newest : (rows ? now : since);
  return { rows, cursor, sources: per };
}

async function ingest(since, now, fixedSince) {
  const C = db.console; let events = 0; const seen = new Map();
  const add = (src, seg, endpoint, code, msg, sample, host, ts) => {
    const pattern = normalise(msg); const h = hashOf(src, endpoint, code, pattern);
    const e = seen.get(h) || { h, src, seg, endpoint, code: code == null ? null : String(code), pattern, sample: String(sample || msg || '').slice(0, 600), hosts: new Set(), first: ts, last: ts, n: 0 };
    e.n++; if (host) e.hosts.add(host); if (ts < e.first) e.first = ts; if (ts > e.last) e.last = ts; seen.set(h, e); events++;
  };
  const errs = (await C.query(`SELECT ts, host, error_code, http_status, source, controller, action, message FROM api_error_events WHERE ts > $1 AND ts <= $2 ORDER BY ts LIMIT 200000`, [since, now])).rows;
  for (const r of errs) add('app-error', 'mvno', [r.controller, r.action].filter(Boolean).join('#') || r.source || '?', r.error_code != null ? r.error_code : r.http_status, r.message, r.message, r.host, r.ts);
  const tech = (await C.query(`SELECT ts, host, path, response_code, response_message FROM api_traffic_events WHERE ts > $1 AND ts <= $2 AND err_class='technical' ORDER BY ts LIMIT 200000`, [since, now])).rows;
  for (const r of tech) add('api-technical', 'mvno', r.path, r.response_code, r.response_message, r.response_message, r.host, r.ts);
  /* the Fixed half — same signature/dedup/LLM path, its own lagging-source watermark */
  const fx = FIXED_POOLS().length
    ? await ingestFixed(fixedSince || since, now, add)
    : { rows: 0, cursor: null, sources: [], note: 'no sda_ops read model configured (OPS_DATABASE_URL / OPS_BETA_DATABASE_URL unset) — Fixed is not being triaged' };
  if (fx.note) log(fx.note);
  let upserts = 0; const fresh = [];
  for (const e of seen.values()) {
    const r = await C.query(`INSERT INTO agent_signatures (sig_hash, source, segment, endpoint, code, message_pattern, sample, hosts, first_seen, last_seen, total, last_24h)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::bigint,$12::integer)
        ON CONFLICT (sig_hash) DO UPDATE SET last_seen=GREATEST(agent_signatures.last_seen, EXCLUDED.last_seen), total=agent_signatures.total+EXCLUDED.total,
          last_24h=CASE WHEN agent_signatures.last_seen >= now() - interval '24 hours' THEN agent_signatures.last_24h + EXCLUDED.last_24h ELSE EXCLUDED.last_24h END,
          hosts=(SELECT array_agg(DISTINCT x) FROM unnest(agent_signatures.hosts || EXCLUDED.hosts) x), sample=COALESCE(agent_signatures.sample, EXCLUDED.sample)
        RETURNING id, (xmax = 0) AS inserted`, [e.h, e.src, e.seg, e.endpoint, e.code, e.pattern, e.sample, [...e.hosts], e.first, e.last, e.n, e.n]);
    upserts++; if (r.rows[0].inserted) fresh.push(r.rows[0].id);
  }
  await C.query(`UPDATE agent_signatures s SET last_24h = 0 WHERE last_seen < now() - interval '24 hours' AND last_24h <> 0`).catch(() => {});
  return { events, signatures: seen.size, upserts, fresh, fixed: fx };
}

/* ---- LLM assessment of NEW signatures only ---- */
const SYSTEM = `You are the log-intelligence agent of the Salam Operations Console (Saudi telecom: MVNO mobile + fixed FTTH/5G digital platforms).
You receive NEW error signatures observed in production logs, from either platform. For each, answer as an operations engineer would, briefly and concretely.
Each signature carries a SEGMENT.
 - segment "mvno" = the MVNO mobile platform. Categories (use one): payment, activation, onboarding, nafath, semati, eligibility, recharge, delivery, auth, api, app, infrastructure, other.
 - segment "fixed" = the fixed FTTH / 5G platform, across four channels named in the endpoint: sda (dealer app), qr (referral e-purchase), web (Web e-purchase), salamhome (the Salam Home consumer app).
   Categories (use one): payment_not_notified, provision_no_order, payment_failed, oss_exception, landline_lock_failed, nafath_timeout, nafath_failed, semati_failed, yakeen_failed, eligibility_failed, coverage_failed, bss_exception, api, app, infrastructure, other.
   Yakeen/ELM and Nafath are national identity providers: an identity refusal (not eligible, record not found, mismatch) is BUSINESS; a timeout, 5xx or TLS/connection failure reaching them is TECHNICAL.
Class: "business" = the platform correctly refused something (policy, validation, duplicate, insufficient balance); "technical" = the platform or a provider failed (timeout, 5xx, exception, connection reset, TLS).
Owner teams: Digital Ops, BSS, OSS, Payments, Identity, Platform, Sales Ops.
Return ONLY a JSON object: {"items":[{"id":<id>,"category":"...","class":"business|technical","severity_hint":"P1|P2|P3|info","probable_cause":"<= 25 words","owner_team":"...","runbook":"<= 30 words, one concrete first check","confidence":0.0-1.0}]}`;

async function assess(ids) {
  if (!ids.length) return { assessed: 0, batches: 0, errors: 0 };
  const C = db.console; let assessed = 0, batches = 0, errors = 0;
  const rows = (await C.query(`SELECT id, source, segment, endpoint, code, message_pattern, sample, total, hosts FROM agent_signatures WHERE id = ANY($1::bigint[]) AND assessed_at IS NULL ORDER BY total DESC LIMIT $2`, [ids, CFG.maxNewPerTick])).rows;
  for (let i = 0; i < rows.length; i += CFG.llmBatch) {
    const batch = rows.slice(i, i + CFG.llmBatch); batches++;
    const user = `New signatures (${batch.length}):\n` + batch.map(r => `- id ${r.id} · segment ${r.segment} · source ${r.source} · endpoint ${r.endpoint || '?'} · code ${r.code || '?'} · seen ${r.total}× on ${(r.hosts || []).join(',') || '?'}\n  pattern: ${r.message_pattern}\n  sample: ${String(r.sample || '').slice(0, 220)}`).join('\n');
    try {
      const out = await llm.chat({ system: SYSTEM, user, purpose: 'agent-log.assess', caller: 'salam-agent-log', json: true, maxTokens: 900, numCtx: 8192, temperature: 0.1 });
      const items = (out.json && Array.isArray(out.json.items)) ? out.json.items : [];
      for (const it of items) {
        const row = batch.find(b => Number(b.id) === Number(it.id)); if (!row) continue;
        await C.query(`UPDATE agent_signatures SET class=$2, category=$3, severity_hint=$4, probable_cause=$5, owner_team=$6, runbook=$7, confidence=$8, assessed_by=$9, assessed_at=now(), status='assessed' WHERE id=$1`,
          [row.id, /^tech/i.test(it.class) ? 'technical' : 'business', String(it.category || 'other').toLowerCase().slice(0, 40), String(it.severity_hint || 'info').slice(0, 6), String(it.probable_cause || '').slice(0, 400), String(it.owner_team || '').slice(0, 60), String(it.runbook || '').slice(0, 400), Number(it.confidence) || null, `${out.provider}:${out.model}`]);
        assessed++;
      }
      if (!items.length) { errors++; log('assess: model returned no items', out.jsonError || '', (out.text || '').slice(0, 120)); }
    } catch (e) { errors++; log('assess batch failed:', e.message); if (e.llm) break; }
  }
  return { assessed, batches, errors };
}

/* ---- daily report ---- */
async function dailyReport(now) {
  const C = db.console; const end = now, start = new Date(now.getTime() - 24 * 3600e3);
  const top = (await C.query(`SELECT source, endpoint, code, message_pattern, class, category, severity_hint, probable_cause, owner_team, total, last_24h, first_seen, last_seen, status FROM agent_signatures WHERE last_seen >= $1 ORDER BY last_24h DESC, total DESC LIMIT 40`, [start])).rows;
  const fresh = (await C.query(`SELECT source, endpoint, code, message_pattern, class, category, severity_hint, probable_cause, owner_team, runbook, confidence, total FROM agent_signatures WHERE first_seen >= $1 ORDER BY total DESC LIMIT 40`, [start])).rows;
  const hourly = (await C.query(`SELECT date_trunc('hour', ts AT TIME ZONE 'Asia/Riyadh') AS h, count(*)::int AS n FROM api_error_events WHERE ts >= $1 AND ts < $2 GROUP BY 1 ORDER BY 1`, [start, end])).rows;
  const split = (await C.query(`SELECT coalesce(class,'unassessed') AS class, count(*)::int AS signatures, sum(last_24h)::bigint AS events FROM agent_signatures WHERE last_seen >= $1 GROUP BY 1`, [start])).rows;
  /* per-platform split: the report has to show Fixed separately or a Fixed regression stays invisible
   * inside an MVNO-dominated total (Fixed was not collected at all before 15 Sep 2026) */
  const bySegment = (await C.query(`SELECT segment, count(*)::int AS signatures, sum(last_24h)::bigint AS events,
      count(*) FILTER (WHERE first_seen >= $1)::int AS new_signatures,
      count(*) FILTER (WHERE class='technical')::int AS technical
    FROM agent_signatures WHERE last_seen >= $1 GROUP BY 1 ORDER BY 3 DESC NULLS LAST`, [start])).rows;
  const bySource = (await C.query(`SELECT segment, source, count(*)::int AS signatures, sum(last_24h)::bigint AS events
    FROM agent_signatures WHERE last_seen >= $1 GROUP BY 1,2 ORDER BY 4 DESC NULLS LAST LIMIT 12`, [start])).rows;
  const alerts = (await C.query(`SELECT severity, count(*)::int AS n, count(*) FILTER (WHERE ack_at IS NOT NULL)::int AS acked FROM alerts WHERE fired_at >= $1 AND fired_at < $2 GROUP BY 1 ORDER BY 1`, [start, end])).rows;
  let narrative = '';
  try {
    const out = await llm.chat({ system: 'You write the 6-line morning note of a telecom digital-operations log report. Plain English, no bullet symbols, concrete numbers, name the top problem first, end with the one thing to do today.',
      user: `Period: last 24 h to ${end.toISOString()}.\nError-class split: ${JSON.stringify(split)}\nAlerts by severity: ${JSON.stringify(alerts)}\nTop signatures: ${top.slice(0, 8).map(t => `${t.endpoint || t.source} code ${t.code || '-'} ×${t.last_24h} (${t.class || '?'}/${t.category || '?'}: ${t.probable_cause || 'not assessed'})`).join('; ')}\nNew signatures: ${fresh.length}`,
      purpose: 'agent-log.report', caller: 'salam-agent-log', maxTokens: 260, temperature: 0.3 });
    narrative = out.text;
  } catch (e) { narrative = `(narrative unavailable: ${e.message})`; }
  const summary = { top, fresh, hourly, split, bySegment, bySource, alerts, signatures_total: (await C.query(`SELECT count(*)::int n FROM agent_signatures`)).rows[0].n };
  const rep = (await C.query(`INSERT INTO agent_reports (kind, period_start, period_end, summary, narrative) VALUES ('daily-log',$1,$2,$3,$4) RETURNING id`, [start, end, JSON.stringify(summary), narrative])).rows[0];
  let mailed = 0;
  try {
    const notify = require('./notify'); const xlsx = require('./xlsx'); const ksa = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
    /* Audience = SUPER ADMINS ONLY (raw endpoints, unassessed causes — not a vendor/management report).
     * AGENT_REPORT_TO=a@salam.sa,b@salam.sa in .env replaces that list explicitly. */
    let to = String(process.env.AGENT_REPORT_TO || '').split(/[,\s;]+/).filter(x => /@/.test(x)).map(email => ({ email }));
    if (!to.length) to = (await C.query(`SELECT email, name FROM console_users WHERE enabled = true AND (role = 'super_admin' OR 'super_admin' = ANY(coalesce(roles, '{}'))) ORDER BY email`)).rows;
    const rowsTop = [['Source', 'Endpoint', 'Code', 'Class', 'Category', 'Severity', 'Events 24h', 'Total', 'First seen', 'Last seen', 'Probable cause', 'Owner', 'Pattern']].concat(top.map(t => [t.source, t.endpoint, t.code, t.class, t.category, t.severity_hint, t.last_24h, Number(t.total), ksa(t.first_seen), ksa(t.last_seen), t.probable_cause, t.owner_team, t.message_pattern]));
    const rowsNew = [['Source', 'Endpoint', 'Code', 'Class', 'Category', 'Severity', 'Total', 'Confidence', 'Probable cause', 'Owner', 'Runbook', 'Pattern']].concat(fresh.map(t => [t.source, t.endpoint, t.code, t.class, t.category, t.severity_hint, Number(t.total), t.confidence, t.probable_cause, t.owner_team, t.runbook, t.message_pattern]));
    const buf = xlsx.build([{ name: 'Top signatures 24h', rows: rowsTop, numericCols: [6, 7], widths: [12, 36, 8, 10, 12, 8, 10, 10, 16, 16, 40, 14, 60] }, { name: 'New signatures', rows: rowsNew, numericCols: [6, 7], widths: [12, 36, 8, 10, 12, 8, 8, 9, 40, 14, 40, 60] }, { name: 'Hourly', rows: [['Hour (KSA)', 'App errors']].concat(hourly.map(h => [String(h.h).slice(0, 16), h.n])), numericCols: [1] }]);
    const esc = notify.esc;
    const body = `<div style="white-space:pre-wrap;font-size:13.5px;line-height:1.6">${esc(narrative)}</div>
      <table style="border-collapse:collapse;width:100%;margin-top:14px;font-size:12px"><tr style="color:#64748b;font-size:10.5px;letter-spacing:.05em"><th align="left">TOP SIGNATURES · 24 H</th><th align="right">EVENTS</th><th align="left">CLASS</th><th align="left">PROBABLE CAUSE</th></tr>
      ${top.slice(0, 10).map(t => `<tr><td style="padding:4px 6px 4px 0;border-top:1px solid #e3e7e5"><span style="font-family:monospace;font-size:11px">${esc(t.endpoint || t.source)}</span> · ${esc(t.code || '-')}</td><td align="right" style="border-top:1px solid #e3e7e5">${t.last_24h}</td><td style="border-top:1px solid #e3e7e5;color:${t.class === 'technical' ? '#dc2626' : '#2563eb'}">${esc(t.class || '?')}</td><td style="border-top:1px solid #e3e7e5">${esc(t.probable_cause || 'not assessed yet')}</td></tr>`).join('')}</table>
      <div style="margin-top:12px;font-size:12px;color:#64748b">${fresh.length} new signature(s) in the period · ${summary.signatures_total} known in total · full detail in the attached workbook and in the console (Settings › Agents).</div>`;
    const html = notify.shell({ title: 'Daily log intelligence — Mobile', badge: 'OPERATIONS CONSOLE · AGENT', pill: 'DAILY REPORT', pillColor: '#0b3d2b', bodyHtml: body });
    const r = await notify.sendHtml(to, `[Salam Ops] Daily log intelligence — ${ksa(end)} KSA`, html, [{ filename: `log_intelligence_${end.toISOString().slice(0, 10)}.xlsx`, content: buf }]);
    mailed = r && r.sent ? to.length : 0;
  } catch (e) { log('report mail failed:', e.message); }
  await C.query(`UPDATE agent_reports SET mailed_to=$2 WHERE id=$1`, [rep.id, mailed]);
  return { report: rep.id, top: top.length, fresh: fresh.length, mailed };
}

/* ---- the loop ---- */
let busy = false;
async function tick() {
  if (busy) return { skipped: true }; busy = true; const C = db.console; const now = new Date(); let result = null;
  const run = (await C.query(`INSERT INTO agent_runs (agent) VALUES ('log') RETURNING id`)).rows[0].id;
  try {
    const st = await getState('log'); const since = st.cursor ? new Date(st.cursor) : new Date(now.getTime() - 6 * 3600e3);
    /* the Fixed read models keep their own cursor — see ingestFixed on why it trails the data */
    const fixedSince = st.fixedCursor ? new Date(st.fixedCursor) : new Date(now.getTime() - 6 * 3600e3);
    const ing = await ingest(since, now, fixedSince);
    const as = await assess(ing.fresh);
    await setState('log', { ...st, cursor: now.toISOString(),
      fixedCursor: new Date((ing.fixed && ing.fixed.cursor) || fixedSince).toISOString(),
      lastRun: now.toISOString(), last: { ...ing, fresh: ing.fresh.length, ...as } });
    let rep = null;
    const ksaHour = Number(new Date(now.getTime() + 3 * 3600e3).toISOString().slice(11, 13)); const today = new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
    if (ksaHour >= CFG.reportHour && st.lastReportDay !== today) { rep = await dailyReport(now); await setState('log', { ...(await getState('log')), lastReportDay: today }); }
    /* AI usage & budget recap for the KSA day that just closed — once a day, at/after 00:00 KSA.
     * Rides this tick so there is no second scheduler to keep alive (11 Sep 2026). */
    let dig = null;
    try { dig = await require('./budgetDigest').maybeSend(now); } catch (e) { log('budget digest failed:', e.message); }
    await C.query(`DELETE FROM agent_signatures WHERE last_seen < now() - ($1||' days')::interval`, [String(CFG.retentionDays)]).catch(() => {});
    await C.query(`UPDATE agent_runs SET finished_at=now(), ok=true, stats=$2 WHERE id=$1`, [run, JSON.stringify({ ...ing, fresh: ing.fresh.length, ...as, report: rep })]);
    const fxN = (ing.fixed && ing.fixed.rows) || 0;
    log(`tick: ${ing.events} events (${fxN} fixed) → ${ing.signatures} signatures (${ing.fresh.length} new) · assessed ${as.assessed} in ${as.batches} batch(es)${rep ? ` · daily report #${rep.report} mailed to ${rep.mailed}` : ''}${dig ? ` · AI budget recap ${dig.sent ? 'mailed to ' + dig.to : 'FAILED: ' + dig.error} (${dig.stats ? dig.stats.day : '?'})` : ''}`);
    result = { events: ing.events, signatures: ing.signatures, fresh: ing.fresh.length, ...as, report: rep };
  } catch (e) { log('tick failed:', e.message); result = { error: e.message }; await C.query(`UPDATE agent_runs SET finished_at=now(), ok=false, error=$2 WHERE id=$1`, [run, e.message]).catch(() => {}); }
  finally { busy = false; }
  return result;
}

async function main() {
  await ensureSchema(); await llm.ensureSchema(); llm.start();
  if (!CFG.enabled) { log('disabled (AGENT_LOG_ENABLED=0) — idle'); setInterval(() => {}, 3600e3); return; }
  log(`armed: every ${CFG.intervalMin} min · daily report at ${String(CFG.reportHour).padStart(2, '0')}:00 KSA`);
  setTimeout(tick, 20000); setInterval(tick, CFG.intervalMin * 60000);
}
if (require.main === module) main().catch(e => { console.error('[AGENT-LOG] fatal', e); process.exit(1); });
module.exports = { tick, ingest, assess, dailyReport, ensureSchema, normalise };
