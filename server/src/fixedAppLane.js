/* fixedAppLane.js — Troubleshoot › "From the app log" lane (15 Sep 2026).
 *
 * Reads unified_console.fixed_app_events (filled by fixedAppLogCollector.js from the Fixed app's combined.log on
 * 146) and answers ONE call for the Troubleshoot board: per channel (SDA · Salam Home app · Epurchase ·
 * payments worker) the failing steps with their reason text and an hourly failure series; the identity /
 * eligibility providers (Yakeen/ELM, getYakeenAddress, Absher OTP, Nafath, Semati, Manafith) with a real
 * success rate; and "retry loops" — one reason repeating on a flat cadence with no customer behind it (the
 * invoices.voidInvoice worker found on 15 Sep: 31 invoices × every 2–3 min × HTTP 500, forever).
 *
 * Why this lane exists: the error board reads the sda_ops read models, and sda_ops.beta (Web + Salam Home) has
 * had no error_events since opsb-ingest-watch started crash-looping — so Salam Home errors were invisible. The
 * app log has them (salamApp.* paths), plus everything that never reaches a read model (Yakeen, per-step
 * outcomes). Same window semantics as the board (fixedErrors.parseWindow). Read-only. */
'use strict';
const db = require('./db');
const { parseWindow, CLASS_SQL } = require('./fixedErrors');

const CH = [
  { key: 'sda', label: 'SDA dealer app', desc: 'sda.* tRPC paths' },
  { key: 'salamhome', label: 'Salam Home app', desc: 'salamApp.* tRPC paths — read from the app log, the beta read model has no error_events' },
  { key: 'web', label: 'Epurchase', desc: 'ePurchase.* and paymentOptimization.* paths' },
  { key: 'payments', label: 'Payments worker', desc: 'payment-service lines without a customer request' },
];
const PROV = [
  { kind: 'yakeen', label: 'Yakeen / ELM', desc: 'getYakeenInfo — NIC record check on id + date of birth' },
  { kind: 'yakeen_address', label: 'Yakeen address', desc: 'getYakeenAddress — national address lookup' },
  { kind: 'absher', label: 'Absher OTP', desc: 'DRM sendAbsherValidateCode / checkValidateCode' },
  { kind: 'nafath', label: 'Nafath', desc: '5G identity — Nafath request / callback' },
  { kind: 'semati', label: 'Semati', desc: 'CITC sim eligibility (IssueNewMobileIndividual)' },
  { kind: 'manafith', label: 'Manafith', desc: 'DRM dealerValidation — dealer eligibility' },
  { kind: 'naqeel', label: 'Naqeel · 5G stock & delivery', desc: '5G e-purchase — warehouse search / SIM lock at the location step, delivery order, return-to-origin' },
  { kind: 'payment', label: 'Card capture / void / refund', desc: 'payments v2 MANUAL_CAPTURE settlement and refunds (e-purchase)' },
  { kind: 'payment_loop', label: 'Hold-settlement loop (10 min)', desc: 'backend loop that captures / voids AUTHORIZED holds on expired journeys — repeats the same stuck invoices every pass' },
];
const stepOf = p => String(p || '').replace(/^(sda|ePurchase|salamApp|paymentOptimization)\.(actions\.)?/, '');

async function lane(q = {}) {
  const { from, to, window } = parseWindow(q);
  const C = db.console;
  const Q = async (sql, p) => { try { return (await C.query(sql, p)).rows; } catch (e) { if (/does not exist/.test(e.message)) return []; throw e; } };
  const hours = Math.max(1, Math.round((to - from) / 3600e3));
  const bucket = hours <= 48 ? 'hour' : 'day';
  const P = [from.toISOString(), to.toISOString()];
  const [byChan, steps, series, prov, provLast, loops, col] = await Promise.all([
    Q(`SELECT coalesce(channel,'other') AS channel, count(*)::int AS total, count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed,
              count(DISTINCT request_id) FILTER (WHERE ok IS NOT TRUE)::int AS requests
         FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND kind IN ('mutation','error') GROUP BY 1`, P),
    Q(`SELECT coalesce(channel,'other') AS channel, coalesce(path,'-') AS path,
              count(*)::int AS n, count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed,
              (array_agg(left(reason,120) ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE AND reason IS NOT NULL))[1] AS last_reason,
              max(ts) FILTER (WHERE ok IS NOT TRUE) AS last_fail, count(DISTINCT reason) FILTER (WHERE ok IS NOT TRUE)::int AS reasons
         FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND kind IN ('mutation','error') GROUP BY 1,2
        HAVING count(*) FILTER (WHERE ok IS NOT TRUE) > 0 ORDER BY 4 DESC LIMIT 60`, P),
    Q(`SELECT coalesce(channel,'other') AS channel, date_trunc('${bucket}', ts AT TIME ZONE 'Asia/Riyadh') AS b,
              count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed, count(*)::int AS total
         FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND kind IN ('mutation','error') GROUP BY 1,2 ORDER BY 2`, P),
    Q(`SELECT kind, coalesce(channel,'other') AS channel, count(*)::int AS calls, count(*) FILTER (WHERE ok)::int AS ok,
              count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class='technical')::int AS technical,
              count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class='business')::int AS business
         FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND kind IN ('yakeen','yakeen_address','absher','nafath','semati','manafith','naqeel','payment','payment_loop') GROUP BY 1,2`, P),
    Q(`SELECT DISTINCT ON (kind) kind, ts, reason_class, status_code, left(reason,140) AS reason
         FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND ok IS NOT TRUE AND kind IN ('yakeen','yakeen_address','absher','nafath','semati','manafith','naqeel','payment','payment_loop')
        ORDER BY kind, ts DESC`, P),
    /* a retry loop = the same path+reason ≥ 30 times, spread over ≥ 20 min, present in most 5-minute buckets of its span,
     * and WITHOUT distinct request ids — a worker, not customers (635 phones failing the same way is a channel problem, not a loop) */
    Q(`WITH g AS (SELECT coalesce(path,'-') AS path, left(reason,120) AS reason, coalesce(channel,'other') AS channel,
                         count(*)::int AS n, min(ts) AS first, max(ts) AS last,
                         count(DISTINCT date_trunc('hour', ts) + (floor(extract(minute FROM ts)/5)*5) * interval '1 minute')::int AS buckets,
                         count(DISTINCT request_id)::int AS requests
                    FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND ok IS NOT TRUE AND reason IS NOT NULL GROUP BY 1,2,3)
       SELECT * FROM g WHERE n >= 30 AND last - first >= interval '20 minutes' AND requests <= 1
          AND buckets >= 0.6 * ceil(extract(epoch FROM (last - first)) / 300.0) ORDER BY n DESC LIMIT 6`, P),
    (async () => { try { const c = require('./fixedAppLogCollector'); return { ...c.status(), db: await c.ping() }; } catch (e) { return { configured: false, error: e.message }; } })(),
  ]);
  const ser = {}; for (const r of series) (ser[r.channel] = ser[r.channel] || []).push({ b: r.b, failed: r.failed, total: r.total });
  const channels = CH.map(c => {
    const t = byChan.find(x => x.channel === c.key) || { total: 0, failed: 0, requests: 0 };
    return { ...c, total: t.total, failed: t.failed, requests: t.requests,
      steps: steps.filter(s => s.channel === c.key).slice(0, 6).map(s => ({ path: s.path, step: stepOf(s.path), n: s.n, failed: s.failed, rate: s.n ? Math.round(1000 * s.failed / s.n) / 10 : null, last_reason: s.last_reason, last_fail: s.last_fail, reasons: s.reasons })),
      series: ser[c.key] || [] };
  });
  const providers = PROV.map(p => {
    const rows = prov.filter(x => x.kind === p.kind);
    const sum = rows.reduce((a, r) => ({ calls: a.calls + r.calls, ok: a.ok + r.ok, failed: a.failed + r.failed, technical: a.technical + r.technical, business: a.business + r.business }), { calls: 0, ok: 0, failed: 0, technical: 0, business: 0 });
    const last = provLast.find(x => x.kind === p.kind) || null;
    return { ...p, ...sum, rate: sum.calls ? Math.round(1000 * sum.ok / sum.calls) / 10 : null,
      byChannel: rows.map(r => ({ channel: r.channel, calls: r.calls, failed: r.failed })), lastFail: last };
  });
  const newest = col && col.db && col.db.newestTs ? new Date(col.db.newestTs) : null;
  return {
    from: from.toISOString(), to: to.toISOString(), window, bucket,
    collector: { configured: !!(col && col.configured), logPath: col && col.logPath, newest: newest ? newest.toISOString() : null,
      lagMin: newest ? Math.max(0, Math.round((Date.now() - newest.getTime()) / 60000)) : null,
      error: col && col.hosts && col.hosts.map(h => h.lastError).filter(Boolean)[0] || (col && col.error) || null },
    channels, providers,
    loops: loops.map(l => ({ ...l, step: stepOf(l.path), perRun: l.buckets ? Math.round(l.n / l.buckets) : null, spanMin: Math.round((new Date(l.last) - new Date(l.first)) / 60000) })),
    note: 'Salam Home app errors come from the app log (salamApp.* paths). The beta read model (sda_ops.beta) has no error_events while opsb-ingest-watch crash-loops, so the board below shows Salam Home folded into Epurchase — this lane is the source of truth for the app until that is fixed.',
  };
}

/* ---- IMPACT CHECK (15 Sep 2026) — "sales send a screenshot of an error: is it happening, since when, how many, is it
 * over?" One call: free text (the message on the screenshot, or a provider name) → matched against the app log
 * (fixed_app_events.reason/message) AND the error board (error_events.message on both read models), 15-minute
 * buckets over the last N hours, a verdict (ongoing / recovering / cleared since …), channels, class, affected
 * requests/customers and the matching provider so the Yakeen probe can be run from the same panel. ---- */
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'issue', 'problem', 'error', 'system', 'please', 'urgent', 'facing', 'getting', 'have', 'has', 'are', 'not', 'is', 'in', 'on', 'of', 'to', 'we', 'an', 'a']);
const PROVIDER_WORDS = { yakeen: 'yakeen', elm: 'yakeen', absher: 'absher', nafath: 'nafath', semati: 'semati', manafith: 'manafith', citc: 'semati' };
function keywords(q) {
  const words = String(q || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}
async function impact(q = {}) {
  const text = String(q.q || '').trim().slice(0, 300);
  const hours = Math.min(168, Math.max(1, Number(q.hours) || 24));
  const to = new Date(), from = new Date(to.getTime() - hours * 3600e3);
  const kws = keywords(text);
  const provider = kws.map(w => PROVIDER_WORDS[w]).find(Boolean) || null;
  if (!kws.length && !provider) return { q: text, hours, error: 'give at least one word of the error message' };
  const C = db.console;
  const Q = async (pool, sql, p) => { try { return (await pool.query(sql, p)).rows; } catch (e) { if (/does not exist/.test(e.message)) return []; throw e; } };
  /* app log: every keyword must appear in reason or message (phrase order does not matter); a provider word also
   * matches by kind so "Yakeen" finds getYakeenInfo failures whose reason never says the word */
  const P = [from.toISOString(), to.toISOString()]; const conds = [];
  for (const w of kws) { P.push('%' + w + '%'); conds.push(`(coalesce(reason,'') ILIKE $${P.length} OR coalesce(message,'') ILIKE $${P.length} OR coalesce(path,'') ILIKE $${P.length})`); }
  let where = `ts >= $1 AND ts < $2 AND ok IS NOT TRUE AND (${conds.join(' AND ')}`;
  if (provider) { P.push(provider); where += ` OR kind = $${P.length}`; }
  where += ')';
  const [appTot, appBuckets, appChan, appReasons] = await Promise.all([
    Q(C, `SELECT count(*)::int AS n, min(ts) AS first, max(ts) AS last, count(DISTINCT request_id)::int AS requests, count(DISTINCT state_id)::int AS journeys,
                 count(*) FILTER (WHERE reason_class='technical')::int AS technical, count(*) FILTER (WHERE reason_class='business')::int AS business,
                 count(*) FILTER (WHERE ts >= $2::timestamptz - interval '15 minutes')::int AS last15,
                 count(*) FILTER (WHERE ts >= $2::timestamptz - interval '75 minutes' AND ts < $2::timestamptz - interval '15 minutes')::int AS prev60
            FROM fixed_app_events WHERE ${where}`, P),
    Q(C, `SELECT to_timestamp(floor(extract(epoch FROM ts) / 900) * 900) AS b, count(*)::int AS n FROM fixed_app_events WHERE ${where} GROUP BY 1 ORDER BY 1`, P),
    Q(C, `SELECT coalesce(channel,'other') AS channel, count(*)::int AS n FROM fixed_app_events WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, P),
    Q(C, `SELECT coalesce(reason_class,'?') AS cls, left(coalesce(reason,message,'-'),120) AS reason, coalesce(path,'-') AS path, count(*)::int AS n, max(ts) AS last FROM fixed_app_events WHERE ${where} GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 8`, P),
  ]);
  /* the error board (read models) — message text only */
  const pools = [db.ops, db.opsBeta].filter(Boolean);
  const EP = [from.toISOString(), to.toISOString()]; const econds = [];
  for (const w of kws) { EP.push('%' + w + '%'); econds.push(`(coalesce(e.message,'') ILIKE $${EP.length} OR coalesce(e.res_body,'') ILIKE $${EP.length})`); }
  const ewhere = `e.occurred_at >= $1 AND e.occurred_at < $2` + (econds.length ? ` AND (${econds.join(' AND ')}${provider ? ` OR e.category ILIKE '${provider === 'yakeen' ? 'YAKEEN' : provider.toUpperCase()}%'` : ''})` : '');
  const board = { n: 0, first: null, last: null, last15: 0, prev60: 0, customers: 0, technical: 0, business: 0, buckets: [] };
  for (const pool of pools) {
    const t = await Q(pool, `SELECT count(*)::int AS n, min(e.occurred_at) AS first, max(e.occurred_at) AS last, count(DISTINCT e.cust_masked)::int AS customers,
        count(*) FILTER (WHERE ${CLASS_SQL()} = 'technical')::int AS technical, count(*) FILTER (WHERE ${CLASS_SQL()} = 'business')::int AS business,
        count(*) FILTER (WHERE e.occurred_at >= $2::timestamptz - interval '15 minutes')::int AS last15,
        count(*) FILTER (WHERE e.occurred_at >= $2::timestamptz - interval '75 minutes' AND e.occurred_at < $2::timestamptz - interval '15 minutes')::int AS prev60
      FROM error_events e WHERE ${ewhere}`, EP);
    const b = await Q(pool, `SELECT to_timestamp(floor(extract(epoch FROM e.occurred_at) / 900) * 900) AS b, count(*)::int AS n FROM error_events e WHERE ${ewhere} GROUP BY 1 ORDER BY 1`, EP);
    const r = t[0] || {}; board.n += Number(r.n || 0); board.customers += Number(r.customers || 0); board.technical += Number(r.technical || 0); board.business += Number(r.business || 0);
    board.last15 += Number(r.last15 || 0); board.prev60 += Number(r.prev60 || 0);
    if (r.first && (!board.first || r.first < board.first)) board.first = r.first; if (r.last && (!board.last || r.last > board.last)) board.last = r.last;
    for (const x of b) { const k = new Date(x.b).toISOString(); const cur = board.buckets.find(y => y.b === k); if (cur) cur.n += x.n; else board.buckets.push({ b: k, n: x.n }); }
  }
  board.buckets.sort((a, b) => a.b < b.b ? -1 : 1);
  const app = appTot[0] || {};
  const total = Number(app.n || 0) + board.n;
  const last15 = Number(app.last15 || 0) + board.last15, prev60 = Number(app.prev60 || 0) + board.prev60;
  const lastSeen = [app.last, board.last].filter(Boolean).sort().pop() || null;
  const firstSeen = [app.first, board.first].filter(Boolean).sort()[0] || null;
  const sinceMin = lastSeen ? Math.round((to - new Date(lastSeen)) / 60000) : null;
  const prevRate = prev60 / 4;   // per 15 min
  const verdict = !total ? 'none' : last15 > 0 && last15 >= Math.max(3, prevRate) ? 'ongoing' : last15 > 0 ? 'recovering' : sinceMin != null && sinceMin >= 30 ? 'cleared' : 'quiet';
  /* the 15-minute axis, zero-filled */
  const axis = []; const start = Math.floor(from.getTime() / 900000) * 900000;
  for (let t = start; t <= to.getTime(); t += 900000) { const k = new Date(t).toISOString(); axis.push({ b: k, app: (appBuckets.find(x => new Date(x.b).toISOString() === k) || {}).n || 0, board: (board.buckets.find(x => x.b === k) || {}).n || 0 }); }
  return { q: text, keywords: kws, provider, hours, from: from.toISOString(), to: to.toISOString(), verdict, total, last15, prev60, prevRate: Math.round(prevRate * 10) / 10,
    firstSeen, lastSeen, sinceMin,
    app: { n: Number(app.n || 0), requests: Number(app.requests || 0), journeys: Number(app.journeys || 0), technical: Number(app.technical || 0), business: Number(app.business || 0), channels: appChan, reasons: appReasons },
    board: { n: board.n, customers: board.customers, technical: board.technical, business: board.business },
    series: axis,
    note: 'app = the Fixed app combined.log (fixed_app_events) · board = error_events on the sda_ops read models · ongoing = still failing in the last 15 min at or above the previous hour’s rate · cleared = nothing for 30 min' };
}

function mount(app, { requireView } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/applog/impact', gate, async (req, res) => { try { res.json(await impact(req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/fixed/applog/lane', gate, async (req, res) => { try { res.json(await lane(req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { mount, lane, impact };
