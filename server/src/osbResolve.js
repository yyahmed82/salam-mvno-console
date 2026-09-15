'use strict';

const osb = require('./osbArchive');

function normKey(v) {
  const raw = String(v || '').trim();
  const d = raw.replace(/\D/g, '');
  if (/^(?:966|0)?5\d{8}$/.test(d)) return '966' + d.slice(-9);
  if (/^[12]\d{9}$/.test(d)) return d;
  return d || raw.slice(0, 80);
}

function addKey(out, key, source) {
  const k = normKey(key);
  if (!k || out.some(x => x.key === k)) return;
  out.push({ key: k, source: source || 'searched key' });
}

async function candidateKeys(key, lineRef = null) {
  const out = [];
  addKey(out, key, 'searched key');
  try {
    const live = require('./liveBss');
    const c = await live.resolveCustomer(key, lineRef);
    if (c && c.msisdn) addKey(out, c.msisdn, c.line_source || 'resolved service line');
    if (c && c.nid) addKey(out, c.nid, 'resolved national id');
    const lf = await live.linesFor(key);
    for (const l of ((lf && lf.lines) || [])) addKey(out, l.msisdn, l.source || 'customer service line');
  } catch (e) {
    out.resolve_error = String(e.message || e).slice(0, 140);
  }
  return out;
}

function uniqRows(rows, keyFn) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    const k = keyFn(r);
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

function rowKey(r, kind) {
  if (r && r.id != null) return kind + ':' + r.id;
  return [kind, r && r.ts, r && r.server, r && r.ecid, r && r.uri, r && r.pipeline, r && r.stage, r && r.label, r && r.status].join('|');
}

function score(summary) {
  const s = summary || {};
  return Number(s.pipeline_records || 0) * 10
    + Number(s.direct_backend_hits || 0)
    + Number(s.backend_hops || 0)
    + Number(s.faults || 0) * 20;
}

async function customerSummary(key, { lineRef = null, from = null, to = null, limit = 120 } = {}) {
  if (!(await osb.available())) return null;
  const candidates = await candidateKeys(key, lineRef);
  const runs = [];
  for (const c of candidates.length ? candidates : [{ key: normKey(key), source: 'searched key' }]) {
    if (!c.key) continue;
    try {
      const r = await osb.customerSummary(c.key, from, to, limit);
      runs.push({ key: c.key, source: c.source, result: r, score: score(r && r.summary) });
    } catch (e) {
      runs.push({ key: c.key, source: c.source, error: String(e.message || e).slice(0, 140), score: 0 });
    }
  }
  const good = runs.filter(r => r.result);
  if (!good.length) return null;
  const base = good[0].result;
  const ev = {
    pipeline: uniqRows(good.flatMap(r => r.result.pipeline || []), r => rowKey(r, 'p')),
    access: uniqRows(good.flatMap(r => r.result.access || []), r => rowKey(r, 'a')),
    access_by_msisdn: uniqRows(good.flatMap(r => r.result.access_by_msisdn || []), r => rowKey(r, 'q'))
  };
  const best = runs.slice().sort((a, b) => b.score - a.score)[0];
  const keyUsed = best && best.key ? best.key : (candidates[0] && candidates[0].key) || normKey(key);
  const summary = osb.summariseCustomerEvents(ev, base.archive_window, keyUsed);
  summary.candidate_keys = runs.map(r => ({
    key: r.key, source: r.source, score: r.score,
    pipeline_records: r.result && r.result.summary ? r.result.summary.pipeline_records : 0,
    backend_hops: r.result && r.result.summary ? r.result.summary.backend_hops : 0,
    direct_backend_hits: r.result && r.result.summary ? r.result.summary.direct_backend_hits : 0,
    faults: r.result && r.result.summary ? r.result.summary.faults : 0,
    error: r.error || null
  }));
  summary.resolve_error = candidates.resolve_error || null;
  return { from: base.from, to: base.to, archive_window: base.archive_window, summary, ...ev };
}

async function timelineEvents(key, opts = {}) {
  const r = await customerSummary(key, opts);
  return r ? osb.timelineFromCustomer(r) : { events: [], summary: null, archive_window: null };
}

module.exports = { normKey, candidateKeys, customerSummary, timelineEvents };
