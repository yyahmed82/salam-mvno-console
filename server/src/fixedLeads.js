/* fixedLeads.js — Fixed › Leads API (OCU retention team, 9 Oct 2026). Mounted from fixed.js under /api/fixed/leads/*.
 *
 * WHO: the `fixed_leads` view, pinned in roles.js to the `ocu` role and Super Admin (the matrix cannot hand it to anyone
 * else), checked again here on the session's roles. Supervisors (Leads › Settings, super admins) assign, import and run
 * challenges; members work their own queue and take leads from the pool.
 * CONFIDENTIAL BY CONSTRUCTION:
 *   - nothing answers before the member accepted today's terms (POST /accept, one row per person, KSA day and terms
 *     version, with IP and device; audited leads.accept) — 403 accept_required otherwise;
 *   - lists and details are masked; POST /:id/reveal returns the name and number of ONE lead the member works, read live
 *     from its source, audited (leads.reveal) and capped per hour and per day — over the cap: 429, the console owners mailed;
 *   - POST /unmask (alpha.168) shows the contacts of the leads on screen for a few minutes: supervisors and super admins on any
 *     list, members on their own leads when Settings › Protection allows it; never a "do not call" lead; audited pii.unmask with
 *     the lead ids, one 'unmask' event per lead, capped per person per day (super admins audited, not capped);
 *   - no export endpoint; demo mode never records or replays this namespace (demo.js SKIP); no response cache;
 *   - digits that look like a number or an id are masked in comments and remarks.
 * The harvester (fixedLeadsHarvest.js) and the 4-a-day digest run in this process (start()); Agent 2's coaching runs in
 * salam-agent-incident (fixedLeadsCoach.js), on demand from here. */
'use strict';
const db = require('./db');
const S = require('./fixedLeadsStore');
const H = require('./fixedLeadsHarvest');
const CO = require('./fixedLeadsCoach');

const C = S.C;
const log = (...a) => console.log('[leads]', ...a);
const isRealSuper = req => !!(req.isRoot || req.realRole === 'super_admin' || (Array.isArray(req.realRoles) && req.realRoles.includes('super_admin')));
const meOf = req => String(req.viewAs ? req.viewAs.email : req.actor || '').toLowerCase();
const canManage = (req, desk) => (isRealSuper(req) && !req.viewAs) || desk.supervisors.includes(meOf(req));
const canWork = (req, desk, L) => canManage(req, desk) || (!!L.assignee && L.assignee === meOf(req));
const canSee = (req, desk, L) => canManage(req, desk) || !L.assignee || L.assignee === meOf(req) || L.won_by === meOf(req);
const bad = (status, msg, code) => Object.assign(new Error(msg), { status, code });
/* digits that could be a phone number or an id (7 or more) are masked in free text, the last two kept */
const scrub = t => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\+?\d[\d\s-]{5,}\d/g, m => { const d = m.replace(/\D/g, ''); return d.length >= 7 ? '•'.repeat(d.length - 2) + d.slice(-2) : m; }).trim();
const iso = v => v ? new Date(v).toISOString() : null;

/* ------------------------------------------------------------------ live contacts (reveal one lead · unmask a page)
 * Read live from each lead's source, never stored. Name: the journey's, else the same person's Salam Home account, Salam Fixed (BSS)
 * or Salam Mobile record (fixedLeadsHarvest.namesFor — alpha.170), with where it came from; plus the e-mail and language the
 * customer gave. → Map(lead id → { name: { en, ar }, from, mobile, email, lang } | { none: why }) */
async function contactsOf(leads) {
  const out = new Map(), blocks = new Map();
  const jr = leads.filter(L => ['epurchase', 'salamhome', 'sda', 'qr'].includes(L.source)), pr = leads.filter(L => L.source === 'sda_promoter');
  if (!db.nexus) [...jr, ...pr].forEach(L => out.set(L.id, { none: 'nexus is not configured — the number cannot be read' }));
  else {
    if (jr.length) {
      const r = await db.nexus.query(`SELECT id, context->'customer' AS c, context->'storedYakeenCustomer' AS yk FROM workflow_states WHERE id = ANY($1::text[])`, [jr.map(L => String(L.source_ref))]);
      const m = new Map(r.rows.map(x => [String(x.id), x]));
      jr.forEach(L => { const x = m.get(String(L.source_ref)); if (x && x.c) blocks.set(L.id, { c: x.c, yk: x.yk, journey: String(L.source_ref) }); else out.set(L.id, { none: 'the journey is no longer in nexus' }); });
    }
    if (pr.length) {
      const ref = L => String(L.source_ref).replace(/^L/, '');
      const r = await db.nexus.query(`SELECT l.id, l."leadWorkflowId" AS j, w.context->'customer' AS c, w.context->'storedYakeenCustomer' AS yk FROM leads l LEFT JOIN workflow_states w ON w.id = l."leadWorkflowId" WHERE l.id = ANY($1::text[])`, [pr.map(ref)]);
      const m = new Map(r.rows.map(x => [String(x.id), x]));
      pr.forEach(L => { const x = m.get(ref(L)); if (x && x.c) blocks.set(L.id, { c: x.c, yk: x.yk, journey: x.j || null }); else out.set(L.id, { none: 'the promoter lead has no customer block' }); });
    }
    const names = blocks.size ? await H.namesFor([...blocks.entries()].map(([id, b]) => ({ key: id, customer: b.c, yk: b.yk, nid: S.normNid(b.c && b.c.id), journey: b.journey }))) : new Map();
    for (const [id, b] of blocks) {
      const c = b.c && typeof b.c === 'object' ? b.c : {}; const mob = S.normMobile(c.mobilePhone);
      if (!mob) { out.set(id, { none: 'no mobile number in the source' }); continue; }
      const n = names.get(id);
      out.set(id, { name: n ? { en: n.en || null, ar: n.ar || null } : { en: null, ar: null }, from: n ? n.from : null, mobile: mob,
        email: typeof c.email === 'string' && /@/.test(c.email) ? c.email.trim() : null, lang: ['ar', 'en'].includes(c.language) ? c.language : null });
    }
  }
  for (const L of leads.filter(x => x.source === 'import')) { const p = S.dec(L.pii_enc); const mob = p && S.normMobile(p.mobile); out.set(L.id, mob ? { name: { en: p.name || null, ar: null }, from: p.name ? 'import' : null, mobile: mob, email: null, lang: null } : { none: 'the imported contact cannot be decrypted (LEADS_PII_KEY changed or missing)' }); }
  for (const L of leads.filter(x => x.source === 'dashpro')) {
    try { const d = await H.dashRow(String(L.source_ref).replace(/^D/, '')); const mob = d && S.normMobile(d.mobile_number); const nm = d ? [d.fname, d.lname].filter(Boolean).join(' ') : '';
      out.set(L.id, mob ? { name: { en: nm || null, ar: null }, from: nm ? 'dashpro' : null, mobile: mob, email: d.email || null, lang: null } : { none: 'the DashPro row is no longer readable' }); }
    catch (e) { out.set(L.id, { none: 'DashPro: ' + e.message.slice(0, 60) }); }
  }
  for (const L of leads) if (!out.has(L.id)) out.set(L.id, { none: 'unknown source' });
  return out;
}
async function contactOf(L) {
  const x = (await contactsOf([L])).get(L.id) || { none: 'unknown source' };
  if (!x.mobile) throw bad(404, 'No number: ' + (x.none || 'not in the source'));
  return x;
}
const unmaskCfg = desk => ({ who: ['off', 'supervisors', 'members'].includes(desk.unmaskWho) ? desk.unmaskWho : 'members',
  minutes: Math.max(1, Math.min(60, S.n(desk.unmaskMinutes) || 10)), perDay: Math.max(10, Math.min(5000, S.n(desk.unmaskPerDay) || 600)) });

/* ------------------------------------------------------------------ rows */
const ROW = `l.id, l.source, l.product, l.plan_id, l.plan_label, l.svc_type, l.plan_type, l.channel, l.dealer, l.region, l.city, l.step_label, l.reason, l.reason_class, l.customer_mask, l.mobile_mask, l.nid_kind,
  l.relation, l.occurred_at, l.status, l.assignee, l.assigned_at, l.priority, l.score, l.temp, l.next_action_at, l.attempts, l.first_contact_at, l.last_contact_at,
  l.offer_code, l.offer_months, l.won_at, l.won_auto, l.won_by, l.won_ref, l.lost_reason, l.closed_at, l.batch_id, l.remark, l.created_at, l.updated_at,
  coalesce((l.facts->>'attempts')::int, 1) AS journeys, l.facts->>'period' AS period, l.facts->>'lang' AS lang, l.facts->>'bss' AS bss, l.facts->>'nm' AS name_from`;
async function getLead(id) { const r = await C().query(`SELECT * FROM fixed_leads WHERE id = $1`, [id]); return r.rows[0] || null; }
function view(L) {
  const out = {}; for (const k of ['id', 'source', 'product', 'plan_id', 'plan_label', 'svc_type', 'plan_type', 'channel', 'dealer', 'region', 'city', 'step_label', 'reason', 'reason_class', 'customer_mask', 'mobile_mask', 'nid_kind',
    'relation', 'occurred_at', 'status', 'assignee', 'assigned_at', 'priority', 'score', 'temp', 'next_action_at', 'attempts', 'first_contact_at', 'last_contact_at', 'offer_code', 'offer_months',
    'won_at', 'won_auto', 'won_by', 'won_ref', 'lost_reason', 'closed_at', 'batch_id', 'remark', 'created_at', 'updated_at', 'journeys', 'period', 'lang', 'bss', 'name_from']) out[k] = L[k] === undefined ? null : L[k];
  if (out.journeys == null) out.journeys = S.n((L.facts || {}).attempts) || 1;
  const F = L.facts || {};
  if (out.period == null && F.period) out.period = F.period;
  if (out.lang == null && F.lang) out.lang = F.lang;
  if (out.name_from == null && F.nm) out.name_from = F.nm;
  out.bss = out.bss === true || out.bss === 'true' || F.bss === true;
  if (/^\d{1,6}$/.test(String(out.plan_label || ''))) out.plan_label = S.planLabel(out.plan_label, null, out.product);
  if (!out.svc_type) out.svc_type = S.svcType(L.workflow, L.plan_id, L.plan_label, L.product);
  out.facts = L.facts ? { invoice: L.facts.invoice || null, nafath: L.facts.nafath || null, provider: L.facts.provider || null, error: L.facts.error || null, dealerReason: L.facts.dealerReason || null, leadStatus: L.facts.leadStatus || null } : {};
  return out;
}
const OPEN_SQL = `ARRAY['${S.OPEN.join("','")}']`, CLOSED_SQL = `ARRAY['${S.CLOSED.join("','")}']`;

/* ------------------------------------------------------------------ reveal caps */
const capMailed = new Map();
async function revealAllowed(req, desk) {
  const me = String(req.actor).toLowerCase();
  const r = await C().query(`SELECT count(*) FILTER (WHERE at > now() - interval '1 hour')::int AS h, count(*) FILTER (WHERE at >= $2)::int AS d FROM fixed_lead_events WHERE actor = $1 AND kind = 'reveal' AND at >= $2`, [me, S.dayStart()]);
  const x = r.rows[0] || {}; const ph = S.n(desk.revealPerHour) || 40, pd = S.n(desk.revealPerDay) || 150;
  if (x.h >= ph || x.d >= pd) return { ok: false, hour: x.h, day: x.d, ph, pd };
  return { ok: true, hour: x.h, day: x.d, ph, pd };
}
async function mailOwners(subject, html) {
  try {
    const notify = require('./notify');
    const r = await C().query(`SELECT email FROM console_users WHERE enabled AND (role = 'super_admin' OR 'super_admin' = ANY(roles))`);
    if (r.rowCount) await notify.sendHtml(r.rows.map(x => x.email), subject, notify.shell({ title: subject, pill: 'Leads', pillColor: '#b91c1c', bodyHtml: html }), []);
  } catch (e) { log('owner mail', e.message); }
}

/* ------------------------------------------------------------------ board (my day · team · leaderboard · challenges · feed) */
async function board(req, desk) {
  const me = meOf(req), mgr = canManage(req, desk);
  const t0 = S.dayStart(), w0 = S.weekStart(), lw0 = new Date(w0.getTime() - 7 * 864e5);
  const q = async (sql, p) => { try { return (await C().query(sql, p)).rows; } catch (_) { return []; } };
  const [mine, myEv, team, lb, lastWeek, feed, ch, src, brief, slaRows, selfWon] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS open, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND next_action_at <= now() + interval '15 minutes')::int AS due,
          count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND first_contact_at IS NULL)::int AS untouched, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND temp = 'hot')::int AS hot
        FROM fixed_leads WHERE assignee = $1`, [me]),
    q(`SELECT coalesce(sum(points) FILTER (WHERE at >= $2),0)::int AS pts_week, coalesce(sum(points) FILTER (WHERE at >= $3),0)::int AS pts_today,
          count(*) FILTER (WHERE kind='won' AND at >= $3)::int AS won_today, count(*) FILTER (WHERE kind='won' AND at >= $2)::int AS won_week,
          count(*) FILTER (WHERE (kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false))) AND at >= $3)::int AS calls_today, count(*) FILTER (WHERE (kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false))) AND at >= $3 AND (detail->>'contact')::boolean)::int AS contacts_today,
          count(*) FILTER (WHERE (kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false))) AND at >= $2)::int AS calls_week, count(*) FILTER (WHERE (kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false))) AND at >= $2 AND (detail->>'contact')::boolean)::int AS contacts_week
        FROM fixed_lead_events WHERE actor = $1 AND at >= $2`, [me, w0, t0]),
    q(`SELECT count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS open, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND assignee IS NULL)::int AS pool,
          count(*) FILTER (WHERE created_at >= $1)::int AS new_today, count(*) FILTER (WHERE status='won' AND won_at >= $2)::int AS won_week,
          count(*) FILTER (WHERE status='won' AND won_at >= $2 AND won_by IS NOT NULL)::int AS won_week_ocu,
          count(*) FILTER (WHERE status = ANY(${CLOSED_SQL}) AND closed_at >= $2)::int AS closed_week,
          count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND temp='hot')::int AS hot,
          count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND next_action_at < now())::int AS overdue
        FROM fixed_leads`, [t0, w0]),
    q(`SELECT e.actor, coalesce(sum(e.points),0)::int AS pts, count(*) FILTER (WHERE e.kind='won')::int AS won, count(*) FILTER (WHERE e.kind='call' OR (e.kind='won' AND NOT coalesce((e.detail->>'auto')::boolean, false)))::int AS calls,
          count(*) FILTER (WHERE (e.kind='call' OR (e.kind='won' AND NOT coalesce((e.detail->>'auto')::boolean, false))) AND (e.detail->>'contact')::boolean)::int AS contacts, count(*) FILTER (WHERE e.kind='offer')::int AS offers
        FROM fixed_lead_events e WHERE e.at >= $1 AND e.actor <> 'system' AND e.kind IN ('call','won','offer') GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 20`, [w0]),
    q(`SELECT actor, coalesce(sum(points),0)::int AS pts, count(*) FILTER (WHERE kind='won')::int AS won FROM fixed_lead_events WHERE at >= $1 AND at < $2 AND actor <> 'system' AND kind IN ('call','won','offer')
        GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 1`, [lw0, w0]),
    /* the team's own wins and offers; customers who ordered on their own (no OCU call) are one summary line, not a stream */
    q(`SELECT e.at, e.actor, e.kind, e.detail, l.product, l.plan_label, l.source FROM fixed_lead_events e JOIN fixed_leads l ON l.id = e.lead_id
        WHERE e.kind IN ('won','offer') AND e.actor <> 'system' AND e.at > now() - interval '7 days' ORDER BY e.at DESC LIMIT 12`),
    q(`SELECT * FROM fixed_lead_challenges WHERE active AND (ends_at IS NULL OR ends_at > now() - interval '1 day') ORDER BY created_at DESC LIMIT 12`),
    q(`SELECT source, product, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS open, count(*) FILTER (WHERE created_at >= $1)::int AS new_week,
          count(*) FILTER (WHERE status='won' AND won_at >= $1)::int AS won_week FROM fixed_leads GROUP BY 1,2 ORDER BY 3 DESC`, [w0]),
    CO.lastBrief(),
    q(`SELECT avg(extract(epoch FROM (first_contact_at - greatest(created_at, coalesce(assigned_at, created_at)))) / 60)::int AS avg_min,
          count(*) FILTER (WHERE first_contact_at - greatest(created_at, coalesce(assigned_at, created_at)) <= ($1 || ' minutes')::interval)::int AS within, count(*)::int AS n
        FROM fixed_leads WHERE first_contact_at >= $2`, [String(S.n(desk.slaFirstContactMin) || 120), w0]),
    q(`SELECT count(*)::int AS n FROM fixed_lead_events WHERE kind = 'won' AND actor = 'system' AND at > now() - interval '7 days'`),
  ]);
  const people = await S.members(); const nameOf = e => { const m = people.find(x => x.email === e); return m ? m.name : String(e || '').split('@')[0]; };
  /* alpha.170: a super admin who is not on the OCU desk is greeted by name (not by the e-mail's first letter) and sees the team's day */
  let myName = (people.find(x => x.email === me) || {}).name || null;
  if (!myName) { const r = await q(`SELECT name FROM console_users WHERE lower(email) = $1`, [me]); myName = (r[0] && r[0].name) || null; }
  const teamDay = (await q(`SELECT count(*) FILTER (WHERE kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false)))::int AS calls,
      count(*) FILTER (WHERE (kind='call' OR (kind='won' AND NOT coalesce((detail->>'auto')::boolean, false))) AND (detail->>'contact')::boolean)::int AS contacts,
      count(*) FILTER (WHERE kind='won')::int AS won FROM fixed_lead_events WHERE at >= $1 AND actor <> 'system'`, [t0]))[0] || {};
  /* challenges: progress from the events of their period */
  const challenges = [];
  for (const c of ch) {
    const from = c.period === 'day' ? t0 : c.period === 'month' ? new Date(Date.UTC(new Date(Date.now() + S.KSA).getUTCFullYear(), new Date(Date.now() + S.KSA).getUTCMonth(), 1) - S.KSA) : w0;
    const start = c.starts_at && new Date(c.starts_at) > from ? new Date(c.starts_at) : from;
    const metric = { wins: `count(*) FILTER (WHERE kind='won')`, contacts: `count(*) FILTER (WHERE kind='call' AND (detail->>'contact')::boolean)`, points: `coalesce(sum(points),0)`,
      offers: `count(*) FILTER (WHERE kind='offer')`, calls: `count(*) FILTER (WHERE kind='call')`, wins_500: `count(*) FILTER (WHERE kind='won' AND detail->>'offer' = 'OCU-F500-3')`,
      wins_std: `count(*) FILTER (WHERE kind='won' AND coalesce(detail->>'offer','STD') = 'STD')` }[c.metric] || `count(*) FILTER (WHERE kind='won')`;
    const r = await q(`SELECT ${metric}::int AS v FROM fixed_lead_events WHERE at >= $1 AND actor <> 'system'${c.scope === 'member' ? ' AND actor = $2' : ''}`, c.scope === 'member' ? [start, me] : [start]);
    const v = S.n((r[0] || {}).v);
    challenges.push({ id: c.id, title: c.title, metric: c.metric, target: c.target, scope: c.scope, period: c.period, reward: c.reward, progress: v, done: v >= c.target, ends_at: c.ends_at, created_by: c.created_by });
  }
  const m = mine[0] || {}, e = myEv[0] || {}, t = team[0] || {}, sl = slaRows[0] || {};
  const rank = lb.findIndex(x => x.actor === me);
  return {
    me: { email: me, name: myName || nameOf(me), ocu: people.some(x => x.email === me && !x.notOcu), manager: mgr, open: S.n(m.open), due: S.n(m.due), untouched: S.n(m.untouched), hot: S.n(m.hot), pts_week: S.n(e.pts_week), pts_today: S.n(e.pts_today),
      won_today: S.n(e.won_today), won_week: S.n(e.won_week), calls_today: S.n(e.calls_today), contacts_today: S.n(e.contacts_today), calls_week: S.n(e.calls_week), contacts_week: S.n(e.contacts_week),
      rank: rank >= 0 ? rank + 1 : null, targets: desk.targets },
    team: { open: S.n(t.open), pool: S.n(t.pool), new_today: S.n(t.new_today), won_week: S.n(t.won_week), won_week_ocu: S.n(t.won_week_ocu), closed_week: S.n(t.closed_week), hot: S.n(t.hot), overdue: S.n(t.overdue),
      /* the team's own conversion: wins credited to a member over the leads the team closed (a customer who ordered before anyone
       * called is closed too, but nobody worked it) */
      conv_week: (S.n(t.closed_week) - (S.n(t.won_week) - S.n(t.won_week_ocu))) > 0 ? Math.round(S.n(t.won_week_ocu) / (S.n(t.closed_week) - (S.n(t.won_week) - S.n(t.won_week_ocu))) * 100) : null, sla_min: S.n(desk.slaFirstContactMin) || 120, first_contact_avg_min: sl.avg_min == null ? null : S.n(sl.avg_min),
      first_contact_within: S.n(sl.n) ? Math.round(S.n(sl.within) / S.n(sl.n) * 100) : null, by_source: src,
      calls_today: S.n(teamDay.calls), contacts_today: S.n(teamDay.contacts), won_today: S.n(teamDay.won) },
    leaderboard: lb.map((x, i) => ({ rank: i + 1, email: x.actor, name: nameOf(x.actor), points: x.pts, won: x.won, calls: x.calls, contacts: x.contacts, offers: x.offers, me: x.actor === me })),
    best: lastWeek[0] ? { email: lastWeek[0].actor, name: nameOf(lastWeek[0].actor), points: lastWeek[0].pts, won: lastWeek[0].won, week: S.ksaDay(lw0.getTime()) } : null,
    challenges,
    feed: feed.map(f => ({ at: f.at, who: f.actor === 'system' ? null : nameOf(f.actor), kind: f.kind, auto: !!(f.detail && f.detail.auto), product: f.product, plan: f.plan_label, source: f.source,
      offer: f.detail && (f.detail.offer || f.detail.code) || null })),
    self_won_7d: S.n((selfWon[0] || {}).n),
    /* a brief written over an empty desk (go-live day) is not shown once the desk has leads — the coach writes today's again */
    brief: brief && !(S.n(((brief.summary || {}).pipe || {}).open) === 0 && S.n(t.open) > 0) ? { at: brief.created_at, text: brief.narrative } : null,
    week: S.ksaDay(w0.getTime()),
  };
}

/* ------------------------------------------------------------------ import (supervisors) */
const COLS = {
  name: [/^(customer )?name$/i, /full ?name|customer name|الاسم|اسم العميل/i, /name/i],
  mobile: [/mobile|msisdn|phone|contact|جوال|الجوال|هاتف|رقم التواصل/i],
  nid: [/national|id ?number|iqama|هوية|الهوية|إقامة|اقامة/i],
  product: [/product|package|plan|speed|offer|الباقة|المنتج/i],
  reason: [/reason|remark|note|comment|سبب|ملاحظ/i],
  city: [/city|المدينة|مدينة/i], region: [/district|region|area|الحي|المنطقة/i],
  order: [/order|service ?no|account|رقم الطلب|رقم الخدمة/i], date: [/date|time|التاريخ|تاريخ/i],
};
function pickCols(headers) {
  const h = headers.map(x => String(x || '').trim()); const used = new Set(); const out = {};
  for (const [k, res] of Object.entries(COLS)) { for (const re of res) { const i = h.findIndex((x, j) => !used.has(j) && re.test(x)); if (i >= 0) { out[k] = i; used.add(i); break; } } }
  return out;
}
async function importBatch(req, body, desk) {
  if (!S.piiReady()) throw bad(503, 'Batch import needs LEADS_PII_KEY on the server (the imported contacts are kept encrypted) — ask the console owner to set it.');
  const name = String(body.name || body.fileName || 'Imported batch').slice(0, 120);
  const reasonClass = ['rejected_install', 'campaign', 'lead_stale', 'abandoned'].includes(body.reasonClass) ? body.reasonClass : 'rejected_install';
  const defReason = String(body.reason || (reasonClass === 'rejected_install' ? 'rejected the installation' : 'imported list')).slice(0, 200);
  const defProduct = body.product === '5g' ? '5g' : 'ftth';
  let headers = [], rows = [];
  if (body.b64) {
    const buf = Buffer.from(String(body.b64), 'base64'); if (buf.length > 6 * 1024 * 1024) throw bad(413, 'The file is larger than 6 MB.');
    const x = await require('./opsReportsParse').extract(buf, String(body.fileName || 'leads.xlsx'));
    const tables = []; (x.pages || []).forEach(p => (p.tables || []).forEach(t => tables.push(t)));
    const t = tables.sort((a, b) => (b.rows || []).length - (a.rows || []).length)[0];
    if (!t) throw bad(400, x.note || 'No table found in the file — use .xlsx or .csv with a header row (name, mobile, national id, product, reason).');
    headers = t.headers || []; rows = t.rows || [];
  } else if (Array.isArray(body.rows)) { headers = body.headers || Object.keys(body.rows[0] || {}); rows = body.rows.map(r => Array.isArray(r) ? r : headers.map(k => r[k])); }
  if (rows.length > 2000) rows = rows.slice(0, 2000);
  const cols = pickCols(headers); if (cols.mobile == null) throw bad(400, `No mobile column found. Headers read: ${headers.slice(0, 12).join(' · ') || 'none'}`);
  const me = String(req.actor).toLowerCase();
  const b = (await C().query(`INSERT INTO fixed_lead_batches (name, kind, source, created_by, rows, detail) VALUES ($1,'import',$2,$3,$4,$5) RETURNING id`,
    [name, reasonClass, me, rows.length, JSON.stringify({ columns: Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, headers[i]])), fileName: body.fileName || null })])).rows[0].id;
  const stats = { rows: rows.length, accepted: 0, duplicates: 0, merged: 0, rejected: 0, ordered: 0, why: {} };
  const seen = new Set(); const created = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const get = k => cols[k] == null ? '' : String(r[cols[k]] == null ? '' : r[cols[k]]).trim();
    const mob = S.normMobile(get('mobile')), nid = S.normNid(get('nid'));
    if (!mob) { stats.rejected++; stats.why.no_mobile = (stats.why.no_mobile || 0) + 1; continue; }
    if (seen.has(mob)) { stats.duplicates++; continue; } seen.add(mob);
    const idn = S.identity({ name: get('name'), mobile: mob, nid });
    const product = /5g/i.test(get('product')) ? '5g' : /fiber|ftth|300|500|1000/i.test(get('product')) ? 'ftth' : defProduct;
    const d = get('date'); const when = d && !isNaN(Date.parse(d)) ? new Date(d) : new Date();
    const hs = [idn.ident_hash, idn.mobile_hash].filter(Boolean);
    const bought = await C().query(`SELECT 1 FROM fixed_lead_journeys WHERE completed AND (ident_hash = ANY($1) OR mobile_hash = ANY($1)) AND coalesce(completed_at, started_at) >= $2 LIMIT 1`, [hs, when]);
    if (bought.rowCount) { stats.ordered++; continue; }
    const open = await H.openLeadOf(idn.ident_hash, idn.mobile_hash);
    if (open) { stats.merged++; await S.event(open, me, 'attempt', { source: 'import', batch: b, reason: get('reason') || defReason }); continue; }
    const id = await H.insertLead({ source: 'import', source_ref: `B${b}:${i + 1}`, product, workflow: null, plan_id: null, plan_label: S.planLabel(null, get('product'), product), channel: 'import',
      dealer: null, region: get('region') || null, city: get('city') || null, step: null, step_label: reasonClass === 'rejected_install' ? 'Installation rejected' : 'Imported', reason: (get('reason') || defReason).slice(0, 240),
      reason_class: reasonClass, ...idn, pii_enc: S.enc({ name: get('name') || null, mobile: mob, nid: nid || null }), facts: { batch: b, order: get('order') ? scrub(get('order')).slice(0, 40) : null },
      occurred_at: when, stopped_at: null, batch_id: b });
    if (id) { stats.accepted++; created.push(id); await S.event(id, me, 'created', { source: 'import', batch: b }); }
  }
  /* optional spread on import */
  let spread = null;
  if (body.assign && Array.isArray(body.assign.members) && body.assign.members.length && created.length) spread = await assign(req, desk, created, { mode: 'spread', members: body.assign.members });
  await C().query(`UPDATE fixed_lead_batches SET accepted=$2, duplicates=$3, rejected=$4, detail = detail || $5 WHERE id=$1`, [b, stats.accepted, stats.duplicates + stats.merged, stats.rejected, JSON.stringify({ stats, spread })]);
  return { batch: b, ...stats, spread };
}

/* ------------------------------------------------------------------ assignment */
async function assign(req, desk, ids, { mode, to, members }) {
  const me = String(req.actor).toLowerCase();
  const people = await S.members(); const known = new Set(people.map(p => p.email));
  ids = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 2000);
  if (!ids.length) throw bad(400, 'no lead selected');
  let plan = [];
  if (mode === 'spread') {
    const list = [...new Set((members || []).map(e => String(e).toLowerCase()).filter(e => known.has(e)))]; if (!list.length) throw bad(400, 'choose at least one OCU member');
    const load = new Map(list.map(e => [e, 0]));
    const r = await C().query(`SELECT assignee, count(*)::int AS n FROM fixed_leads WHERE status = ANY(${OPEN_SQL}) AND assignee = ANY($1) GROUP BY 1`, [list]); r.rows.forEach(x => load.set(x.assignee, x.n));
    for (const id of ids) { const e = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0]; plan.push([id, e]); load.set(e, load.get(e) + 1); }
  } else {
    const who = to ? String(to).toLowerCase() : null; if (who && !known.has(who)) throw bad(400, 'not an OCU member: ' + who);
    plan = ids.map(id => [id, who]);
  }
  const counts = {};
  for (const [id, e] of plan) {
    const u = await C().query(`UPDATE fixed_leads SET assignee = $2, assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, assigned_by = $3,
        status = CASE WHEN $2::text IS NULL AND status IN ('assigned') THEN 'new' WHEN $2::text IS NOT NULL AND status = 'new' THEN 'assigned' ELSE status END, updated_at = now()
      WHERE id = $1 AND status = ANY(${OPEN_SQL}) RETURNING id`, [id, e, me]);
    if (u.rowCount) { counts[e || 'pool'] = (counts[e || 'pool'] || 0) + 1; await S.event(id, me, 'assigned', { to: e, mode: mode || 'one' }); }
  }
  return { assigned: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

/* ------------------------------------------------------------------ outcomes */
async function outcome(req, desk, L, b) {
  const me = meOf(req); const R = S.RESULTS[b.result]; if (!R) throw bad(400, 'unknown result');
  if (!S.OPEN.includes(L.status) && b.result !== 'won') throw bad(409, `The lead is ${S.STATUS_LABEL[L.status] || L.status} — reopen it first`);
  const P = desk.points, now = Date.now(); let pts = 0; const sets = ['attempts = attempts + 1', 'updated_at = now()']; const p = [L.id]; const put = (col, v) => { p.push(v); sets.push(`${col} = $${p.length}`); };
  const detail = { result: b.result, contact: !!R.contact };
  if (R.contact) {
    put('last_contact_at', new Date(now));
    if (!L.first_contact_at) { put('first_contact_at', new Date(now)); pts += S.n(P.contact);
      const startAt = Math.max(Date.parse(L.created_at), L.assigned_at ? Date.parse(L.assigned_at) : 0);
      if (now - startAt <= (S.n(desk.slaFirstContactMin) || 120) * 60e3) { pts += S.n(P.fast); detail.fast = true; } }
  }
  const cb = b.callbackAt ? new Date(b.callbackAt) : null; if (cb && isNaN(cb)) throw bad(400, 'bad callback time');
  if (b.result === 'callback') { if (!cb || cb.getTime() < now - 60e3) throw bad(400, 'Pick when to call back'); put('next_action_at', cb); detail.callbackAt = cb.toISOString(); }
  else if (['no_answer', 'busy'].includes(b.result)) { const next = cb || new Date(now + (L.attempts >= 2 ? 24 : 2) * 3600e3); put('next_action_at', next); detail.retryAt = next.toISOString(); }
  else if (b.result === 'interested') { put('next_action_at', cb || new Date(now + 4 * 3600e3)); pts += S.n(P.interested); }
  if (b.result === 'offer_made' || (b.result === 'won' && b.offerCode)) {
    const o = S.offerOf(desk, b.offerCode); if (!o) throw bad(400, 'Choose an offer from the catalogue');
    if (o.product === 'ftth' && L.product !== 'ftth') throw bad(400, 'The OCU discount is for FTTH only — pitch the standard 5G plans');
    put('offer_code', o.code); put('offer_months', o.months || null); detail.offer = o.code;
    if (b.result === 'offer_made') { pts += S.n(P.offer); put('next_action_at', cb || new Date(now + 24 * 3600e3)); }
  }
  if (b.result === 'won') {
    const ref = scrub(b.orderRef || '').slice(0, 40); detail.orderRef = ref || null;
    put('won_at', new Date(now)); put('won_by', me); put('won_ref', ref || null); put('closed_at', new Date(now)); sets.push('next_action_at = NULL', 'won_auto = false');
    pts += /^OCU/.test(String(b.offerCode || L.offer_code || '')) ? S.n(P.won) : S.n(P.won_std); if (!b.offerCode && !L.offer_code) detail.offer = 'STD';
  }
  if (['not_interested', 'ordered_elsewhere'].includes(b.result)) {
    const lr = b.result === 'ordered_elsewhere' ? 'Ordered through another channel' : String(b.lostReason || '').slice(0, 80);
    if (!lr) throw bad(400, 'Pick the reason'); put('lost_reason', lr); put('closed_at', new Date(now)); sets.push('next_action_at = NULL'); detail.lost_reason = lr;
  }
  if (['wrong_number', 'dnc'].includes(b.result)) { put('closed_at', new Date(now)); sets.push('next_action_at = NULL'); }
  const status = R.status || (L.status === 'new' ? 'assigned' : L.status === 'assigned' && R.contact ? 'contacted' : L.status);
  put('status', status);
  if (!L.assignee) { put('assignee', me); put('assigned_at', new Date(now)); put('assigned_by', me); }
  if (b.note) detail.note = scrub(b.note).slice(0, 400);
  await C().query(`UPDATE fixed_leads SET ${sets.join(', ')} WHERE id = $1`, p);
  await S.event(L.id, me, b.result === 'won' ? 'won' : 'call', detail, pts);
  if (b.result === 'offer_made') await S.event(L.id, me, 'offer', { offer: detail.offer, months: (S.offerOf(desk, detail.offer) || {}).months || null }, 0);
  return { status, points: pts };
}

/* ------------------------------------------------------------------ the 4-a-day digest (no customer data) */
async function digestTick(force) {
  const desk = await S.getDesk(); if (!desk.digest.on && !force) return null;
  const h = S.ksaHour(); const hours = (desk.digest.hours || []).map(Number);
  if (!force && !hours.includes(h)) return null;
  const slot = `${S.ksaDay()}T${String(h).padStart(2, '0')}`;
  let st = {}; try { const r = await C().query(`SELECT value FROM console_settings WHERE key='leads_digest'`); st = (r.rowCount && r.rows[0].value) || {}; } catch (_) {}
  if (!force && st.lastSlot === slot) return null;
  await C().query(`INSERT INTO console_settings (key, value) VALUES ('leads_digest', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ lastSlot: slot, at: new Date().toISOString() })]).catch(() => {});
  const notify = require('./notify'); const people = await S.members(); if (!people.length) return { sent: 0, reason: 'no OCU member' };
  const since = st.at ? new Date(st.at) : new Date(Date.now() - 6 * 3600e3);
  const t = (await C().query(`SELECT count(*) FILTER (WHERE created_at >= $1)::int AS fresh, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND assignee IS NULL)::int AS pool,
      count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS open, count(*) FILTER (WHERE status='won' AND won_at >= $2)::int AS won_today,
      count(*) FILTER (WHERE created_at >= $1 AND product='ftth')::int AS fresh_ftth, count(*) FILTER (WHERE created_at >= $1 AND product='5g')::int AS fresh_5g FROM fixed_leads`, [since, S.dayStart()])).rows[0];
  const url = (notify.CONSOLE_URL || '').replace(/#.*$/, '').replace(/\/?$/, '/') + '#fixed?tab=leads';
  let sent = 0;
  for (const p of people) {
    const m = (await C().query(`SELECT count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS open, count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND next_action_at <= now() + interval '1 hour')::int AS due,
        count(*) FILTER (WHERE status = ANY(${OPEN_SQL}) AND first_contact_at IS NULL)::int AS untouched FROM fixed_leads WHERE assignee = $1`, [p.email])).rows[0];
    const tile = (k, v, c) => `<td style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;font-family:Arial,sans-serif;text-align:center"><div style="font-size:22px;font-weight:800;color:${c || '#0b3d2b'}">${v}</div><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">${k}</div></td>`;
    const html = `<p style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">Hello ${notify.esc(S.firstName(p.name, p.email))},</p>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">${S.n(t.fresh)} new lead(s) since the last update (${S.n(t.fresh_ftth)} fiber · ${S.n(t.fresh_5g)} 5G). ${S.n(t.won_today)} won today by the team.</p>
      <table role="presentation" cellspacing="8" cellpadding="0"><tr>${tile('your open leads', S.n(m.open))}${tile('call back within 1 h', S.n(m.due), S.n(m.due) ? '#b45309' : null)}${tile('not called yet', S.n(m.untouched))}${tile('team pool', S.n(t.pool))}</tr></table>
      <p style="margin:18px 0"><a href="${url}" style="background:#0b3d2b;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:11px 20px;border-radius:8px;display:inline-block">Open Leads</a></p>
      <p style="font-family:Arial,sans-serif;font-size:11.5px;color:#64748b">Restricted: customer names and numbers are never sent by mail — they stay in the console, behind the daily confidentiality acceptance.</p>`;
    try { const r = await notify.sendHtml([p.email], `[Salam Ops · Fixed] Leads — ${S.n(t.fresh)} new · ${S.n(m.due)} to call back`, notify.shell({ title: 'OCU · Leads update', pill: 'Restricted', pillColor: '#b91c1c', bodyHtml: html }), []); if (r && (r.sent || r.dev)) sent++; } catch (e) { log('digest', p.email, e.message); }
  }
  return { sent, slot };
}

/* ------------------------------------------------------------------ the lists (alpha.168: one WHERE builder for the rows and for the counts
 * next to each filter — a filter's counts apply every other filter, not its own, so its options stay reachable) */
function scopeOf(q, mgr, me, skip) {
  const where = [], p = []; const add = (sql, v) => { p.push(v); where.push(sql.replace(/\$\?/g, '$' + p.length)); };
  const vw = ['mine', 'pool', 'team', 'closed', 'all'].includes(q.view) ? q.view : 'mine';
  if ((vw === 'team' || vw === 'all') && !mgr) return { denied: true, vw, where, p };
  if (vw === 'mine') { add('l.assignee = $?', me); where.push(`l.status = ANY(${OPEN_SQL})`); }
  else if (vw === 'pool') { where.push('l.assignee IS NULL', `l.status = ANY(${OPEN_SQL})`); }
  else if (vw === 'team') where.push(`l.status = ANY(${OPEN_SQL})`);
  else if (vw === 'closed') { where.push(`l.status = ANY(${CLOSED_SQL})`); if (!mgr) { p.push(me); where.push(`(l.assignee = $${p.length} OR l.won_by = $${p.length})`); } }
  const on = k => skip !== k && q[k] != null && q[k] !== '';
  if (on('status') && (S.OPEN.includes(q.status) || S.CLOSED.includes(q.status))) add('l.status = $?', q.status);
  if (on('source') && S.SOURCE_LABEL[q.source]) add('l.source = $?', q.source);
  if (on('product') && (q.product === 'ftth' || q.product === '5g')) add('l.product = $?', q.product);
  if (on('svc') && S.SVC_LABEL[q.svc]) add('l.svc_type = $?', q.svc);
  if (on('ptype')) { if (q.ptype === 'unknown') where.push('l.plan_type IS NULL'); else if (S.PTYPE_LABEL[q.ptype]) add('l.plan_type = $?', q.ptype); }
  if (on('plan')) add('l.plan_label = $?', String(q.plan).slice(0, 160));
  if (on('reason') && S.REASON_LABEL[q.reason]) add('l.reason_class = $?', q.reason);
  if (on('temp')) { if (q.temp === 'none') where.push('l.temp IS NULL'); else if (['hot', 'warm', 'cold'].includes(q.temp)) add('l.temp = $?', q.temp); }
  if (on('assignee') && mgr) { if (q.assignee === 'none') where.push('l.assignee IS NULL'); else add('l.assignee = $?', String(q.assignee).toLowerCase()); }
  if (q.batch) add('l.batch_id = $?', Number(q.batch) || 0);
  if (q.due === '1') where.push(`l.next_action_at <= now() + interval '15 minutes'`);
  const term = String(q.q || '').trim(); let byNumber = false;
  if (term) {
    const m = S.normMobile(term), i = S.normNid(term);
    if (m || i) { const hs = [S.hash('m', m), S.hash('n', i)].filter(Boolean); p.push(hs); where.push(`(l.mobile_hash = ANY($${p.length}) OR l.ident_hash = ANY($${p.length}))`); byNumber = true; }
    else if (/^#?\d{1,9}$/.test(term)) add('l.id = $?', Number(term.replace('#', '')));
    else { p.push('%' + term.toLowerCase() + '%'); where.push(`(lower(l.plan_label) LIKE $${p.length} OR lower(coalesce(l.city,'')) LIKE $${p.length} OR lower(coalesce(l.reason,'')) LIKE $${p.length} OR lower(coalesce(l.dealer,'')) LIKE $${p.length} OR lower(coalesce(l.step_label,'')) LIKE $${p.length})`); }
  }
  return { vw, where, p, byNumber };
}
/* sortable columns of the table; ?sort=<key>&dir=asc|desc (age: asc = newest first). smart · score · newest · oldest stay. */
const SORT = { score: 'l.score', product: 'l.product', svc: 'l.svc_type', plan: 'lower(l.plan_label)', ptype: 'l.plan_type', source: 'l.source', reason: 'l.reason_class',
  age: 'l.occurred_at', status: 'l.status', owner: 'l.assignee', journeys: `coalesce((l.facts->>'attempts')::int, 1)`, calls: 'l.attempts', next: 'l.next_action_at',
  area: 'lower(coalesce(l.city, l.region))', closed: 'l.closed_at' };
const FACETS = { product: 'l.product', svc: 'l.svc_type', ptype: `coalesce(l.plan_type, 'unknown')`, plan: 'l.plan_label', source: 'l.source', reason: 'l.reason_class',
  temp: `coalesce(l.temp, 'none')`, assignee: `coalesce(l.assignee, 'none')` };
async function facetsOf(q, mgr, me, vw) {
  const keys = Object.keys(FACETS).filter(k => k !== 'assignee' || (mgr && vw === 'team'));
  const res = await Promise.all(keys.map(k => { const sc = scopeOf(q, mgr, me, k);
    return C().query(`SELECT ${FACETS[k]} AS k, count(*)::int AS n FROM fixed_leads l ${sc.where.length ? 'WHERE ' + sc.where.join(' AND ') : ''} GROUP BY 1 ORDER BY 2 DESC LIMIT ${k === 'plan' ? 40 : 30}`, sc.p)
      .then(r => r.rows.filter(x => x.k != null)).catch(() => []); }));
  return Object.fromEntries(keys.map((k, i) => [k, res[i]]));
}

/* ------------------------------------------------------------------ routes */
function mount(app, deps = {}) {
  const audit = deps.audit || (async () => {});
  const wrap = fn => async (req, res) => { try { res.json(await fn(req.query || {}, req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || null }); } };
  const gate = (req, res, next) => {
    const v = req.views || [], r = req.roleNames || [];
    if (v.includes('fixed_leads') && (r.includes('ocu') || r.includes('super_admin'))) return next();
    audit(req, 'leads.denied', req.originalUrl.split('?')[0], {});
    return res.status(403).json({ error: 'Leads is restricted to the OCU team and super admins.', code: 'restricted' });
  };
  const acceptedToday = async req => { const desk = await S.getDesk(); const r = await C().query(`SELECT 1 FROM fixed_lead_accept WHERE email = $1 AND day = $2::date AND version = $3`, [String(req.actor).toLowerCase(), S.ksaDay(), desk.terms.version]); return r.rowCount > 0; };
  const accepted = async (req, res, next) => { try { await S.ensure(); if (await acceptedToday(req)) return next(); return res.status(403).json({ error: 'Accept the confidentiality terms to open the leads.', code: 'accept_required' }); } catch (e) { res.status(500).json({ error: e.message }); } };
  const B = '/api/fixed/leads';
  const managerOnly = async req => { const desk = await S.getDesk(); if (!canManage(req, desk)) throw bad(403, 'Supervisors only (Leads › Settings names them).'); return desk; };

  app.get(`${B}/gate`, gate, wrap(async (q, req) => {
    await S.ensure(); const desk = await S.getDesk();
    return { accepted: await acceptedToday(req), terms: desk.terms, day: S.ksaDay(), me: { email: meOf(req), manager: canManage(req, desk), super: isRealSuper(req), viewAs: req.viewAs ? req.viewAs.email : null },
      piiReady: S.piiReady() };
  }));
  app.post(`${B}/accept`, gate, wrap(async (q, req) => {
    await S.ensure(); const desk = await S.getDesk(); const b = req.body || {};
    if (b.version && b.version !== desk.terms.version) throw bad(409, 'The terms changed — read them again.');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null, ua = String(req.get('user-agent') || '').slice(0, 300);
    await C().query(`INSERT INTO fixed_lead_accept (email, day, version, ip, ua) VALUES ($1, $2::date, $3, $4, $5) ON CONFLICT (email, day, version) DO NOTHING`, [String(req.actor).toLowerCase(), S.ksaDay(), desk.terms.version, ip, ua]);
    await audit(req, 'leads.accept', desk.terms.version, { day: S.ksaDay() });
    return { accepted: true };
  }));
  app.get(`${B}/meta`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const mgr = canManage(req, desk); const people = await S.members();
    return { offers: desk.offers, rules: S.OFFER_RULES, offerSource: S.OFFER_SOURCE, statuses: S.STATUS_LABEL, results: Object.fromEntries(Object.entries(S.RESULTS).map(([k, v]) => [k, v.label])),
      lostReasons: S.LOST_REASONS, reasons: S.REASON_LABEL, sources: S.SOURCE_LABEL, sourcesShort: S.SOURCE_SHORT, svc: S.SVC_LABEL, ptypes: S.PTYPE_LABEL, scoring: CO.scoring(),
      targets: desk.targets, points: desk.points, sla: desk.slaFirstContactMin,
      reveal: { perHour: desk.revealPerHour, perDay: desk.revealPerDay },
      unmask: (() => { const U = unmaskCfg(desk); return { ...U, can: !req.viewAs && (mgr || U.who === 'members') && U.who !== 'off', scope: mgr ? 'any' : 'own', capped: !(isRealSuper(req) && !req.viewAs) }; })(),
      me: { email: meOf(req), manager: mgr, super: isRealSuper(req) && !req.viewAs, viewAs: req.viewAs ? req.viewAs.email : null },
      members: people.map(p => ({ email: p.email, name: p.name, supervisor: p.supervisor })), piiReady: S.piiReady(), harvest: H.status() };
  }));
  app.get(`${B}/list`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const mgr = canManage(req, desk); const me = meOf(req);
    const sc = scopeOf(q, mgr, me);
    if (sc.denied) throw bad(403, 'Supervisors only');
    if (sc.byNumber) audit(req, 'leads.search', 'by number', {});
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const order = SORT[q.sort] ? `${SORT[q.sort]} ${q.sort === 'age' ? (dir === 'ASC' ? 'DESC' : 'ASC') : dir} NULLS LAST, l.occurred_at DESC, l.id DESC`
      : q.sort === 'newest' ? 'l.occurred_at DESC' : q.sort === 'oldest' ? 'l.occurred_at ASC' : q.sort === 'score' ? 'coalesce(l.score,0) DESC, l.occurred_at DESC'
      : `CASE WHEN l.next_action_at <= now() + interval '15 minutes' THEN 0 ELSE 1 END, CASE WHEN l.next_action_at <= now() + interval '15 minutes' THEN l.next_action_at END ASC, l.priority DESC, coalesce(l.score,0) DESC, l.occurred_at DESC`;
    const limit = Math.min(200, Math.max(10, Number(q.limit) || 60)), offset = Math.max(0, Number(q.offset) || 0);
    const W = sc.where.length ? 'WHERE ' + sc.where.join(' AND ') : '';
    const [rows, total, counts, facets] = await Promise.all([
      C().query(`SELECT ${ROW} FROM fixed_leads l ${W} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, sc.p),
      C().query(`SELECT count(*)::int AS n FROM fixed_leads l ${W}`, sc.p),
      C().query(`SELECT count(*) FILTER (WHERE assignee = $1 AND status = ANY(${OPEN_SQL}))::int AS mine, count(*) FILTER (WHERE assignee IS NULL AND status = ANY(${OPEN_SQL}))::int AS pool,
          count(*) FILTER (WHERE status = ANY(${OPEN_SQL}))::int AS team, count(*) FILTER (WHERE assignee = $1 AND status = ANY(${OPEN_SQL}) AND next_action_at <= now() + interval '15 minutes')::int AS due,
          count(*) FILTER (WHERE status = ANY(${CLOSED_SQL}) AND (assignee = $1 OR won_by = $1 OR $2::boolean))::int AS closed FROM fixed_leads`, [me, mgr]),
      q.facets === '1' ? facetsOf(q, mgr, me, sc.vw) : null,
    ]);
    return { view: sc.vw, rows: rows.rows.map(view), total: total.rows[0].n, counts: counts.rows[0], limit, offset, manager: mgr, sort: SORT[q.sort] || ['newest', 'oldest', 'score'].includes(q.sort) ? q.sort : 'smart', dir: dir.toLowerCase(), facets };
  }));
  app.get(`${B}/board`, gate, accepted, wrap(async (q, req) => board(req, await S.getDesk())));
  app.get(`${B}/batches`, gate, accepted, wrap(async (q, req) => {
    const desk = await managerOnly(req);
    const r = await C().query(`SELECT b.*, (SELECT count(*)::int FROM fixed_leads l WHERE l.batch_id = b.id AND l.status = ANY(${OPEN_SQL})) AS open,
        (SELECT count(*)::int FROM fixed_leads l WHERE l.batch_id = b.id AND l.status = 'won') AS won FROM fixed_lead_batches b ORDER BY b.created_at DESC LIMIT 50`);
    void desk; return { batches: r.rows.map(b => ({ id: b.id, name: b.name, kind: b.kind, source: b.source, created_by: b.created_by, created_at: b.created_at, rows: b.rows, accepted: b.accepted,
      duplicates: b.duplicates, rejected: b.rejected, open: b.open, won: b.won, columns: (b.detail || {}).columns || null })) };
  }));
  app.get(`${B}/lead/:id`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canSee(req, desk, L)) { audit(req, 'leads.denied', String(L.id), { why: 'not in queue' }); throw bad(403, 'This lead is in another member\'s queue.'); }
    const me = meOf(req);
    const [ev, adv] = await Promise.all([
      C().query(`SELECT id, at, actor, kind, detail, points FROM fixed_lead_events WHERE lead_id = $1 ORDER BY at DESC LIMIT 200`, [L.id]),
      C().query(`SELECT * FROM fixed_lead_advice WHERE lead_id = $1`, [L.id]),
    ]);
    /* a view is a recorded event (one per member per lead per 30 min) */
    const lastView = ev.rows.find(e => e.kind === 'view' && e.actor === me);
    if (!lastView || Date.now() - Date.parse(lastView.at) > 30 * 60e3) S.event(L.id, me, 'view', {});
    const people = await S.members(); const nameOf = e => { const m = people.find(x => x.email === e); return m ? m.name : e === 'system' ? 'System' : String(e || '').split('@')[0]; };
    const a = adv.rows[0] || null;
    let hist = null; try { hist = await H.fixedHistory(L.ident_hash, L.mobile_hash, L.source_ref, L.id); } catch (_) {}
    return { lead: view(L), history: hist,
      events: ev.rows.filter(e => e.kind !== 'view' || e.actor !== me).map(e => ({ id: e.id, at: e.at, who: nameOf(e.actor), me: e.actor === me, kind: e.kind, detail: e.detail, points: e.points })),
      advice: a ? { at: a.at, model: a.model, deterministic: a.deterministic, score: a.score, temp: a.temp, path: a.path, offer: a.offer_code, months: a.offer_months, opener_en: a.opener_en, opener_ar: a.opener_ar,
        points: a.points, objections: a.objections, best_time: a.best_time, next_action: a.next_action, why: a.why, helpful: a.helpful } : null,
      can: { work: canWork(req, desk, L), take: !L.assignee && S.OPEN.includes(L.status), manage: canManage(req, desk), reveal: canWork(req, desk, L) && L.status !== 'dnc' && L.has_mobile !== false } };
  }));
  app.post(`${B}/lead/:id/reveal`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canWork(req, desk, L)) { audit(req, 'leads.reveal_refused', String(L.id), { why: 'not assigned' }); throw bad(403, 'Take the lead first — numbers are revealed only for the leads you work.'); }
    if (L.status === 'dnc') throw bad(403, 'The customer asked not to be called.');
    const cap = await revealAllowed(req, desk);
    if (!cap.ok) {
      audit(req, 'leads.reveal_blocked', String(L.id), cap);
      const k = `${req.actor}|${S.ksaDay()}`; if (!capMailed.has(k)) { capMailed.set(k, 1); mailOwners(`[Salam Ops · Fixed] Leads — reveal cap reached by ${req.actor}`, `<p style="font-family:Arial,sans-serif">${require('./notify').esc(req.actor)} reached the reveal cap (${cap.hour} in the last hour · ${cap.day} today; caps ${cap.ph}/h · ${cap.pd}/day). Further reveals are refused until the window clears. Review in Audit log › leads.reveal.</p>`); }
      throw bad(429, `Reveal limit reached (${cap.ph} per hour · ${cap.pd} per day). The console owners were notified.`);
    }
    const c = await contactOf(L); if (!c.mobile) throw bad(404, 'No mobile number in the source.');
    await S.event(L.id, String(req.actor).toLowerCase(), 'reveal', { source: L.source }, 0);
    await audit(req, 'leads.reveal', String(L.id), { source: L.source, product: L.product });
    return { lead: L.id, name: c.name, from: c.from || null, email: c.email || null, lang: c.lang || null, mobile: S.dial(c.mobile), tel: '+966' + c.mobile, seconds: 90, used: { hour: cap.hour + 1, day: cap.day + 1, perHour: cap.ph, perDay: cap.pd } };
  }));
  app.post(`${B}/unmask`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const mgr = canManage(req, desk), me = meOf(req), sup = isRealSuper(req) && !req.viewAs; const U = unmaskCfg(desk); const b = req.body || {};
    if (req.viewAs) throw bad(403, 'Not while viewing the console as someone else.');
    if (U.who === 'off' || (!mgr && U.who !== 'members')) throw bad(403, U.who === 'off' ? 'Unmasking is switched off (Leads › Settings › Protection).' : 'Only supervisors unmask a list — reveal one lead at a time from its row.');
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(x => Number.isInteger(x) && x > 0))].slice(0, 200);
    if (!ids.length) throw bad(400, 'no lead to unmask');
    const r = await C().query(`SELECT id, source, source_ref, status, assignee, won_by, pii_enc, has_mobile FROM fixed_leads WHERE id = ANY($1)`, [ids]);
    const ok = r.rows.filter(L => L.status !== 'dnc' && L.has_mobile !== false && (mgr || L.assignee === me || L.won_by === me));
    if (!ok.length) { audit(req, 'leads.unmask_refused', null, { asked: ids.length }); throw bad(403, 'You can unmask only your own leads — take a lead from the pool first. A customer who asked not to be called is never shown.'); }
    const used = S.n((await C().query(`SELECT count(*)::int AS n FROM fixed_lead_events WHERE actor = $1 AND kind = 'unmask' AND at >= $2`, [me, S.dayStart()])).rows[0].n);
    if (!sup && used + ok.length > U.perDay) {
      audit(req, 'leads.unmask_blocked', null, { used, asked: ok.length, cap: U.perDay });
      const k = `u|${req.actor}|${S.ksaDay()}`; if (!capMailed.has(k)) { capMailed.set(k, 1); mailOwners(`[Salam Ops · Fixed] Leads — unmask limit reached by ${req.actor}`, `<p style="font-family:Arial,sans-serif">${require('./notify').esc(req.actor)} reached the daily unmask limit (${used} leads unmasked today, ${ok.length} more asked; limit ${U.perDay}). Further unmasking is refused until tomorrow. Review in Audit log › pii.unmask.</p>`); }
      throw bad(429, `Unmask limit reached — ${used} of ${U.perDay} leads today. The console owners were notified.`);
    }
    const c = await contactsOf(ok); const contacts = {}, shown = [];
    for (const L of ok) { const x = c.get(L.id) || { none: 'not readable' }; if (x.mobile) { contacts[L.id] = { name: x.name, from: x.from || null, email: x.email || null, lang: x.lang || null, mobile: S.dial(x.mobile), tel: '+966' + x.mobile }; shown.push(L.id); } else contacts[L.id] = { none: x.none }; }
    const view = ['mine', 'pool', 'team', 'closed'].includes(b.view) ? b.view : null;
    if (shown.length) {
      await C().query(`INSERT INTO fixed_lead_events (lead_id, actor, kind, detail) SELECT x, $2, 'unmask', $3::jsonb FROM unnest($1::bigint[]) AS x`, [shown, me, JSON.stringify({ view, minutes: U.minutes })]).catch(() => {});
      await audit(req, 'pii.unmask', 'leads', { count: shown.length, view, minutes: U.minutes, ids: shown });
    }
    return { contacts, refused: ids.length - ok.length, minutes: U.minutes, until: new Date(Date.now() + U.minutes * 60e3).toISOString(), used: used + shown.length, perDay: sup ? null : U.perDay };
  }));
  app.post(`${B}/lead/:id/take`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const me = meOf(req);
    const open = (await C().query(`SELECT count(*)::int AS n FROM fixed_leads WHERE assignee = $1 AND status = ANY(${OPEN_SQL})`, [me])).rows[0].n;
    if (open >= (S.n(desk.maxOpenPerMember) || 60)) throw bad(409, `You already have ${open} open leads — close some first.`);
    const u = await C().query(`UPDATE fixed_leads SET assignee = $2, assigned_at = now(), assigned_by = $2, status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END, updated_at = now()
      WHERE id = $1 AND assignee IS NULL AND status = ANY(${OPEN_SQL}) RETURNING id`, [Number(req.params.id), me]);
    if (!u.rowCount) throw bad(409, 'Someone took this lead a moment ago.');
    await S.event(u.rows[0].id, me, 'assigned', { to: me, self: true });
    return { ok: true };
  }));
  app.post(`${B}/assign`, gate, accepted, wrap(async (q, req) => {
    const desk = await managerOnly(req); const b = req.body || {};
    const r = await assign(req, desk, b.ids, { mode: b.mode, to: b.to, members: b.members });
    await audit(req, 'leads.assign', String((b.ids || []).length), { mode: b.mode || 'one', to: b.to || null, counts: r.counts });
    return r;
  }));
  app.post(`${B}/lead/:id/outcome`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canWork(req, desk, L) && !( !L.assignee && S.OPEN.includes(L.status))) throw bad(403, 'This lead is in another member\'s queue.');
    const r = await outcome(req, desk, L, req.body || {});
    CO.adviseOne(L.id, { useModel: false, force: true }).catch(() => {});
    return r;
  }));
  app.post(`${B}/lead/:id/comment`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canSee(req, desk, L)) throw bad(403, 'This lead is in another member\'s queue.');
    const t = scrub((req.body || {}).text).slice(0, 1000); if (!t) throw bad(400, 'empty comment');
    await S.event(L.id, meOf(req), 'comment', { text: t }); await C().query(`UPDATE fixed_leads SET updated_at = now() WHERE id = $1`, [L.id]);
    return { ok: true };
  }));
  app.post(`${B}/lead/:id/remark`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canWork(req, desk, L)) throw bad(403, 'Only the member working the lead (or a supervisor) edits the remark.');
    const t = scrub((req.body || {}).text).slice(0, 600);
    await C().query(`UPDATE fixed_leads SET remark = $2, updated_at = now() WHERE id = $1`, [L.id, t || null]); await S.event(L.id, meOf(req), 'remark', { text: t });
    return { ok: true };
  }));
  app.post(`${B}/lead/:id/reopen`, gate, accepted, wrap(async (q, req) => {
    await managerOnly(req); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    await C().query(`UPDATE fixed_leads SET status = CASE WHEN assignee IS NULL THEN 'new' ELSE 'assigned' END, closed_at = NULL, won_at = NULL, won_by = NULL, won_ref = NULL, won_auto = false, lost_reason = NULL, updated_at = now() WHERE id = $1`, [L.id]);
    await S.event(L.id, meOf(req), 'reopen', { from: L.status }); return { ok: true };
  }));
  app.post(`${B}/lead/:id/priority`, gate, accepted, wrap(async (q, req) => {
    await managerOnly(req); const v = Math.max(-5, Math.min(5, Number((req.body || {}).priority) || 0));
    await C().query(`UPDATE fixed_leads SET priority = $2 WHERE id = $1`, [Number(req.params.id), v]); await S.event(Number(req.params.id), meOf(req), 'priority', { priority: v }); return { ok: true };
  }));
  app.post(`${B}/lead/:id/advise`, gate, accepted, wrap(async (q, req) => {
    const desk = await S.getDesk(); const L = await getLead(Number(req.params.id)); if (!L) throw bad(404, 'lead not found');
    if (!canSee(req, desk, L)) throw bad(403, 'This lead is in another member\'s queue.');
    const a = await CO.adviseOne(L.id, { actor: meOf(req), force: true, useModel: true });
    await S.event(L.id, meOf(req), 'ai', { model: a.model || null, deterministic: !a.model, score: a.score });
    return a;
  }));
  app.post(`${B}/lead/:id/advice/feedback`, gate, accepted, wrap(async (q, req) => {
    const h = (req.body || {}).helpful; const v = h === true || h === 'true' ? true : h === false || h === 'false' ? false : null;
    await C().query(`UPDATE fixed_lead_advice SET helpful = $2, feedback_by = $3, feedback_at = now() WHERE lead_id = $1`, [Number(req.params.id), v, meOf(req)]);
    return { ok: true };
  }));
  app.post(`${B}/import`, gate, accepted, wrap(async (q, req) => {
    const desk = await managerOnly(req); const r = await importBatch(req, req.body || {}, desk);
    await audit(req, 'leads.import', String(r.batch), { rows: r.rows, accepted: r.accepted, duplicates: r.duplicates, merged: r.merged, rejected: r.rejected });
    return r;
  }));
  app.post(`${B}/harvest`, gate, accepted, wrap(async (q, req) => { await managerOnly(req); const r = await H.harvest({ actor: meOf(req) }); await audit(req, 'leads.harvest', null, { created: r.created, scanned: r.scanned }); return r; }));
  app.post(`${B}/digest`, gate, accepted, wrap(async (q, req) => { await managerOnly(req); return digestTick(true); }));
  app.get(`${B}/settings`, gate, accepted, wrap(async (q, req) => {
    const desk = await managerOnly(req);
    return { desk: { ...desk, terms: desk.terms }, members: await S.members(), super: isRealSuper(req) && !req.viewAs, harvest: { ...H.status(), state: await H.getState() }, piiReady: S.piiReady(), keySource: S.keySource(),
      coach: { enabled: CO.CFG.enabled, intervalMin: CO.CFG.intervalMin, briefHour: CO.CFG.briefHour } };
  }));
  app.put(`${B}/settings`, gate, accepted, wrap(async (q, req) => {
    const desk = await managerOnly(req); const b = req.body || {}; const sup = isRealSuper(req) && !req.viewAs; const patch = {};
    const bool = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, !!v]));
    if (b.sources) patch.sources = { ...desk.sources, ...bool(b.sources) };
    if (b.products) patch.products = { ...desk.products, ...bool(b.products) };
    if (b.promoterNew != null) patch.promoterNew = !!b.promoterNew;
    if (b.staffCodes && typeof b.staffCodes === 'object') patch.staffCodes = Object.fromEntries(Object.entries(b.staffCodes).map(([e, c]) => [String(e).toLowerCase(), String(c || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20)]).filter(([, c]) => c));
    for (const k of ['minAgeHours', 'lookbackDays', 'leadMaxAgeDays', 'expireDays', 'staleLeadDays', 'slaFirstContactMin', 'maxOpenPerMember', 'attributionDays']) if (b[k] != null && Number.isFinite(Number(b[k]))) patch[k] = Math.max(0, Math.min(10000, Number(b[k])));
    if (b.targets) patch.targets = { dailyWins: Math.max(0, Number(b.targets.dailyWins) || 0), weeklyWins: Math.max(0, Number(b.targets.weeklyWins) || 0) };
    if (b.digest) patch.digest = { on: !!b.digest.on, hours: (Array.isArray(b.digest.hours) ? b.digest.hours : String(b.digest.hours || '').split(',')).map(Number).filter(h => h >= 0 && h <= 23).slice(0, 8) };
    if (b.points && typeof b.points === 'object') patch.points = Object.fromEntries(Object.keys(S.DESK_DEFAULT.points).map(k => [k, Math.max(0, Math.min(100, Number(b.points[k] ?? desk.points[k]) || 0))]));
    if (sup) {
      if (Array.isArray(b.supervisors)) patch.supervisors = [...new Set(b.supervisors.map(e => String(e).toLowerCase().trim()).filter(e => /@/.test(e)))].slice(0, 30);
      for (const k of ['revealPerHour', 'revealPerDay']) if (b[k] != null && Number.isFinite(Number(b[k]))) patch[k] = Math.max(1, Math.min(2000, Number(b[k])));
      if (['off', 'supervisors', 'members'].includes(b.unmaskWho)) patch.unmaskWho = b.unmaskWho;
      if (b.unmaskMinutes != null && Number.isFinite(Number(b.unmaskMinutes))) patch.unmaskMinutes = Math.max(1, Math.min(60, Number(b.unmaskMinutes)));
      if (b.unmaskPerDay != null && Number.isFinite(Number(b.unmaskPerDay))) patch.unmaskPerDay = Math.max(10, Math.min(5000, Number(b.unmaskPerDay)));
      if (b.terms && Array.isArray(b.terms.points)) patch.terms = { version: S.ksaDay() + '-' + Date.now().toString(36).slice(-4), title: String(b.terms.title || S.TERMS_DEFAULT.title).slice(0, 120), points: b.terms.points.map(x => String(x).slice(0, 400)).filter(Boolean).slice(0, 10) };
      if (b.resetTerms) patch.terms = null;
      if (Array.isArray(b.offers)) patch.offers = b.offers.filter(o => o && o.code && o.label).map(o => ({ code: String(o.code).slice(0, 20), product: ['ftth', '5g', 'any'].includes(o.product) ? o.product : 'ftth', step: Number(o.step) || 2,
        label: String(o.label).slice(0, 120), detail: o.detail ? String(o.detail).slice(0, 300) : undefined, speed: o.speed ? String(o.speed).slice(0, 40) : undefined, ott: o.ott ? String(o.ott).slice(0, 60) : undefined,
        price: Number(o.price) || undefined, offer: Number(o.offer) || undefined, months: Number(o.months) || undefined, contract: Number(o.contract) || undefined })).slice(0, 20);
      if (b.resetOffers) patch.offers = null;
    }
    const next = await S.setDesk(patch);
    await audit(req, 'leads.settings', null, { keys: Object.keys(patch) });
    return { desk: next };
  }));
  app.post(`${B}/challenges`, gate, accepted, wrap(async (q, req) => {
    await managerOnly(req); const b = req.body || {};
    const metric = ['wins', 'contacts', 'points', 'offers', 'calls', 'wins_500', 'wins_std'].includes(b.metric) ? b.metric : 'wins';
    /* a challenge counts from the start of its period (the KSA day, week or month), unless a start is given */
    const r = await C().query(`INSERT INTO fixed_lead_challenges (title, metric, target, scope, period, reward, starts_at, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$9,$7,$8) RETURNING id`,
      [String(b.title || 'Challenge').slice(0, 100), metric, Math.max(1, Number(b.target) || 10), b.scope === 'member' ? 'member' : 'team', ['day', 'week', 'month'].includes(b.period) ? b.period : 'week',
        b.reward ? String(b.reward).slice(0, 140) : null, b.endsAt ? new Date(b.endsAt) : null, meOf(req), b.startsAt ? new Date(b.startsAt) : null]);
    await audit(req, 'leads.challenge', String(r.rows[0].id), { metric, target: b.target }); return { id: r.rows[0].id };
  }));
  app.delete(`${B}/challenges/:id`, gate, accepted, wrap(async (q, req) => { await managerOnly(req); await C().query(`UPDATE fixed_lead_challenges SET active = false WHERE id = $1`, [Number(req.params.id)]); return { ok: true }; }));
}

/* ------------------------------------------------------------------ schedulers (console process) */
let started = false;
function start() {
  if (started) return; started = true;
  if (process.env.LEADS_HARVEST_ENABLED === '0') { log('harvest switched off (LEADS_HARVEST_ENABLED=0)'); return; }
  const every = Math.max(5, Number(process.env.LEADS_HARVEST_MIN) || 15) * 60e3;
  setTimeout(() => H.harvest().catch(e => log(e.message)), 50e3); setInterval(() => H.harvest().catch(e => log(e.message)), every);
  setInterval(() => digestTick().catch(e => log('digest', e.message)), 5 * 60e3);
  log(`harvest every ${every / 60e3} min · digest at the desk's hours (KSA)`);
}

module.exports = { mount, start, board, digestTick, contactOf, outcome, assign, importBatch, canManage };
