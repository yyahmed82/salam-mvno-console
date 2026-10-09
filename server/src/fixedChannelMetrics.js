/* Fixed · per-CHANNEL × CLASS alert metrics (16 Sep 2026 — "like MVNO: every alert type per channel — Salam Home app,
 * Epurchase, QR, SDA, all — business AND technical, accurate priority, latency included").
 *
 * Every metric emits ONE SNAPSHOT ROW PER DIMENSION VALUE ({channel}, {channel, cls}, {kind}, {host}, {src}) plus an
 * 'all' row where a fleet-wide rule makes sense; the seeded rules pick their row through alertRunner's dim subset
 * match. Each row carries dim.note (WHAT: the top category / step / reason) so the incident text is actionable.
 *
 * Sources
 *   board   = error_events + order_attempts on the sda_ops read models, through fixedErrors.boardSources() — the SAME
 *             partition the Troubleshoot board uses (beta serves Epurchase + Salam Home app only while it is fresh).
 *             Classification = fixedErrors.CLASS_SQL() (catalogue overrides + the business/technical CASE), so an
 *             operator reclassifying an error on the board changes the alert side too.
 *   applog  = unified_console.fixed_app_events (combined.log on 146): per-step tRPC outcomes WITH DURATIONS — the only
 *             latency source for the customer channels (the read models carry no timings).
 *   apicalls= sda_ops.api_calls (prod): outbound integration calls (TLS / DAWIYAT / STC / … endpoints) with status,
 *             error_class and duration_ms — provider failure rate and latency per host.
 *
 * Cost discipline — the scheduler can tick every 15 s and metrics are computed per enabled window:
 *   · every compute is memoised for 60 s (10 min for baselines) — one query per minute, whatever the tick rate
 *   · baselines never scan 14 days of raw rows at tick time: fixed_board_hourly (console DB) is a rollup of
 *     hour × source × channel × class × category maintained by a 5-min loop (last 3 h re-rolled, 14 d backfilled
 *     once in 1-day slices) — the same slicing that fixed the catalogue statement timeouts
 *   · the live 60-min counts ARE queried on the read models (a few thousand rows, regex once per row)
 *
 * PRIORITY DOCTRINE (mirrors seedRules.js for MVNO)
 *   P1 = money at risk, or a CUSTOMER channel (Salam Home app / Epurchase / QR) technically failing wide (rate ≥ 40 %,
 *        volume collapsed, latency ≥ 2× threshold, a provider hard down); P2 = technical degradation on any channel,
 *        provider degraded, latency over threshold, monitoring blind (ingest / collector stale); P3 = business
 *        anomalies (refusal surges, OTP, new signatures) — the platform works, customers are being told no;
 *        P4 = informational. Dealer-assisted SDA sits one notch under the consumer channels for business signals. */
const db = require('./db');
const fe = require('./fixedErrors');

const CH = { sda: 'SDA (dealer)', qr: 'QR codes', web: 'Epurchase', salamhome: 'Salam Home app', payments: 'Payments worker', all: 'all channels' };
const BOARD_CH = ['sda', 'qr', 'web', 'salamhome'];
const APP_CH = ['sda', 'web', 'salamhome', 'payments'];
const ATT_CH = `CASE WHEN oa.channel = 'sda' THEN 'sda' WHEN oa.channel = 'salamhome' THEN 'salamhome' WHEN oa.referral_code IS NOT NULL THEN 'qr' ELSE 'web' END`;
const MONEY = ['PAYMENT_NOT_NOTIFIED', 'PROVISION_NO_ORDER', 'PAYMENT_FAILED'];
/* KNOWN SLOW STEPS (9 Oct 2026, alpha.162). App steps that are slow every day because of a known, owned problem: they get
 * their own rule (fixed_applog_slow_step_p95_ms) and no longer decide the channel latency nor the slowest-step rule.
 *   salamApp.user.createTicket — Remedy ticket creation from the Salam Home app: p95 13–38 s on each of the 14 days to
 *   9 Oct (54 s that day), ~80 % of attempts refused "duplicate of INC…" because customers tap again while waiting.
 *   With 8 of the 37 steps of 09:30 KSA it alone put "Salam Home app · step latency p95 over 22 s (P1)" open.
 *   ePurchase.actions.confirmOtp — Epurchase OTP confirmation: p50 8.2 s, p95 22 s, p99 35 s, ≥ 10 s on every one of 15 days.
 * FIXED_SLOW_STEPS=path1,path2 in the env replaces the list. */
const SLOW_STEPS = (process.env.FIXED_SLOW_STEPS != null ? String(process.env.FIXED_SLOW_STEPS).split(',') : ['salamApp.user.createTicket', 'ePurchase.actions.confirmOtp']).map(x => x.trim()).filter(Boolean);
/* the "(worst)" integration host is chosen among hosts with real traffic (alpha.162): at 10 calls the breaches came from hosts
 * at a tenth of normal volume (sample 52 vs 421) — a host with 11 calls and 4 failures is not the provider being down */
const API_WORST_N = 50;
const KINDS = ['yakeen', 'yakeen_address', 'absher', 'nafath', 'semati', 'manafith', 'drm', 'naqeel', 'payment'];
const HOST = `coalesce(substring(ac.endpoint from '^https?://([^/:]+)'), 'unknown')`;
const C = () => db.console;
const n = v => Number(v) || 0;
const rate = (a, b) => (n(b) > 0 ? n(a) / n(b) : null);
const ksaHour = iso => (new Date(iso).getUTCHours() + 3) % 24;
const minuteKey = iso => String(iso).slice(0, 16);
const memo = new Map();
function cached(key, ttl, fn) {
  const h = memo.get(key); if (h && Date.now() - h.at < ttl) return h.p;
  const p = Promise.resolve().then(fn).catch(e => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), p }); if (memo.size > 200) memo.delete(memo.keys().next().value);
  return p;
}
function robust(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y); const med = a[Math.floor(a.length / 2)];
  const dev = a.map(v => Math.abs(v - med)).sort((x, y) => x - y); const mad = dev[Math.floor(dev.length / 2)];
  return { med, mad, n: a.length };
}
const zOf = (cur, b) => (cur - b.med) / Math.max(1.4826 * b.mad, Math.sqrt(b.med), 1);
/* wrap: never throw into the sync loop — [] with a log line, exactly like fixedMetrics.guarded */
const safe = (name, fn) => async (_src, now, w) => { try { return await fn(new Date(now).toISOString(), w); } catch (e) { console.error(`[fixedChannelMetrics] ${name}: ${e.message}`); return []; } };

/* ================= board rollup (console DB) ================= */
let rollReady = null;
async function ensureRollup() {
  if (!C()) return false;
  if (!rollReady) rollReady = C().query(`CREATE TABLE IF NOT EXISTS fixed_board_hourly (hour timestamptz NOT NULL, src text NOT NULL, channel text NOT NULL, cls text NOT NULL, category text NOT NULL, n int NOT NULL, open int NOT NULL, PRIMARY KEY (hour, src, channel, cls, category));
    CREATE TABLE IF NOT EXISTS fixed_attempts_hourly (hour timestamptz NOT NULL, src text NOT NULL, channel text NOT NULL, n int NOT NULL, PRIMARY KEY (hour, src, channel));
    CREATE INDEX IF NOT EXISTS idx_fixed_board_hourly_hour ON fixed_board_hourly (hour);`).then(() => true).catch(e => { rollReady = null; throw e; });
  return rollReady;
}
async function rollup(fromIso, toIso) {
  if (!(await ensureRollup())) return { hours: 0 };
  const srcs = await fe.boardSources(); let rows = 0;
  for (const s of srcs) {
    const slice = s.slice ? ` AND ${s.slice}` : '';
    const b = (await s.pool.query(`SELECT date_trunc('hour', e.occurred_at) AS hour, ${fe.CHANNEL_EXPR} AS channel, ${fe.CLASS_SQL()} AS cls, e.category, count(*)::int AS n, count(*) FILTER (WHERE NOT e.resolved)::int AS open
        FROM error_events e WHERE e.occurred_at >= $1 AND e.occurred_at < $2${slice} GROUP BY 1,2,3,4`, [fromIso, toIso])).rows;
    const a = (await s.pool.query(`SELECT date_trunc('hour', oa.started_at) AS hour, ${ATT_CH} AS channel, count(*)::int AS n
        FROM order_attempts oa WHERE oa.started_at >= $1 AND oa.started_at < $2${slice.replace(/\be\./g, 'oa.')} GROUP BY 1,2`, [fromIso, toIso])).rows;
    const c = await C().connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM fixed_board_hourly WHERE src = $1 AND hour >= date_trunc('hour', $2::timestamptz) AND hour < $3`, [s.src, fromIso, toIso]);
      await c.query(`DELETE FROM fixed_attempts_hourly WHERE src = $1 AND hour >= date_trunc('hour', $2::timestamptz) AND hour < $3`, [s.src, fromIso, toIso]);
      for (const r of b) await c.query(`INSERT INTO fixed_board_hourly VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (hour, src, channel, cls, category) DO UPDATE SET n = EXCLUDED.n, open = EXCLUDED.open`, [r.hour, s.src, r.channel, r.cls, r.category || '-', r.n, r.open]);
      for (const r of a) await c.query(`INSERT INTO fixed_attempts_hourly VALUES ($1,$2,$3,$4) ON CONFLICT (hour, src, channel) DO UPDATE SET n = EXCLUDED.n`, [r.hour, s.src, r.channel, r.n]);
      await c.query('COMMIT'); rows += b.length;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  return { rows, sources: srcs.length };
}
let rollTimer = null, rollBusy = false;
async function rollTick() {
  if (rollBusy || !C()) return; rollBusy = true;
  try {
    const now = Date.now();
    const cov = (await C().query(`SELECT min(hour) AS lo, max(hour) AS hi FROM fixed_board_hourly`).catch(() => ({ rows: [{}] }))).rows[0] || {};
    if (!cov.lo || (now - new Date(cov.lo).getTime()) < 13 * 864e5) {         // backfill 14 days, one day at a time (never one 14-day regex statement)
      const start = now - 14 * 864e5, stop = cov.lo ? new Date(cov.lo).getTime() : now;
      for (let t = start; t < stop; t += 864e5) {
        try { await rollup(new Date(t).toISOString(), new Date(Math.min(t + 864e5, stop)).toISOString()); }
        catch (e) { console.error(`[fixedChannelMetrics] rollup backfill ${new Date(t).toISOString().slice(0, 10)}: ${e.message}`); }
      }
      console.log(`[fixedChannelMetrics] board rollup backfilled 14 d`);
    }
    await rollup(new Date(now - 3 * 3600e3).toISOString(), new Date(now + 60e3).toISOString());
  } catch (e) { console.error(`[fixedChannelMetrics] rollup: ${e.message}`); }
  finally { rollBusy = false; }
}
function start() {
  if (rollTimer || !C()) return;
  setTimeout(rollTick, 90e3);                              // after the catalogue's first sync so overrides are loaded
  rollTimer = setInterval(rollTick, 5 * 60e3);
  console.log('[fixedChannelMetrics] board rollup loop armed (every 5 min, last 3 h)');
}

/* ================= board: live 60-min counts per channel × class ================= */
async function boardLive(now) {
  return cached('boardLive:' + minuteKey(now), 60e3, async () => {
    const srcs = await fe.boardSources(); const out = {};
    for (const s of srcs) {
      const slice = s.slice ? ` AND ${s.slice}` : '';
      const r = (await s.pool.query(`SELECT ${fe.CHANNEL_EXPR} AS channel, ${fe.CLASS_SQL()} AS cls, e.category, count(*)::int AS n, count(*) FILTER (WHERE NOT e.resolved)::int AS open,
          (array_agg(left(${fe.RESP_EXPR}, 90) ORDER BY e.occurred_at DESC))[1] AS sample
          FROM error_events e WHERE e.occurred_at >= $1::timestamptz - interval '60 minutes' AND e.occurred_at < $1::timestamptz${slice} GROUP BY 1,2,3`, [now])).rows;
      for (const x of r) { const k = x.channel + '|' + x.cls; (out[k] = out[k] || { channel: x.channel, cls: x.cls, n: 0, open: 0, cats: [] }); out[k].n += x.n; out[k].open += x.open; out[k].cats.push(x); }
      const a = (await s.pool.query(`SELECT ${ATT_CH} AS channel, count(*)::int AS n FROM order_attempts oa
          WHERE oa.started_at >= $1::timestamptz - interval '60 minutes' AND oa.started_at < $1::timestamptz${slice.replace(/\be\./g, 'oa.')} GROUP BY 1`, [now])).rows;
      for (const x of a) { const k = x.channel + '|attempts'; out[k] = out[k] || { channel: x.channel, attempts: 0 }; out[k].attempts += x.n; }
    }
    return out;
  });
}
const topCat = cats => { const c = cats.slice().sort((a, b) => b.n - a.n)[0]; return c ? `${c.category} ×${c.n}${c.sample ? ` “${String(c.sample).replace(/\s+/g, ' ')}”` : ''}` : ''; };
async function boardBaseline(now) {
  return cached('boardBase:' + String(now).slice(0, 13), 10 * 60e3, async () => {
    if (!(await ensureRollup())) return {};
    const rows = (await C().query(`SELECT hour, channel, cls, sum(n)::int AS n FROM fixed_board_hourly
        WHERE hour >= $1::timestamptz - interval '14 days' AND hour < date_trunc('hour', $1::timestamptz) - interval '1 hour' GROUP BY 1,2,3`, [now])).rows;
    const cov = (await C().query(`SELECT min(hour) AS lo FROM fixed_board_hourly`)).rows[0].lo;
    const hod = ksaHour(now); const by = {};
    for (const r of rows) { const k = r.channel + '|' + r.cls; (by[k] = by[k] || { same: [], all: [] }); by[k].all.push(r.n); if (ksaHour(r.hour) === hod) by[k].same.push(r.n); }
    const spanH = cov ? Math.min(24 * 14, Math.max(1, Math.floor((new Date(now) - new Date(cov)) / 3600e3) - 1)) : 0;
    const out = {};
    for (const k of Object.keys(by)) {
      const all = by[k].all.slice(); while (all.length < spanH) all.push(0);
      const same = by[k].same.slice(); const sameSpan = Math.floor(spanH / 24); while (same.length < sameSpan) same.push(0);
      out[k] = same.length >= 5 ? robust(same) : robust(all);
    }
    return { by: out, coverageH: spanH };
  });
}
function withAll(rows, keyOf, mergeInto) {
  /* add an {channel:'all'} row per class by summing the channel rows */
  const acc = {};
  for (const r of rows) { const k = keyOf(r); (acc[k] = acc[k] || mergeInto(null, r)); mergeInto(acc[k], r); }
  return rows.concat(Object.values(acc));
}

const METRICS = {
  fixed_board_fail_rate: {
    label: 'Fixed · board errors per attempt, 60 min (per channel × class)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.error_events, sda_ops.order_attempts',
    compute: safe('board_fail_rate', async now => {
      const live = await boardLive(now); const rows = [];
      for (const ch of BOARD_CH) for (const cls of ['technical', 'business']) {
        const e = live[ch + '|' + cls], a = live[ch + '|attempts']; const att = a ? a.attempts : 0; const cnt = e ? e.n : 0;
        if (!att && !cnt) continue;
        rows.push({ dim: { channel: ch, cls, note: e ? `${CH[ch]} · ${cnt} ${cls} errors on ${att} attempts · top ${topCat(e.cats)}` : '' }, value: rate(cnt, Math.max(att, cnt)), sample: Math.max(att, cnt) });
      }
      for (const cls of ['technical', 'business']) {
        const mine = rows.filter(r => r.dim.cls === cls); if (!mine.length) continue;
        const cnt = mine.reduce((s, r) => s + Math.round(r.value * r.sample), 0), att = mine.reduce((s, r) => s + r.sample, 0);
        rows.push({ dim: { channel: 'all', cls, note: mine.map(r => `${CH[r.dim.channel]} ${Math.round(r.value * 100)}%`).join(' · ') }, value: rate(cnt, att), sample: att });
      }
      return rows;
    })
  },
  fixed_board_fail_anomaly: {
    label: 'Fixed · board error anomaly vs own 14-day baseline (robust z, per channel × class)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.error_events, unified_console.fixed_board_hourly',
    compute: safe('board_fail_anomaly', async now => {
      const [live, base] = await Promise.all([boardLive(now), boardBaseline(now)]);
      if (!base.by || base.coverageH < 6) return [];
      const rows = [];
      for (const ch of BOARD_CH.concat('all')) for (const cls of ['technical', 'business']) {
        const parts = ch === 'all' ? BOARD_CH.map(c => live[c + '|' + cls]).filter(Boolean) : [live[ch + '|' + cls]].filter(Boolean);
        const cnt = parts.reduce((s, p) => s + p.n, 0);
        let b;
        if (ch === 'all') { const bs = BOARD_CH.map(c => base.by[c + '|' + cls]).filter(Boolean); if (!bs.length) continue; b = { med: bs.reduce((s, x) => s + x.med, 0), mad: Math.sqrt(bs.reduce((s, x) => s + x.mad * x.mad, 0)) }; }
        else b = base.by[ch + '|' + cls];
        if (!b) continue;
        /* excess guard (alpha.162): SDA's technical median is 0 at night, so 4 errors read z 4 — an anomaly needs ≥ 10 (technical)
         * / 25 (business) errors more than usual this hour; below that the value is capped under any threshold */
        const zr = zOf(cnt, b), z = cnt - b.med < (cls === 'technical' ? 10 : 25) ? Math.min(zr, 1) : zr; const cats = parts.flatMap(p => p.cats);
        rows.push({ dim: { channel: ch, cls, note: `${CH[ch]} · ${cnt} ${cls} in the last 60 min vs typical ${b.med}/h · top ${topCat(cats)}` }, value: Math.round(z * 10) / 10, sample: cnt });
      }
      return rows;
    })
  },
  fixed_board_money_at_risk: {
    label: 'Fixed · paid-but-stuck errors open, 60 min (per channel)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.error_events',
    compute: safe('board_money', async now => {
      const live = await boardLive(now); const rows = []; let all = 0; const notes = [];
      for (const ch of BOARD_CH) {
        const cats = ['technical', 'business'].flatMap(cls => (live[ch + '|' + cls] ? live[ch + '|' + cls].cats : [])).filter(c => MONEY.includes(c.category));
        const open = cats.reduce((s, c) => s + c.open, 0); const tot = cats.reduce((s, c) => s + c.n, 0);
        if (tot) { rows.push({ dim: { channel: ch, note: `${CH[ch]} · ${cats.map(c => `${c.category} ×${c.open}`).join(', ')}` }, value: open, sample: tot }); all += open; notes.push(`${CH[ch]} ${open}`); }
      }
      rows.push({ dim: { channel: 'all', note: notes.join(' · ') }, value: all, sample: rows.reduce((s, r) => s + r.sample, 0) });
      return rows;
    })
  },
  fixed_board_ingest_lag_min: {
    label: 'Fixed · read-model ingest lag (minutes since newest event, per source)', unit: 'minutes', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.error_events, sda_ops.order_attempts',
    compute: safe('board_ingest_lag', async now => cached('ingestLag:' + minuteKey(now), 60e3, async () => {
      const rows = [];
      for (const [src, pool] of [['ops', db.ops], ['beta', db.opsBeta]]) {
        if (!pool || (src === 'beta' && pool === db.ops)) continue;
        const r = (await pool.query(`SELECT greatest((SELECT max(started_at) FROM order_attempts WHERE started_at >= now() - interval '30 days'), (SELECT max(occurred_at) FROM error_events WHERE occurred_at >= now() - interval '30 days')) AS t`)).rows[0];
        if (!r || !r.t) continue;
        const lag = Math.round((new Date(now) - new Date(r.t)) / 60e3);
        rows.push({ dim: { src, note: `${src === 'ops' ? 'sda_ops (SDA + QR; every channel while beta is stale)' : 'sda_ops_beta (Epurchase + Salam Home app)'} · newest row ${new Date(r.t).toISOString().slice(0, 16).replace('T', ' ')}Z` }, value: lag, sample: 1 });
      }
      return rows;
    }))
  },

  /* ================= app log (combined.log on 146 → fixed_app_events) ================= */
  fixed_applog_fail_rate: {
    label: 'Fixed · app-log step failure rate, 60 min (per channel × class)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_fail_rate', async now => cached('appFail:' + minuteKey(now), 60e3, async () => {
      if (!C()) return [];
      const r = (await C().query(`SELECT coalesce(channel,'other') AS channel, count(*)::int AS total,
          count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'technical')::int AS technical, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'business')::int AS business,
          (array_agg(coalesce(path, kind) || ' “' || left(coalesce(reason,''), 80) || '”' ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'technical'))[1] AS t_note,
          (array_agg(coalesce(path, kind) || ' “' || left(coalesce(reason,''), 80) || '”' ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'business'))[1] AS b_note
        FROM fixed_app_events WHERE kind = 'mutation' AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz GROUP BY 1`, [now])).rows;
      const rows = []; const tot = { technical: [0, 0], business: [0, 0] };
      for (const x of r) { if (!APP_CH.includes(x.channel)) continue;
        for (const cls of ['technical', 'business']) { rows.push({ dim: { channel: x.channel, cls, note: `${CH[x.channel]} · ${x[cls]} of ${x.total} steps ${cls === 'technical' ? 'failed technically' : 'refused'} · last ${(x[cls[0] + '_note'] || '').replace(/\s+/g, ' ')}` }, value: rate(x[cls], x.total), sample: x.total }); tot[cls][0] += x[cls]; tot[cls][1] += x.total; }
      }
      for (const cls of ['technical', 'business']) if (tot[cls][1]) rows.push({ dim: { channel: 'all', cls, note: rows.filter(q => q.dim.cls === cls && q.dim.channel !== 'all').map(q => `${CH[q.dim.channel]} ${Math.round(q.value * 100)}%`).join(' · ') }, value: rate(tot[cls][0], tot[cls][1]), sample: tot[cls][1] });
      return rows;
    }))
  },
  fixed_applog_latency_p95_ms: {
    label: 'Fixed · app-log step latency p95 (ms, 60 min, per channel)', unit: 'ms', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_latency', async now => cached('appLat:' + minuteKey(now), 60e3, async () => {
      if (!C()) return [];
      const r = (await C().query(`WITH s AS (SELECT coalesce(channel,'other') AS channel, path, duration_ms FROM fixed_app_events
            WHERE kind = 'mutation' AND duration_ms IS NOT NULL AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz AND coalesce(path,'') <> ALL($2::text[])),
          per_step AS (SELECT channel, path, count(*)::int AS n, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95 FROM s GROUP BY 1,2 HAVING count(*) >= 10)
        SELECT channel, count(*)::int AS n, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
          (SELECT path || ' p95 ' || round(p95) || ' ms ×' || n FROM per_step ps WHERE ps.channel = s.channel ORDER BY p95 DESC LIMIT 1) AS slowest
        FROM s GROUP BY 1`, [now, SLOW_STEPS])).rows;
      const known = SLOW_STEPS.length ? ` · known slow steps apart (${SLOW_STEPS.map(x => x.split('.').pop()).join(', ')})` : '';
      const rows = r.filter(x => APP_CH.includes(x.channel)).map(x => ({ dim: { channel: x.channel, note: `${CH[x.channel]} · p95 ${Math.round(x.p95)} ms (p50 ${Math.round(x.p50)} ms) on ${x.n} steps · slowest ${x.slowest || '-'}${known}` }, value: Math.round(x.p95), sample: x.n }));
      const all = (await C().query(`SELECT count(*)::int AS n, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95 FROM fixed_app_events WHERE kind = 'mutation' AND duration_ms IS NOT NULL AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz AND coalesce(path,'') <> ALL($2::text[])`, [now, SLOW_STEPS])).rows[0];
      if (all && all.n) rows.push({ dim: { channel: 'all', note: rows.map(q => `${CH[q.dim.channel]} ${q.value} ms`).join(' · ') }, value: Math.round(all.p95), sample: all.n });
      return rows;
    }))
  },
  fixed_applog_step_latency_p95_ms: {
    label: 'Fixed · slowest single step p95 (ms, 60 min, ≥20 calls)', unit: 'ms', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_step_latency', async now => cached('appStepLat:' + minuteKey(now), 60e3, async () => {
      if (!C()) return [];
      const r = (await C().query(`SELECT coalesce(channel,'other') AS channel, path, count(*)::int AS n, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
          FROM fixed_app_events WHERE kind = 'mutation' AND duration_ms IS NOT NULL AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz AND coalesce(path,'') <> ALL($2::text[])
          GROUP BY 1,2 HAVING count(*) >= 20 ORDER BY 4 DESC LIMIT 3`, [now, SLOW_STEPS])).rows;
      if (!r.length) return [];
      return [{ dim: { note: r.map(x => `${CH[x.channel] || x.channel} ${x.path} p95 ${Math.round(x.p95)} ms ×${x.n}`).join(' | ').slice(0, 220) }, value: Math.round(r[0].p95), sample: r[0].n }];
    }))
  },
  /* a known slow step against ITS OWN normal (alpha.162): 3 h window — createTicket runs ~5 times an hour, a p95 over 5 calls
   * is one call. One row per step × channel; the rule names its step in dim.path. */
  fixed_applog_slow_step_p95_ms: {
    label: 'Fixed · known slow app step p95 (ms, 3 h, per step)', unit: 'ms', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_slow_step', async now => cached('appSlowStep:' + minuteKey(now), 60e3, async () => {
      if (!C() || !SLOW_STEPS.length) return [];
      const r = (await C().query(`SELECT path, coalesce(channel,'other') AS channel, count(*)::int AS n,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
            count(*) FILTER (WHERE ok IS FALSE)::int AS failed, count(*) FILTER (WHERE ok IS FALSE AND reason_class = 'business')::int AS refused,
            count(*) FILTER (WHERE ok IS FALSE AND reason_class = 'technical')::int AS tech
          FROM fixed_app_events WHERE kind = 'mutation' AND duration_ms IS NOT NULL AND path = ANY($2::text[]) AND ts >= $1::timestamptz - interval '3 hours' AND ts < $1::timestamptz
          GROUP BY 1,2`, [now, SLOW_STEPS])).rows;
      return r.map(x => ({ dim: { path: x.path, channel: x.channel, note: `${CH[x.channel] || x.channel} · ${x.path} p95 ${Math.round(x.p95 / 1000)} s (p50 ${Math.round(x.p50 / 1000)} s) on ${x.n} calls in 3 h · ${x.failed} failed: ${x.refused} refused, ${x.tech} technical` },
        value: Math.round(x.p95), sample: x.n }));
    }))
  },
  fixed_applog_volume_ratio: {
    label: 'Fixed · app-log traffic vs same-hour 7-day median (1.0 = normal, per channel)', unit: 'ratio', higherIsBad: false, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_volume', async now => cached('appVol:' + minuteKey(now).slice(0, 15), 5 * 60e3, async () => {
      if (!C()) return [];
      const cv = (await C().query(`SELECT min(ts) AS t, max(ts) AS hi FROM fixed_app_events`)).rows[0], cov = cv.t;
      if (!cov || (new Date(now) - new Date(cov)) < 3 * 864e5) return [];        // three days of history before "quiet" means anything
      /* the collector itself behind (alpha.162): silence then means "we cannot see", not "customers left" — the collector-stale
       * rule says it; the P1 volume collapse fired at a sample of 0 on 2 % of ticks for exactly this reason */
      if (!cv.hi || new Date(now) - new Date(cv.hi) > 20 * 60e3) return [];
      const cur = (await C().query(`SELECT coalesce(channel,'other') AS channel, count(*)::int AS n FROM fixed_app_events WHERE ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz GROUP BY 1`, [now])).rows;
      const hist = (await C().query(`SELECT coalesce(channel,'other') AS channel, date_trunc('hour', ts) AS h, count(*)::int AS n FROM fixed_app_events
          WHERE ts >= $1::timestamptz - interval '7 days' AND ts < date_trunc('hour', $1::timestamptz) GROUP BY 1,2`, [now])).rows;
      const hod = ksaHour(now); const rows = [];
      for (const ch of ['sda', 'web', 'salamhome']) {
        const same = hist.filter(h => h.channel === ch && ksaHour(h.h) === hod).map(h => h.n); if (same.length < 3) continue;
        const b = robust(same); const c = cur.find(x => x.channel === ch); const cnt = c ? c.n : 0;
        if (b.med < 20) continue;                                                    // a channel that is normally quiet at this hour cannot "collapse"
        rows.push({ dim: { channel: ch, note: `${CH[ch]} · ${cnt} log lines in the last 60 min vs typical ${b.med} at this hour (${same.length} days)` }, value: Math.round((cnt / b.med) * 100) / 100, sample: cnt });
      }
      return rows;
    }))
  },
  fixed_applog_provider_technical_rate: {
    label: 'Fixed · provider technical failure rate, 60 min (per provider: Yakeen, Absher, Nafath, Semati, Manafith, DRM, Naqeel, card capture)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_provider', async now => cached('appProv:' + minuteKey(now), 60e3, async () => {
      if (!C()) return [];
      const r = (await C().query(`SELECT kind, count(*)::int AS calls, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'technical')::int AS tech, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'business')::int AS biz,
          (array_agg(left(reason, 90) ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'technical'))[1] AS reason
        FROM fixed_app_events WHERE kind = ANY($2::text[]) AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz GROUP BY 1`, [now, KINDS])).rows;
      return r.map(x => ({ dim: { kind: x.kind, note: `${x.kind} · ${x.tech} of ${x.calls} calls failed technically (${x.biz} business) · “${(x.reason || '').replace(/\s+/g, ' ')}”` }, value: rate(x.tech, x.calls), sample: x.calls }));
    }))
  },
  fixed_applog_otp_fail_rate: {
    label: 'Fixed · OTP / verification step failure rate, 60 min (per channel × class)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_otp', async now => stepFamily(now, 'otp', `path ~* '(otp|validatecode|verifycode|verifyotp|checkvalidate)'`))
  },
  fixed_applog_payment_fail_rate: {
    label: 'Fixed · payment / checkout step failure rate, 60 min (per channel × class)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_payment', async now => stepFamily(now, 'payment', `(path ~* '(payment|invoice|checkout|\\ypay)' OR channel = 'payments')`))
  },
  fixed_applog_collector_lag_min: {
    label: 'Fixed · app-log collector lag (minutes since newest line)', unit: 'minutes', higherIsBad: true, segment: 'fixed', sourceTables: 'unified_console.fixed_app_events',
    compute: safe('applog_lag', async now => cached('appLag:' + minuteKey(now), 60e3, async () => {
      if (!C() || !process.env.FIXED_LOG_HOSTS) return [];
      const r = (await C().query(`SELECT max(ts) AS t FROM fixed_app_events`)).rows[0];
      if (!r || !r.t) return [];
      return [{ dim: { note: `newest combined.log line ${new Date(r.t).toISOString().slice(0, 16).replace('T', ' ')}Z` }, value: Math.round((new Date(now) - new Date(r.t)) / 60e3), sample: 1 }];
    }))
  },

  /* ================= outbound integrations (sda_ops.api_calls) ================= */
  fixed_provider_api_fail_rate: {
    label: 'Fixed · integration call technical failure rate, 60 min (per endpoint host; the (worst) host row)', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.api_calls',
    compute: safe('api_fail', async now => { const s = await apiCalls(now); const rows = s.filter(x => x.calls >= 10).map(x => ({ dim: { host: x.host, note: `${x.host} · ${x.failed} of ${x.calls} calls failed technically (5xx / transport) · ${x.sample || ''}` }, value: rate(x.failed, x.calls), sample: x.calls }));
      const worst = rows.filter(r => r.sample >= API_WORST_N).sort((a, b) => b.value - a.value)[0]; if (worst) rows.push({ dim: { host: '(worst)', note: worst.dim.note }, value: worst.value, sample: worst.sample }); return rows; })
  },
  fixed_provider_api_latency_p95_ms: {
    label: 'Fixed · integration call latency p95 (ms, 60 min, per endpoint host; the (worst) host row)', unit: 'ms', higherIsBad: true, segment: 'fixed', sourceTables: 'sda_ops.api_calls',
    compute: safe('api_latency', async now => { const s = await apiCalls(now); const rows = s.filter(x => x.calls >= 10 && x.p95 != null).map(x => ({ dim: { host: x.host, note: `${x.host} · p95 ${Math.round(x.p95)} ms (p50 ${Math.round(x.p50)} ms) on ${x.calls} calls · slowest ${x.slowest || '-'}` }, value: Math.round(x.p95), sample: x.calls }));
      const worst = rows.filter(r => r.sample >= API_WORST_N).sort((a, b) => b.value - a.value)[0]; if (worst) rows.push({ dim: { host: '(worst)', note: worst.dim.note }, value: worst.value, sample: worst.sample }); return rows; })
  },
};

async function stepFamily(now, name, pred) {
  return cached(`appFam:${name}:` + minuteKey(now), 60e3, async () => {
    if (!C()) return [];
    const r = (await C().query(`SELECT coalesce(channel,'other') AS channel, count(*)::int AS total,
        count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'technical')::int AS technical, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class = 'business')::int AS business,
        (array_agg(coalesce(path, kind) || ' “' || left(coalesce(reason,''), 80) || '”' ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE))[1] AS note
      FROM fixed_app_events WHERE kind = 'mutation' AND ${pred} AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz GROUP BY 1`, [now])).rows;
    const rows = []; const tot = { technical: [0, 0], business: [0, 0] };
    for (const x of r) { if (!APP_CH.includes(x.channel)) continue;
      for (const cls of ['technical', 'business']) { rows.push({ dim: { channel: x.channel, cls, note: `${CH[x.channel]} · ${x[cls]} of ${x.total} ${name} steps ${cls === 'technical' ? 'failed technically' : 'refused'} · last ${(x.note || '').replace(/\s+/g, ' ')}` }, value: rate(x[cls], x.total), sample: x.total }); tot[cls][0] += x[cls]; tot[cls][1] += x.total; } }
    for (const cls of ['technical', 'business']) if (tot[cls][1]) rows.push({ dim: { channel: 'all', cls, note: rows.filter(q => q.dim.cls === cls && q.dim.channel !== 'all').map(q => `${CH[q.dim.channel]} ${Math.round(q.value * 100)}%`).join(' · ') }, value: rate(tot[cls][0], tot[cls][1]), sample: tot[cls][1] });
    return rows;
  });
}
async function apiCalls(now) {
  return cached('apiCalls:' + minuteKey(now), 60e3, async () => {
    const pool = db.ops || db.opsBeta; if (!pool) return [];
    const r = (await pool.query(`WITH s AS (SELECT ${HOST} AS host, regexp_replace(regexp_replace(split_part(ac.endpoint, '?', 1), '^https?://[^/]+', ''), '/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*', '/{id}', 'g') AS path, ac.status, ac.error_class, ac.duration_ms
          FROM api_calls ac WHERE ac.created_at >= $1::timestamptz - interval '60 minutes' AND ac.created_at < $1::timestamptz),
        per_path AS (SELECT host, path, count(*)::int AS n, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95 FROM s WHERE duration_ms IS NOT NULL GROUP BY 1,2 HAVING count(*) >= 5)
      SELECT host, count(*)::int AS calls, count(*) FILTER (WHERE status >= 500 OR error_class IS NOT NULL)::int AS failed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        (array_agg(coalesce(error_class, 'HTTP ' || status::text)) FILTER (WHERE status >= 500 OR error_class IS NOT NULL))[1] AS sample,
        (SELECT path || ' p95 ' || round(p95) || ' ms ×' || n FROM per_path pp WHERE pp.host = s.host ORDER BY p95 DESC LIMIT 1) AS slowest
      FROM s GROUP BY 1`, [now])).rows;
    return r;
  });
}

module.exports = { METRICS, start, rollup, CH, SLOW_STEPS };
