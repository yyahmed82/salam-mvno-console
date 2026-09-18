/* Create console schema + seed metric_catalog and built-in alert_rules. Idempotent. */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { CATALOG, RULES } = require('./seedRules');

async function init({ reset = false } = {}) {
  const c = db.console;
  if (reset) {
    await c.query(`DROP TABLE IF EXISTS alerts, metric_snapshots, sync_runs, alert_rules, metric_catalog CASCADE`);
  }
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await c.query(schema);

  for (const m of CATALOG) {
    await c.query(
      `INSERT INTO metric_catalog (key,label,description,unit,higher_is_bad,source_tables)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, unit=EXCLUDED.unit,
         higher_is_bad=EXCLUDED.higher_is_bad, source_tables=EXCLUDED.source_tables`,
      [m.key, m.label, m.description || null, m.unit, m.higher_is_bad, m.source_tables]);
  }
  /* OPERATOR OVERRIDE (16 Sep 2026): a builtin rule edited in the console keeps its values across restarts — the seed
   * only re-applies its numbers to rows the operator never touched. "Reset to seed" clears the flag (PATCH operator_edited=false). */
  await c.query(`ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS operator_edited boolean NOT NULL DEFAULT false`);
  let n = 0;
  for (const r of RULES) {
    await c.query(
      `INSERT INTO alert_rules
        (key,name,description,metric_key,operator,threshold,window_hours,min_sample,team,severity,channel,dim,active_from,active_to,params,runbook,alert_class,segment,enabled,builtin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true)
       ON CONFLICT (key) DO UPDATE SET
         name=CASE WHEN alert_rules.operator_edited THEN alert_rules.name ELSE EXCLUDED.name END,
         description=CASE WHEN alert_rules.operator_edited THEN alert_rules.description ELSE EXCLUDED.description END,
         metric_key=EXCLUDED.metric_key,
         operator=CASE WHEN alert_rules.operator_edited THEN alert_rules.operator ELSE EXCLUDED.operator END,
         threshold=CASE WHEN alert_rules.operator_edited THEN alert_rules.threshold ELSE EXCLUDED.threshold END,
         window_hours=CASE WHEN alert_rules.operator_edited THEN alert_rules.window_hours ELSE EXCLUDED.window_hours END,
         min_sample=CASE WHEN alert_rules.operator_edited THEN alert_rules.min_sample ELSE EXCLUDED.min_sample END,
         team=CASE WHEN alert_rules.operator_edited THEN alert_rules.team ELSE EXCLUDED.team END,
         severity=CASE WHEN alert_rules.operator_edited THEN alert_rules.severity ELSE EXCLUDED.severity END,
         channel=CASE WHEN alert_rules.operator_edited THEN alert_rules.channel ELSE EXCLUDED.channel END,
         dim=CASE WHEN alert_rules.operator_edited THEN alert_rules.dim ELSE EXCLUDED.dim END,
         active_from=CASE WHEN alert_rules.operator_edited THEN alert_rules.active_from ELSE EXCLUDED.active_from END,
         active_to=CASE WHEN alert_rules.operator_edited THEN alert_rules.active_to ELSE EXCLUDED.active_to END,
         runbook=CASE WHEN alert_rules.operator_edited THEN alert_rules.runbook ELSE COALESCE(EXCLUDED.runbook, alert_rules.runbook) END,
         alert_class=EXCLUDED.alert_class, segment=EXCLUDED.segment, updated_at=now()`,
      [r.key, r.name, r.description || null, r.metric_key, r.operator, r.threshold,
       r.window_hours || 1, r.min_sample || 0, r.team || null, r.severity || 'P3',
       r.channel || 'any', JSON.stringify(r.dim || {}), r.active_from ?? null, r.active_to ?? null,
       JSON.stringify(r.params || {}), r.runbook || null, r.alert_class || null,
       r.segment || 'mvno', r.enabled !== false /* seed-time default only; the upsert never touches `enabled` */]);
    n++;
  }

  // Retire builtin rules whose key is no longer in RULES (e.g. the old 'mixed' rules that were
  // split into _technical/_business pairs on 2026-08-11: activation_fail_storm, citc_upstream_down,
  // change_plan_fail_spike, ownership_fail_spike). The upsert above never touches removed keys,
  // which would leave orphaned-but-still-enabled rows evaluating forever. DISABLE rather than
  // DELETE: alert history keeps its rule row (alerts.rule_id → ON DELETE SET NULL would orphan it)
  // and the retirement is reversible from the Rules UI. Custom (non-builtin) rules are untouched.
  const retired = await c.query(
    `UPDATE alert_rules SET enabled=false, updated_at=now()
      WHERE builtin=true AND enabled=true AND key <> ALL($1::text[])
      RETURNING key`, [RULES.map(r => r.key)]);

  // default sync setting (manual until the user enables auto)
  await c.query(
    `INSERT INTO console_settings (key,value) VALUES ('sync',$1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ enabled: false, mode: 'auto_replay', intervalSec: 15, stepHours: 3, cursor: null })]);

  // seed a super admin so the console is usable out of the box
  const admins = (process.env.CONSOLE_SUPER_ADMINS || 'yosri.yahmed@gmail.com,y.yahmed.sns@salam.sa')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const email of admins) {
    await c.query(
      `INSERT INTO console_users (email,name,role,team) VALUES ($1,$2,'super_admin','Digital Ops')
       ON CONFLICT (email) DO NOTHING`, [email, email.split('@')[0]]);
  }

  // seed built-in analytics dashboards
  const { DASHBOARDS } = require('./analyticsPresets');
  for (const d of DASHBOARDS) {
    await c.query(`INSERT INTO analytics_dashboards (key,name,spec,builtin) VALUES ($1,$2,$3,true)
      ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, spec=EXCLUDED.spec WHERE analytics_dashboards.builtin=true`,
      [d.key, d.name, JSON.stringify(d.spec)]);
  }

  // seed a couple of example ops events (only if empty) so the timeline overlay is visible out-of-the-box
  try {
    if (!(await c.query(`SELECT count(*)::int c FROM ops_events`)).rows[0].c) {
      await c.query(`INSERT INTO ops_events (kind,title,area,note,at) VALUES
        ('deploy','Console build deployed', NULL, 'Rolling restart', now() - interval '6 hours'),
        ('campaign','Weekend eSIM promo', 'payment', 'Marketing push', now() - interval '9 hours')`);
    }
  } catch (e) {}

  return { metrics: CATALOG.length, rules: n, retired: retired.rows.map(r => r.key),
           admins: admins.length, dashboards: DASHBOARDS.length };
}

module.exports = { init };
