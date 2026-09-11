/* people.js — ONE description of a console user, for every screen that names one (11 Sep 2026).
 *
 * WHY. The Alerts owner column grew a proper person card — avatar, real name, e-mail, role · team, and the
 * live workload (open held, acked in 24 h, average time-to-acknowledge). Everywhere else a user was still a
 * bare login: "console", "a.pandey.tcs@salammobile.sa", "y.yahmed.sns". The same human has to look the same
 * on every screen, so the card is built here once and reused: /api/alerts owners, the AI budget rows, the
 * users admin, the audit log.
 *
 * cards(C, emails)  → { email: { name, role, role_label, team, business, enabled, open_held, acked_24h,
 *                                acked_7d, avg_ack_min_7d, resolved_24h } }   (incident KPIs included)
 * directory(C)      → the same without the incident KPIs, for every enabled user — cached 60 s, so any page
 *                     can name a person without its own query. */
'use strict';
const roles = require('./roles');

const lc = e => String(e || '').toLowerCase().trim();
const uniq = a => [...new Set(a.filter(Boolean).map(lc))];

/* name / role / team / enabled for a set of e-mails — no incident statistics */
async function basics(C, emails) {
  const list = uniq(emails); if (!list.length) return {};
  const us = (await C.query(
    `SELECT lower(email) AS email, name, role, roles, team, business, enabled
       FROM console_users WHERE lower(email) = ANY($1)`, [list])).rows;
  const out = {};
  for (const e of list) {
    const u = us.find(x => x.email === e) || {};
    const rname = u.role ? (roles.role(u.role) || {}) : {};
    out[e] = { email: e, name: u.name || null, role: u.role || null, role_label: rname.label || null,
      team: u.team || rname.team || null, business: u.business || null, enabled: u.enabled !== false,
      known: !!us.find(x => x.email === e) };
  }
  return out;
}

/* basics + the live incident workload (what the Alerts owner column shows) */
async function cards(C, emails) {
  const out = await basics(C, emails); const list = Object.keys(out);
  if (!list.length) return out;
  try {
    const st = (await C.query(
      `SELECT lower(ack_by) AS email,
              count(*) FILTER (WHERE status='open')::int AS open_held,
              count(*) FILTER (WHERE ack_at >= now() - interval '24 hours')::int AS acked_24h,
              count(*) FILTER (WHERE ack_at >= now() - interval '7 days')::int AS acked_7d,
              round(avg(EXTRACT(EPOCH FROM (ack_at - opened_wall))/60) FILTER (WHERE ack_at >= now() - interval '7 days'))::int AS avg_ack_min_7d,
              count(*) FILTER (WHERE status='resolved' AND resolved_at >= now() - interval '24 hours')::int AS resolved_24h
       FROM alerts WHERE lower(ack_by) = ANY($1) GROUP BY 1`, [list])).rows;
    const by = Object.fromEntries(st.map(x => [x.email, x]));
    for (const e of list) {
      const s = by[e] || {};
      Object.assign(out[e], { open_held: s.open_held || 0, acked_24h: s.acked_24h || 0, acked_7d: s.acked_7d || 0,
        avg_ack_min_7d: s.avg_ack_min_7d ?? null, resolved_24h: s.resolved_24h || 0 });
    }
  } catch (_) { /* alerts table unavailable — the basics still stand */ }
  return out;
}

/* every enabled user, cached — so a page can name anyone without knowing the e-mails up front */
let _dir = null, _dirAt = 0;
async function directory(C, { ttlMs = 60000 } = {}) {
  if (_dir && Date.now() - _dirAt < ttlMs) return _dir;
  const rows = (await C.query(
    `SELECT lower(email) AS email, name, role, roles, team, business, enabled
       FROM console_users ORDER BY email`).catch(() => ({ rows: [] }))).rows;
  const out = {};
  for (const u of rows) {
    const rname = u.role ? (roles.role(u.role) || {}) : {};
    out[u.email] = { email: u.email, name: u.name || null, role: u.role || null, role_label: rname.label || null,
      team: u.team || rname.team || null, business: u.business || null, enabled: u.enabled !== false, known: true };
  }
  _dir = out; _dirAt = Date.now(); return out;
}
function invalidate() { _dir = null; }

module.exports = { basics, cards, directory, invalidate, lc };
