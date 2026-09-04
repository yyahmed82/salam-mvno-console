/* Per-transaction END-TO-END correlation — one transaction id → all three tiers of the call:
 *
 *   1. APP  (api_traffic_events)  — what the Digital API answered the customer: path, response
 *      code/message, duration. Join: transaction_id (parsed from request.body.transactionId).
 *   2. GATEWAY (Zipkin / apigw_slow_spans) — every hop the call took through trms-api-gateway,
 *      unified-integration-layer, dms-* services, with per-hop timing. LIVE Zipkin search first
 *      (annotationQuery on the uilTransactionId tag — full trace, but only inside the gateway's
 *      ~1–3h in-memory retention); stored outlier spans as the permanent fallback (errors + slow
 *      calls are kept forever by zipkinCollector).
 *   3. UIL/OSB (uil_logs, MySQL) — the DMS-side integration log with the actual REQUEST/RESPONSE
 *      payloads, when OSB_LOG_URL is configured.
 *
 * This mirrors upgLink.js for payments: the same "one id, whole story" contract, read-only,
 * defensive, and every tier degrades to a null result rather than failing the lookup. */
'use strict';

const db = require('./db');

const mask = s => String(s == null ? '' : s)
  .replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 2) + '*******' + m.slice(-2))
  .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2));

const validTxn = t => /^[\w.-]{6,64}$/.test(String(t || '').trim());

/* HARD TIME BUDGET per tier — this endpoint sits behind a click and nginx's 60s cutoff; a slow
 * source must cost its own budget only, never the whole lookup (lesson from the first live test:
 * stacked Zipkin misses + an unindexed uil_logs scan = HTTP 504 with zero results). */
const timed = (ms, fn) => Promise.race([
  (async () => fn())(),
  new Promise(r => setTimeout(() => r({ __timeout: true }), ms))
]).catch(e => ({ __error: String(e.message || e).slice(0, 200) }));

async function forTxn(txn) {
  const t = String(txn || '').trim();
  if (!validTxn(t)) return { txn: t, error: 'invalid transaction id' };
  const out = { txn: t, app: [], gateway: { spans: [], source: 'none' }, uil: null };

  // 1) APP tier — the Digital API log events for this transaction (indexed; 3s budget)
  const appR = await timed(3000, async () => (await db.console.query(
    `SELECT ts, host, path, response_code, response_message, duration_ms, err_class
     FROM api_traffic_events WHERE transaction_id = $1 ORDER BY ts LIMIT 20`, [t])).rows);
  if (appR && appR.__timeout) out.appError = 'app-log lookup timed out (3s)';
  else if (appR && appR.__error) out.appError = appR.__error;
  else out.app = (appR || []).map(r => ({ ...r, response_message: mask(r.response_message).slice(0, 400) }));

  // 2) GATEWAY tier. The gateway does NOT tag transaction ids (verified 17 Aug), so the tag
  // search is a long shot — only worth trying when we have no app row to time+path from.
  let spans = [];
  const zc = require('./zipkinCollector');
  if (zc.enabled() && !out.app.length) {
    const live = await timed(6000, () => zc.findByTag(t));
    if (Array.isArray(live) && live.length) { spans = live; out.gateway.source = 'live (Zipkin — gateway keeps ~1–3h)'; }
    else if (live && (live.__timeout || live.__error)) out.gateway.liveError = live.__timeout ? 'tag search timed out' : live.__error;
  }
  // 2b) time+path fallback — the gateway does NOT tag the transaction id (it travels in response
  // bodies, which Zipkin cannot search), so when the tag search misses and we know the app call's
  // start time + endpoint, fetch the NEAREST gateway trace for the same endpoint. The app path
  // maps onto the gateway as /uil<path> (downstream hop) and /api/uil<path> (ingress).
  if (!spans.length && out.app.length && zc.enabled()) {
    const a = out.app[0];
    const endMs = new Date(a.ts).getTime();                       // ts = response Date header
    const startMs = endMs - (a.duration_ms || 0);
    const p = String(a.path || '').split('?')[0];
    const near = await timed(9000, () => zc.findByPathNear(
      ['/uil' + p, '/api/uil' + p, p], startMs, { windowMs: 180000 }));
    if (near && near.spans && near.spans.length) {
      spans = near.spans;
      out.gateway.source = `time+path match (≈${Math.round((near.distanceMs || 0) / 1000)}s from the app call) — ` +
        `nearest '${near.matchedPath}' trace; the gateway does not tag transaction ids, so treat as best-effort`;
      out.gateway.approximate = true;
    } else if (near && (near.__timeout || near.__error)) {
      out.gateway.liveError = near.__timeout ? 'gateway trace search timed out (9s)' : near.__error;
    }
  }
  if (!spans.length) {
    try {
      const st = (await db.console.query(
        `SELECT ts, trace_id, span_id, parent_id, service, kind, name, path, method,
                status_code, duration_ms, remote_service, error
         FROM apigw_slow_spans WHERE uil_transaction_id = $1 ORDER BY ts LIMIT 60`, [t])).rows;
      if (st.length) {
        spans = st.map(r => ({ traceId: r.trace_id, spanId: r.span_id, parentId: r.parent_id,
          service: r.service, kind: r.kind, name: r.name, path: r.path, method: r.method,
          status: r.status_code, durMs: r.duration_ms, tsMs: new Date(r.ts).getTime(),
          remoteService: r.remote_service, err: r.error }));
        out.gateway.source = 'stored outliers (errors + slow calls are kept permanently)';
      }
    } catch (e) { /* console-db hiccup → gateway stays empty */ }
  }
  if (spans.length) {
    spans.sort((a, b) => (a.tsMs || 0) - (b.tsMs || 0));
    const t0 = spans[0].tsMs || 0;
    out.gateway.spans = spans.slice(0, 60).map(s => ({
      service: s.service || null, kind: s.kind || null, method: s.method || null,
      path: mask((s.path || s.name || '')).split('?')[0].slice(0, 200) || null,
      status: s.status || null, err: s.err ? String(s.err).slice(0, 200) : null,
      ms: s.durMs || 0, at: s.tsMs ? new Date(s.tsMs).toISOString() : null,
      offset_ms: s.tsMs ? s.tsMs - t0 : 0,
      remote: s.remoteService || null, traceId: s.traceId || null
    }));
    out.gateway.total_ms = Math.max(...out.gateway.spans.map(s => (s.offset_ms || 0) + (s.ms || 0)));
    out.gateway.hops = out.gateway.spans.length;
  }

  // 3) UIL/OSB tier — request/response payloads from the integration log (optional source;
  // index-gated inside byTxn + MAX_EXECUTION_TIME hint + 6s budget here)
  const osb = require('./osbLog');
  if (osb.configured()) {
    const u = await timed(6000, () => osb.byTxn(t));
    out.uil = (u && u.__timeout) ? { configured: true, ok: false, error: 'uil_logs lookup timed out (6s)' }
      : (u && u.__error) ? { configured: true, ok: false, error: u.__error } : u;
  }

  out.found = !!(out.app.length || out.gateway.spans.length || (out.uil && out.uil.ok && out.uil.rows && out.uil.rows.length));
  return out;
}

module.exports = { forTxn, validTxn };
