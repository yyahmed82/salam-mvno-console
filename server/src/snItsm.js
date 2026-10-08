/* snItsm.js — the ServiceHub "Unified ITSM Dashboards" rebuilt natively from the ServiceNow API (8 Oct 2026, alpha.152)
 *
 * WHY NOT AN IFRAME. ServiceHub (servicehub.salam.sa) answers with X-Frame-Options / CSP frame-ancestors and asks for its
 * own SSO sign-in, so a frame inside the console shows a blank box or a login page. The same panels are read here
 * through the read-only integration account (SN_URL / SN_USER / SN_PASS, the account servicenow.js already uses) and
 * drawn by the console in its own look; "Open in ServiceHub" stays one click away for the drill-down.
 *
 * PANELS (the dashboard's Incident tab, then Problem · Change · Request · Work order):
 *   incident  per category · per priority · per close code · per assignment group · per channel (contact_type)
 *             reopened per category · open backlog ageing (same day … > 2 months) · daily volume · state × group
 *             SLA met vs breached (task_sla, response / resolution) · average time to resolve
 *   problem · change_request · sc_req_item · wm_order   per state (+ change per type / emergency share)
 * Aggregates come from /api/now/stats (count + group by); the daily volume reads opened_at only. Each call has a 15 s
 * timeout, 4 run at once, one failing panel says why and the others still draw. Cached 10 min per window. */
'use strict';
const configured = () => !!(process.env.SN_URL && process.env.SN_USER && process.env.SN_PASS);
const base = () => String(process.env.SN_URL || '').replace(/\/+$/, '');
const auth = () => 'Basic ' + Buffer.from(`${process.env.SN_USER}:${process.env.SN_PASS}`).toString('base64');
const KSA = 3 * 3600e3;
const snTime = d => new Date(d).toISOString().slice(0, 19).replace('T', ' ');   // sent as UTC — set the integration account's time zone to GMT so windows match exactly

async function get(path, params) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable (Node 18+)');
  const qs = new URLSearchParams(params).toString();
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(`${base()}${path}?${qs}`, { headers: { Accept: 'application/json', Authorization: auth() }, signal: ac.signal });
    if (r.status === 401 || r.status === 403) throw new Error(`ServiceNow ${r.status} — the integration account cannot read ${path.split('/').pop()}`);
    if (!r.ok) throw new Error(`ServiceNow HTTP ${r.status}`);
    return (await r.json()).result;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'ServiceNow timed out (15 s)' : e.message); }
  finally { clearTimeout(to); }
}
/* count grouped by one or more fields → [{ label, value, n }] (display values) */
async function stats(table, query, groupBy, extra) {
  const res = await get(`/api/now/stats/${table}`, { sysparm_query: query, sysparm_count: 'true', ...(groupBy ? { sysparm_group_by: groupBy } : {}), sysparm_display_value: 'true', ...(extra || {}) });
  const list = Array.isArray(res) ? res : [res];
  return list.map(x => {
    const g = x.groupby_fields || [];
    return { label: g.map(f => f.display_value || f.value || '(empty)').join(' · ') || 'all', keys: g.map(f => f.value), n: Number(((x.stats || {}).count) || 0), stats: x.stats || {} };
  }).sort((a, b) => b.n - a.n);
}
const count = async (table, query) => { const r = await stats(table, query, null); return r[0] ? r[0].n : 0; };

async function pool(tasks, n) {
  const out = {}; const q = Object.entries(tasks);
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const [k, fn] = q.shift(); try { out[k] = await fn(); } catch (e) { out[k] = { error: e.message }; } } }));
  return out;
}

const CACHE = new Map();
async function dashboard({ days = 7, to, force } = {}) {
  if (!configured()) return { configured: false };
  const end = to ? new Date(Date.parse(to + 'T00:00:00Z') - KSA) : new Date();
  const since = new Date(end.getTime() - days * 864e5);
  const key = `${days}:${to || ''}`;
  const hit = CACHE.get(key);
  if (!force && hit && Date.now() - hit.at < 10 * 60e3) return { ...hit.data, cached: true };
  const W = `opened_at>=${snTime(since)}^opened_at<${snTime(end)}`;
  const now = Date.now(), ago = d => snTime(new Date(now - d * 864e5));
  const AGING = [['Same day', 0, 1], ['1–2 days', 1, 2], ['2–5 days', 2, 5], ['5–7 days', 5, 7], ['1–2 weeks', 7, 14], ['2–4 weeks', 14, 28], ['1–2 months', 28, 60], ['> 2 months', 60, null]];
  const tasks = {
    total: () => count('incident', W),
    open: () => count('incident', 'active=true'),
    byCategory: () => stats('incident', W, 'category'),
    byPriority: () => stats('incident', W, 'priority'),
    byCloseCode: () => stats('incident', `${W}^close_codeISNOTEMPTY`, 'close_code'),
    byGroup: () => stats('incident', W, 'assignment_group'),
    byChannel: () => stats('incident', W, 'contact_type'),
    reopened: () => stats('incident', `${W}^reopen_count>0`, 'category'),
    byStateGroup: () => stats('incident', 'active=true', 'state,assignment_group'),
    avgResolve: () => stats('incident', `resolved_at>=${snTime(since)}^resolved_at<${snTime(end)}^calendar_stc>0`, null, { sysparm_avg_fields: 'calendar_stc' }),
    sla: () => stats('task_sla', `task.sys_class_name=incident^sys_created_on>=${snTime(since)}^sys_created_on<${snTime(end)}^stageINcompleted,breached,in_progress`, 'sla.target,has_breached'),
    trend: async () => {
      const rows = await get('/api/now/table/incident', { sysparm_query: `${W}^ORDERBYopened_at`, sysparm_fields: 'opened_at', sysparm_limit: '20000', sysparm_exclude_reference_link: 'true' });
      const m = {}; for (const r of rows || []) { const d = String(r.opened_at || '').slice(0, 10); if (d) m[d] = (m[d] || 0) + 1; }
      return Object.entries(m).sort().map(([day, n]) => ({ day, n }));
    },
    problem: () => stats('problem', 'active=true', 'state'),
    problemNew: () => count('problem', `opened_at>=${snTime(since)}`),
    change: () => stats('change_request', `start_date>=${snTime(since)}^start_date<${snTime(end)}`, 'state'),
    changeType: () => stats('change_request', `start_date>=${snTime(since)}^start_date<${snTime(end)}`, 'type'),
    request: () => stats('sc_req_item', `opened_at>=${snTime(since)}`, 'state'),
    requestOpen: () => count('sc_req_item', 'active=true'),
    workorder: () => stats('wm_order', `opened_at>=${snTime(since)}`, 'state')
  };
  AGING.forEach(([label, a, b], i) => { tasks['age' + i] = () => count('incident', `active=true^opened_at<=${ago(a)}${b != null ? `^opened_at>${ago(b)}` : ''}`); });
  const r = await pool(tasks, 4);
  const val = v => (v && v.error ? null : v);
  const errors = Object.entries(r).filter(([, v]) => v && v.error).map(([k, v]) => `${k}: ${v.error}`);
  const sla = { resolution: { met: 0, breached: 0 }, response: { met: 0, breached: 0 } };
  for (const x of Array.isArray(r.sla) ? r.sla : []) {
    const target = /resol/i.test(x.keys[0] || x.label) ? 'resolution' : /resp/i.test(x.keys[0] || x.label) ? 'response' : null; if (!target) continue;
    if (String(x.keys[1]) === 'true') sla[target].breached += x.n; else sla[target].met += x.n;
  }
  ['resolution', 'response'].forEach(k => { const t = sla[k].met + sla[k].breached; sla[k].pct = t ? Math.round(sla[k].met * 1000 / t) / 10 : null; });
  const avgSec = Array.isArray(r.avgResolve) && r.avgResolve[0] ? Number(((r.avgResolve[0].stats || {}).avg || {}).calendar_stc) : null;
  const ct = Array.isArray(r.changeType) ? r.changeType : [];
  const chgTotal = ct.reduce((a, x) => a + x.n, 0), chgEmergency = ct.filter(x => /emergency/i.test(x.label)).reduce((a, x) => a + x.n, 0);
  const data = {
    days, from: since.toISOString(), to: end.toISOString(), generatedAt: new Date().toISOString(), errors,
    incident: { total: val(r.total), open: val(r.open), byCategory: val(r.byCategory), byPriority: val(r.byPriority), byCloseCode: val(r.byCloseCode), byGroup: val(r.byGroup),
      byChannel: val(r.byChannel), reopened: val(r.reopened), byStateGroup: Array.isArray(r.byStateGroup) ? r.byStateGroup.slice(0, 60) : null,
      aging: AGING.map(([label], i) => ({ label, n: typeof r['age' + i] === 'number' ? r['age' + i] : null })), trend: val(r.trend),
      avgResolveHours: Number.isFinite(avgSec) && avgSec > 0 ? Math.round(avgSec / 360) / 10 : null },
    sla,
    problem: { byState: val(r.problem), opened: val(r.problemNew) },
    change: { byState: val(r.change), byType: val(r.changeType), total: chgTotal, emergencyPct: chgTotal ? Math.round(chgEmergency * 1000 / chgTotal) / 10 : null },
    request: { byState: val(r.request), open: val(r.requestOpen) },
    workorder: { byState: val(r.workorder) }
  };
  CACHE.set(key, { at: Date.now(), data });
  if (CACHE.size > 20) CACHE.delete(CACHE.keys().next().value);
  return data;
}

module.exports = { configured, dashboard, stats };
