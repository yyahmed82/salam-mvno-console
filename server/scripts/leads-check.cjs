#!/usr/bin/env node
/* leads-check.cjs — after alpha.166 (Fixed › Leads, OCU): checks the restricted section end to end on the server.
 * READ-ONLY (SELECTs on the console DB; with --keys also nexus, by primary key). Prints counts, plan names and key names only —
 * no customer name, no number, no e-mail.
 *   cd /apps/unified/server && set -a; . /apps/unified/.env; set +a; node scripts/leads-check.cjs [--keys] */
'use strict';
process.env.LEADS_NO_NORMALIZE = '1';   // read-only: the server processes normalise the leads, not this check
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
  /* alpha.168: what the table shows — type of line, plan type, plans (names only, counts), names captured; who unmasked today (counts) */
  const ty = await q(`SELECT coalesce(svc_type,'—') AS t, coalesce(plan_type,'not known') AS p, count(*)::int AS n FROM fixed_leads WHERE status IN ('new','assigned','contacted','callback','interested','offer') GROUP BY 1,2 ORDER BY 3 DESC`);
  if (Array.isArray(ty)) console.log('open leads by type / plan type:', ty.map(r => `${r.t} ${r.p} ${r.n}`).join(' · ') || 'none');
  const ptFrom = await q(`SELECT coalesce(facts->>'pt','—') AS s, count(*)::int AS n FROM fixed_leads GROUP BY 1 ORDER BY 2 DESC`);
  if (Array.isArray(ptFrom)) console.log('plan type from:', ptFrom.map(r => `${r.s} ${r.n}`).join(' · '), '(nexus = read from the journey · catalogue / name = until the harvest confirms it · miss = nexus cannot tell)');
  const pl = await q(`SELECT plan_label, max(plan_id) AS id, count(*)::int AS n FROM fixed_leads WHERE status IN ('new','assigned','contacted','callback','interested','offer') GROUP BY 1 ORDER BY 3 DESC LIMIT 15`);
  if (Array.isArray(pl)) console.log('top plans (open):', pl.map(r => `${r.plan_label}${r.id && !String(r.plan_label).includes(r.id) ? ' [' + r.id + ']' : ''} ${r.n}`).join(' · '));
  const unk = await q(`SELECT plan_id, count(*)::int AS n FROM fixed_leads WHERE plan_label ~ '^Plan [0-9]+$' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  if (Array.isArray(unk)) console.log('plan ids not in the catalogue:', unk.length ? unk.map(r => `${r.plan_id} ×${r.n}`).join(' · ') : 'none');
  const nm = await q(`SELECT count(*) FILTER (WHERE customer_mask IS NOT NULL)::int AS named, count(*)::int AS n FROM fixed_leads WHERE status IN ('new','assigned','contacted','callback','interested','offer')`);
  if (Array.isArray(nm) && nm[0]) console.log('open leads with a name:', `${nm[0].named} of ${nm[0].n}`);
  const um = await q(`SELECT kind, count(*)::int AS n, count(DISTINCT actor)::int AS people FROM fixed_lead_events WHERE kind IN ('reveal','unmask') AND at >= now() - interval '24 hours' GROUP BY 1`);
  if (Array.isArray(um)) console.log('contacts shown (24 h):', um.length ? um.map(r => `${r.kind} ${r.n} lead(s) by ${r.people} person(s)`).join(' · ') : 'none');
  if (process.argv.includes('--keys') && require(path.join(__dirname, '..', 'src', 'db')).nexus) {
    /* KEY NAMES ONLY (never a value): the customer block of the open journeys that still have no name */
    const ids = await q(`SELECT CASE WHEN source = 'sda_promoter' THEN facts->>'journey' ELSE source_ref END AS ref FROM fixed_leads WHERE customer_mask IS NULL AND source IN ('epurchase','salamhome','sda','qr','sda_promoter') AND status IN ('new','assigned','contacted','callback','interested','offer') LIMIT 300`);
    const refs = (Array.isArray(ids) ? ids : []).map(r => r.ref).filter(Boolean);
    if (refs.length) {
      try {
        const k = await db.nexus.query(`SELECT k, count(*)::int AS n FROM workflow_states w, LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.context->'customer') = 'object' THEN w.context->'customer' ELSE '{}'::jsonb END) AS k WHERE w.id = ANY($1::text[]) GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, [refs]);
        console.log(`customer-block keys of ${refs.length} open journey(s) without a name:`, k.rows.map(r => `${r.k} ${r.n}`).join(' · ') || 'no customer block');
      } catch (e) { console.log('key census failed:', e.message); }
    } else console.log('every open journey lead has a name');
  }
  const users = await q(`SELECT count(*)::int AS n FROM console_users WHERE role = 'ocu' OR roles @> '["ocu"]'::jsonb`);
  console.log('users with the OCU role:', users.error ? (await q(`SELECT count(*)::int AS n FROM console_users WHERE role = 'ocu'`))[0].n : users[0].n);
  const acc = await q(`SELECT count(*)::int AS n FROM fixed_lead_accept WHERE day = (now() AT TIME ZONE 'Asia/Riyadh')::date`);
  console.log('accepted the terms today:', acc.error ? '—' : acc[0].n);
  process.exit(0);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
