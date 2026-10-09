/* fixedErrorTrend.js — Fixed › Troubleshoot: "evolution of each error over time, hourly" (24 Sep 2026).
 *
 * The board's "Error message" select lists every distinct message in the period with its count; this module draws how
 * each of those messages evolved hour by hour — WITHOUT touching the read models at page time.
 *
 * Why a rollup: the message is not a column. It is a regex over the masked response body (fixedErrors.MSG_EXPR), so
 * grouping a 30-day window per hour × message on sda_ops means re-running that regex on every error row on every page
 * view. The past does not change, so it is computed ONCE and stored:
 *   fixed_error_msg_hourly (console DB)   hour × src × channel × type × provider × category × msg → n, open, cls_auto
 * kept by a loop: every 5 min the last 3 h are re-rolled (late rows, resolved flags), the last 48 h once an hour
 * (resolved flags settle later), and history is backfilled ONE DAY AT A TIME (newest first) down to KEEP_DAYS (92, the
 * range cap) — never one multi-day regex statement on the read model. The chart then reads the rollup only: a few
 * thousand narrow rows, one GROUP BY on the console DB, memoised 60 s per URL through respCache.
 *
 * Partition = the board's (fixedErrors.boardSources): rows are stored per source for every channel bucket, and the
 * READ picks src × channel the way the board does right now (beta serves Web + Salam Home app only while fresh), so the
 * chart and the select always agree. Business / technical = the catalogue override (fixedErrCatalog.wrapBoard over the
 * stored msg) ?? the stored auto class — an operator reclassifying an error re-colours history too.
 *
 * GET /api/fixed/errors/trend  ?range|from&to &channel &type &provider &cls &category &team &msg &openOnly &top=8 &bucket=auto|hour|day
 *   → { from, to, bucket, ticks:[iso…], series:[{ msg, cls, total, open, points:[n…] }…], other:{…}, all:{…},
 *       distinct, coverage:{ from, to, fresh_at }, note }
 * Filters the rollup cannot serve (identifier search, free-text response search) are reported in `note` and ignored —
 * the board hides the chart in that case.
 * 5G journeys (alpha.158): the board's 5G lane (fixed5gLane.js — SIM checks without a sellable SIM, 5G e-purchase stops
 * read from nexus) is rolled as src 'lane' in the same slices and read beside whichever read model serves the board. */
'use strict';
const db = require('./db');
const fe = require('./fixedErrors');

const C = () => db.console;
const n = v => Number(v) || 0;
const KEEP_DAYS = Number(process.env.FIXED_TREND_KEEP_DAYS) || 92;
const TABLE = 'fixed_error_msg_hourly';
const SRC_BUCKETS = { ops: ['sda', 'qr'], beta: ['web', 'salamhome'] };

let ready = null;
async function ensure() {
  if (!C()) return false;
  if (!ready) ready = C().query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      hour timestamptz NOT NULL, src text NOT NULL, channel text NOT NULL, type text NOT NULL, provider text NOT NULL,
      category text NOT NULL, msg text NOT NULL, cls_auto text NOT NULL, n int NOT NULL, open int NOT NULL,
      PRIMARY KEY (hour, src, channel, type, provider, category, msg, cls_auto));
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_hour ON ${TABLE} (hour);
    CREATE TABLE IF NOT EXISTS fixed_error_trend_state (k text PRIMARY KEY, v jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now());`)
    .then(async () => {
      /* alpha.78 created the key without cls_auto (one message can be technical under a 5xx and business under a 200 —
       * two rows, one key → "ON CONFLICT DO UPDATE command cannot affect row a second time"). Rebuild: the loop refills. */
      const k = await C().query(`SELECT array_length(i.indkey, 1) AS n FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relname = $1 AND i.indisprimary`, [TABLE]).catch(() => ({ rows: [] }));
      if (k.rows[0] && Number(k.rows[0].n) < 8) {
        console.log(`[fixed-trend] ${TABLE}: primary key lacks cls_auto — rebuilding the rollup (history refills a day at a time)`);
        await C().query(`DROP TABLE ${TABLE}; CREATE TABLE ${TABLE} (hour timestamptz NOT NULL, src text NOT NULL, channel text NOT NULL, type text NOT NULL, provider text NOT NULL,
          category text NOT NULL, msg text NOT NULL, cls_auto text NOT NULL, n int NOT NULL, open int NOT NULL, PRIMARY KEY (hour, src, channel, type, provider, category, msg, cls_auto));
          CREATE INDEX IF NOT EXISTS idx_${TABLE}_hour ON ${TABLE} (hour); DELETE FROM fixed_error_trend_state`);
      }
      return true;
    }).catch(e => { ready = null; throw e; });
  return ready;
}
const stateGet = async () => { try { const r = await C().query(`SELECT v FROM fixed_error_trend_state WHERE k='rollup'`); return r.rows[0] ? r.rows[0].v : {}; } catch (_) { return {}; } };
const stateSet = v => C().query(`INSERT INTO fixed_error_trend_state (k, v, at) VALUES ('rollup', $1, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = now()`, [JSON.stringify(v)]).catch(() => {});

/* one slice [from, to) on every configured source, all channel buckets (the partition is applied at read time) */
async function roll(fromIso, toIso) {
  if (!(await ensure())) return { rows: 0 };
  const srcs = await fe.boardSources();
  let rows = 0;
  for (const s of srcs) {
    const t0 = Date.now();
    const r = await s.pool.query(`WITH r AS (
        SELECT date_trunc('hour', e.occurred_at) AS hour, ${fe.CHANNEL_EXPR} AS channel, ${fe.TYPE_EXPR} AS type,
               coalesce(${fe.PROVIDER_EXPR}, '-') AS provider, coalesce(e.category, '-') AS category, e.code, e.resolved, ${fe.RESP_EXPR} AS resp
          FROM error_events e LEFT JOIN order_attempts oa ON oa.id = e.attempt_id
         WHERE e.occurred_at >= $1 AND e.occurred_at < $2)
      SELECT hour, channel, type, provider, category, ${fe.msgOf('resp')} AS msg, ${fe.classOf('resp', 'category', 'code')} AS cls_auto,
             count(*)::int AS n, count(*) FILTER (WHERE NOT resolved)::int AS open
        FROM r GROUP BY 1,2,3,4,5,6,7`, [fromIso, toIso]);
    const c = await C().connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM ${TABLE} WHERE src = $1 AND hour >= date_trunc('hour', $2::timestamptz) AND hour < $3`, [s.src, fromIso, toIso]);
      /* one multi-row insert per 500 rows — a day of a busy source is a few thousand rows */
      for (let i = 0; i < r.rows.length; i += 500) {
        const chunk = r.rows.slice(i, i + 500); const V = []; const P = [];
        chunk.forEach((x, j) => { const b = j * 10; V.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
          P.push(x.hour, s.src, x.channel, x.type || 'unknown', x.provider || '-', x.category || '-', x.msg || '(no message)', x.cls_auto || 'technical', x.n, x.open); });
        await c.query(`INSERT INTO ${TABLE} (hour, src, channel, type, provider, category, msg, cls_auto, n, open) VALUES ${V.join(',')}
                       ON CONFLICT (hour, src, channel, type, provider, category, msg, cls_auto) DO UPDATE SET n = EXCLUDED.n, open = EXCLUDED.open`, P);
      }
      await c.query('COMMIT'); rows += r.rows.length;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    if (Date.now() - t0 > 5000) console.log(`[fixed-trend] ${s.src} ${fromIso.slice(0, 13)}→${toIso.slice(0, 13)} took ${Date.now() - t0} ms (${r.rows.length} rows)`);
  }
  rows += await rollLane(fromIso, toIso);
  return { rows, sources: srcs.length };
}
/* the 5G lane: already aggregated per hour × channel × type × provider × category × message × auto class */
async function rollLane(fromIso, toIso) {
  let rows = 0;
  if (typeof fe.laneRollup === 'function') {
    try {
      const lr = await fe.laneRollup(fromIso, toIso);
      const c = await C().connect();
      try {
        await c.query('BEGIN');
        await c.query(`DELETE FROM ${TABLE} WHERE src = 'lane' AND hour >= date_trunc('hour', $1::timestamptz) AND hour < $2`, [fromIso, toIso]);
        for (let i = 0; i < lr.length; i += 500) {
          const chunk = lr.slice(i, i + 500); const V = []; const P = [];
          chunk.forEach((x, j) => { const b = j * 10; V.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
            P.push(x.hour, 'lane', x.channel, x.type || 'unknown', x.provider || '-', x.category || '-', x.msg || '(no message)', x.cls_auto || 'technical', x.n, x.open); });
          await c.query(`INSERT INTO ${TABLE} (hour, src, channel, type, provider, category, msg, cls_auto, n, open) VALUES ${V.join(',')}
                         ON CONFLICT (hour, src, channel, type, provider, category, msg, cls_auto) DO UPDATE SET n = EXCLUDED.n, open = EXCLUDED.open`, P);
        }
        await c.query('COMMIT'); rows += lr.length;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    } catch (e) { console.error(`[fixed-trend] 5G lane ${fromIso.slice(0, 13)}→${toIso.slice(0, 13)}: ${e.message}`); }
  }
  return rows;
}

let timer = null, busy = false, lastRun = null, lastErr = null, backfillDone = false;
async function tick() {
  if (busy || !C()) return; busy = true;
  try {
    const now = Date.now();
    await roll(new Date(now - 3 * 3600e3).toISOString(), new Date(now + 60e3).toISOString());
    const st = await stateGet();
    /* once an hour: re-roll the last 48 h so "open" follows the resolved flags */
    if (!st.wide_at || now - new Date(st.wide_at).getTime() > 3600e3) {
      await roll(new Date(now - 48 * 3600e3).toISOString(), new Date(now - 3 * 3600e3).toISOString());
      st.wide_at = new Date(now).toISOString();
    }
    /* backfill: one day per pass, newest first, until KEEP_DAYS are in — the first pass takes a few minutes at most,
     * each day is one bounded statement on the read model with a pause in between */
    const cov = (await C().query(`SELECT min(hour) AS lo FROM ${TABLE}`).catch(() => ({ rows: [{}] }))).rows[0] || {};
    let lo = cov.lo ? new Date(cov.lo).getTime() : now - 3 * 3600e3;
    const floor = now - KEEP_DAYS * 864e5;
    let days = 0;
    while (lo > floor && days < (backfillDone ? 1 : 200)) {
      const from = Math.max(floor, lo - 864e5);
      try { await roll(new Date(from).toISOString(), new Date(lo).toISOString()); }
      catch (e) { console.error(`[fixed-trend] backfill ${new Date(from).toISOString().slice(0, 10)}: ${e.message}`); break; }
      lo = from; days++;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (days) console.log(`[fixed-trend] backfilled ${days} day(s) — history now from ${new Date(lo).toISOString().slice(0, 10)}`);
    if (lo <= floor) backfillDone = true;
    /* the 5G lane's own history (alpha.158): the board history above predates the lane — one day per pass, newest
     * first, from 48 h back down to KEEP_DAYS (about 8 h for 92 days); the 48-h roll keeps the recent part */
    if (typeof fe.laneRollup === 'function') {
      const llo = st.lane_lo ? new Date(st.lane_lo).getTime() : now - 48 * 3600e3;
      if (llo > floor) { const from = Math.max(floor, llo - 864e5); await rollLane(new Date(from).toISOString(), new Date(llo).toISOString()); st.lane_lo = new Date(from).toISOString(); }
    }
    /* retention: the rollup is small, but keep it to KEEP_DAYS + 7 */
    await C().query(`DELETE FROM ${TABLE} WHERE hour < now() - ($1::int || ' days')::interval`, [KEEP_DAYS + 7]).catch(() => {});
    st.last_run = new Date().toISOString(); st.history_from = new Date(lo).toISOString(); st.keep_days = KEEP_DAYS;
    await stateSet(st); lastRun = st.last_run; lastErr = null; memoGen++; memo.clear();
  } catch (e) { lastErr = e.message; console.error(`[fixed-trend] rollup: ${e.message}`); }
  finally { busy = false; }
}
function start() {
  if (timer || !C()) return;
  setTimeout(tick, 120e3);                                   // after the catalogue + board rollup have warmed up
  timer = setInterval(tick, 5 * 60e3);
  console.log(`[fixed-trend] hourly error-message rollup armed (every 5 min · last 3 h · ${KEEP_DAYS} d history, backfilled a day at a time)`);
}

/* ---------------- read side ---------------- */
const TEAM_CATS = () => { const m = {}; for (const c of fe.TAXONOMY) (m[c.team] = m[c.team] || []).push(c.key); return m; };
function bucketOf(q, from, to) {
  const b = String(q.bucket || 'auto');
  if (b === 'hour' || b === 'day') return b;
  return (to - from) > 8 * 864e5 ? 'day' : 'hour';
}
async function trend(q = {}) {
  if (!(await ensure())) { const e = new Error('console DB not configured'); e.status = 503; throw e; }
  const w = fe.parseWindow(q);
  const from = w.from, to = w.to;
  const bucket = bucketOf(q, from, to);
  const note = [];
  if (q.find || q.anyId || ['odb', 'iccid', 'cpe', 'msisdn', 'serviceNo', 'custCode', 'customerId', 'workflowId'].some(k => q[k])) note.push('identifier search is not applied to the trend');
  if (q.resp) note.push('free-text response search is not applied to the trend');
  if (q.tech && q.tech !== 'all') note.push('FTTX / 5G chip is approximated by the product type');
  /* the partition the board uses right now */
  const srcs = await fe.boardSources();
  const split = srcs.length > 1 || (srcs[0] && srcs[0].slice);
  /* the axis starts at the bucket that CONTAINS `from` (an hour bucket at 16:00 must count for a window opened at 16:04) */
  const step = bucket === 'day' ? 864e5 : 3600e3;
  const t0 = bucket === 'day' ? (Math.floor((from.getTime() + 3 * 3600e3) / 864e5) * 864e5 - 3 * 3600e3) : Math.floor(from.getTime() / 3600e3) * 3600e3;
  const P = [new Date(t0).toISOString(), to.toISOString()];
  const parts = ['hour >= $1', 'hour < $2'];
  if (split) parts.push(`((src = 'ops' AND channel = ANY('{${SRC_BUCKETS.ops.join(',')}}')) OR (src = 'beta' AND channel = ANY('{${SRC_BUCKETS.beta.join(',')}}')) OR src = 'lane')`);
  else parts.push(`src IN ('${(srcs[0] && srcs[0].src) || 'ops'}', 'lane')`);
  const ch = String(q.channel || '').toLowerCase();
  const buckets = !ch ? null : ch === 'epurchase' ? ['qr', 'web'] : ch === 'app' ? ['salamhome'] : ['sda', 'qr', 'web', 'salamhome'].includes(ch) ? [ch] : null;
  if (buckets) { P.push(buckets); parts.push(`channel = ANY($${P.length}::text[])`); }
  const type = String(q.type || '').toLowerCase(); if (type && fe.TYPES.some(t => t.key === type)) { P.push(type); parts.push(`type = $${P.length}`); }
  if (q.tech === 'fttx') parts.push(`type IN ('ftth','fttb')`); else if (q.tech === '5g') parts.push(`type IN ('5gwl','5gfwa','5g')`);
  if (q.provider) { P.push(q.provider === '-' ? '-' : String(q.provider).toUpperCase().slice(0, 40)); parts.push(`provider = $${P.length}`); }
  if (q.category) { P.push(String(q.category).slice(0, 60)); parts.push(`category = $${P.length}`); }
  if (q.team && TEAM_CATS()[q.team]) { P.push(TEAM_CATS()[q.team]); parts.push(`category = ANY($${P.length}::text[])`); }
  let clsExpr = 'cls_auto';
  try { const cat = require('./fixedErrCatalog'); await cat.refresh(); clsExpr = cat.wrapBoard('msg', 'cls_auto'); } catch (_) {}
  if (q.cls === 'business' || q.cls === 'technical') { P.push(q.cls); parts.push(`${clsExpr} = $${P.length}`); }
  const tExpr = bucket === 'day' ? `date_trunc('day', hour + interval '3 hours') - interval '3 hours'` : 'hour';
  const r = await C().query(`SELECT ${tExpr} AS t, msg, min(${clsExpr}) AS cls, sum(n)::int AS n, sum(open)::int AS open FROM ${TABLE} WHERE ${parts.join(' AND ')} GROUP BY 1, 2`, P);
  /* the axis: every bucket from → to (gaps are zeros, never missing points) */
  const ticks = []; for (let t = t0; t < to.getTime(); t += step) ticks.push(t);
  const idx = new Map(ticks.map((t, i) => [t, i]));
  const openOnly = q.openOnly === '1' || q.openOnly === 'true';
  const S = new Map();
  for (const row of r.rows) {
    const i = idx.get(new Date(row.t).getTime()); if (i == null) continue;
    let s = S.get(row.msg); if (!s) { s = { msg: row.msg, cls: row.cls, total: 0, open: 0, points: new Array(ticks.length).fill(0) }; S.set(row.msg, s); }
    const v = openOnly ? n(row.open) : n(row.n);
    s.points[i] += v; s.total += n(row.n); s.open += n(row.open);
  }
  const all = [...S.values()].sort((a, b) => (openOnly ? b.open - a.open : b.total - a.total));
  const top = Math.min(20, Math.max(3, Number(q.top) || 8));
  const sel = q.msg ? String(q.msg).slice(0, 160) : '';
  let series = all.slice(0, top);
  if (sel && !series.some(s => s.msg === sel)) { const x = all.find(s => s.msg === sel); if (x) series = series.concat([x]); }
  const rest = all.filter(s => !series.includes(s));
  const sum = list => { const o = { total: 0, open: 0, points: new Array(ticks.length).fill(0) }; for (const s of list) { o.total += s.total; o.open += s.open; s.points.forEach((v, i) => o.points[i] += v); } return o; };
  const cov = await stateGet();
  return { from, to, window: w.window, bucket, ticks: ticks.map(t => new Date(t).toISOString()), openOnly, selected: sel || '',
    series, other: rest.length ? { msg: `Other (${rest.length} messages)`, count: rest.length, ...sum(rest) } : null, all: sum(all), distinct: all.length,
    coverage: { from: cov.history_from || null, fresh_at: cov.last_run || lastRun || null, keep_days: KEEP_DAYS, error: lastErr }, note: note.join(' · ') || null };
}

/* memo per URL for 20 s — enough to absorb a room of dashboards, short enough that a fresh roll shows within a refresh.
 * NOT respCache: its 2-min TTL + stale-while-revalidate served the empty pre-backfill answer for 3 min after deploy. */
const memo = new Map(); let memoGen = 0;
function mount(app, deps) {
  const { gate, wrap } = deps;
  app.get('/api/fixed/errors/trend', gate, async (req, res) => {
    try {
      const key = memoGen + '|' + req.originalUrl; const h = memo.get(key);
      if (h && Date.now() - h.at < 20e3) return res.json(h.body);
      const body = await trend(req.query || {}); memo.set(key, { at: Date.now(), body });
      if (memo.size > 200) memo.delete(memo.keys().next().value);
      res.json(body);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/fixed/errors/trend/status', gate, async (req, res) => {
    try { const st = await stateGet(); const c = (await C().query(`SELECT count(*)::int AS rows, min(hour) AS lo, max(hour) AS hi FROM ${TABLE}`)).rows[0];
      res.json({ ...st, rows: c.rows, lo: c.lo, hi: c.hi, busy, lastErr, keep_days: KEEP_DAYS }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  void wrap;
}

module.exports = { mount, start, trend, roll, tick, TABLE };
