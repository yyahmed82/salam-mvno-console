#!/usr/bin/env node
/* leads-check.cjs — after alpha.166 (Fixed › Leads, OCU): checks the restricted section end to end on the server.
 * READ-ONLY (SELECTs on the console DB). Prints counts and states only — no name, no number, no e-mail.
 *   cd /apps/unified/server && set -a; . /apps/unified/.env; set +a; node scripts/leads-check.cjs */
'use strict';
const path = require('path');
const src = f => require(path.join(__dirname, '..', 'src', f));
(async () => {
  console.log('version', require(path.join(__dirname, '..', 'package.json')).version);
  const roles = src('roles');
  console.log('fixed enabled:', !!roles.FIXED_ENABLED, '· view fixed_leads known:', roles.ALL_VIEWS.includes('fixed_leads'), '· OCU role:', !!roles.ROLES.ocu);
  const perms = src('rolePerms');
  try { await perms.refresh(); } catch (_) {}
  const holders = Object.entries(perms.current()).filter(([, r]) => (r.views || []).includes('fixed_leads')).map(([k]) => k);
  console.log('roles holding Leads:', holders.join(', ') || 'none', '(only ocu and super_admin may)');
  const S = src('fixedLeadsStore');
  console.log('contact protection key:', S.keySource() || 'MISSING — add LEADS_PII_KEY to /apps/unified/.env');
  const db = src('db');
  const q = async (sql, p) => { try { return (await db.console.query(sql, p)).rows; } catch (e) { return { error: e.message }; } };
  await S.ensure();
  const t = await q(`SELECT count(*) FILTER (WHERE status IN ('new','assigned','contacted','callback','interested','offer'))::int AS open,
      count(*) FILTER (WHERE status IN ('new','assigned','contacted','callback','interested','offer') AND assignee IS NULL)::int AS pool,
      count(*) FILTER (WHERE status = 'won' AND won_at > now() - interval '7 days')::int AS won7, count(*)::int AS total,
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS new24 FROM fixed_leads`);
  console.log('leads:', t.error ? 'ERROR ' + t.error : JSON.stringify(t[0]));
  const bySrc = await q(`SELECT source, product, count(*)::int AS n FROM fixed_leads GROUP BY 1,2 ORDER BY 3 DESC`);
  if (Array.isArray(bySrc) && bySrc.length) console.log('by channel:', bySrc.map(r => `${r.source}/${r.product} ${r.n}`).join(' · '));
  const adv = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT deterministic)::int AS model, max(at) AS last FROM fixed_lead_advice`);
  console.log('Agent 2 advice:', JSON.stringify(adv[0] || adv));
  const runs = await q(`SELECT agent, max(started_at) AS last, count(*)::int AS runs24 FROM agent_runs WHERE agent IN ('leads','leads.harvest') AND started_at > now() - interval '24 hours' GROUP BY 1`);
  console.log('runs (24 h):', Array.isArray(runs) && runs.length ? runs.map(r => `${r.agent} ${r.runs24}× · last ${new Date(r.last).toISOString()}`).join(' | ') : 'none yet (harvest every 15 min in salam-unified, coach every 10 min in salam-agent-incident)');
  const set = await q(`SELECT key, value FROM console_settings WHERE key IN ('leads_harvest','leads_desk','ui_menu_migrations')`);
  for (const r of Array.isArray(set) ? set : []) {
    const v = r.value || {};
    if (r.key === 'leads_harvest') console.log('last harvest:', v.lastRun || '—', JSON.stringify(v.lastStats || {}).slice(0, 240));
    if (r.key === 'leads_desk') console.log('desk: supervisors', (v.supervisors || []).length, '· SDA accounts', Object.keys(v.staffCodes || {}).length);
    if (r.key === 'ui_menu_migrations') console.log('menu migration:', v.leads ? `done ${v.leads} · saved layout moved ${!!v.leadsMoved}` : 'pending (runs 4 s after start)');
  }
  const users = await q(`SELECT count(*)::int AS n FROM console_users WHERE role = 'ocu' OR roles @> '["ocu"]'::jsonb`);
  console.log('users with the OCU role:', users.error ? (await q(`SELECT count(*)::int AS n FROM console_users WHERE role = 'ocu'`))[0].n : users[0].n);
  const acc = await q(`SELECT count(*)::int AS n FROM fixed_lead_accept WHERE day = (now() AT TIME ZONE 'Asia/Riyadh')::date`);
  console.log('accepted the terms today:', acc.error ? '—' : acc[0].n);
  process.exit(0);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
