#!/usr/bin/env node
/* check-fixed-sources.cjs — what each Fixed read model holds, as the errors board sees it.
 *   set -a; . /apps/unified/.env; set +a; node /apps/unified/server/check-fixed-sources.cjs [hours=24]
 * Prints, for sda_ops (OPS_DATABASE_URL) and sda_ops_beta (OPS_BETA_DATABASE_URL):
 *   channel buckets (sda / qr / web / salamhome) with counts and latest event, the workflow mix behind "web"
 *   (a PULSE fold shows as salamHome* workflows under web), type buckets, and the oldest event (coverage).
 * READ-ONLY. */
const { Pool } = require('pg');
const fe = require('./src/fixedErrors');
const hours = Number(process.argv[2]) || 24;
const strip = url => { try { const u = new URL(url); const schema = u.searchParams.get('schema'); for (const k of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'connect_timeout']) u.searchParams.delete(k); return { cs: u.toString(), schema }; } catch (_) { return { cs: url, schema: null }; } };
(async () => {
  for (const [name, env] of [['sda_ops (OPS_DATABASE_URL)', 'OPS_DATABASE_URL'], ['sda_ops_beta (OPS_BETA_DATABASE_URL)', 'OPS_BETA_DATABASE_URL']]) {
    const url = process.env[env]; console.log(`\n== ${name}${url ? '' : ' — NOT SET'}`); if (!url) continue;
    const { cs, schema } = strip(url);
    const p = new Pool({ connectionString: cs, max: 1, options: `-c default_transaction_read_only=on${schema ? ` -c search_path=${schema},public` : ''}` });
    try {
      const W = `e.occurred_at >= now() - interval '${hours} hours'`;
      const ch = await p.query(`SELECT ${fe.CHANNEL_EXPR} AS bucket, e.channel AS raw, count(*)::int n, max(e.occurred_at) latest FROM error_events e WHERE ${W} GROUP BY 1,2 ORDER BY 1,2`);
      console.log(`channel buckets, last ${hours}h:`); console.table(ch.rows);
      const wf = await p.query(`SELECT ${fe.CHANNEL_EXPR} AS bucket, oa.workflow::text AS workflow, count(*)::int n FROM error_events e LEFT JOIN order_attempts oa ON oa.id = e.attempt_id WHERE ${W} AND ${fe.CHANNEL_EXPR} IN ('web','salamhome') GROUP BY 1,2 ORDER BY 1,3 DESC`);
      console.log('workflows behind web / salamhome (salamHome* under "web" = the app folded into e-purchase):'); console.table(wf.rows);
      const ty = await p.query(`SELECT ${fe.TYPE_EXPR} AS type, count(*)::int n FROM error_events e LEFT JOIN order_attempts oa ON oa.id = e.attempt_id WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`);
      console.log('type buckets:'); console.table(ty.rows);
      const cov = await p.query(`SELECT min(occurred_at) oldest, max(occurred_at) latest, count(*)::int total FROM error_events`);
      console.log('coverage:', cov.rows[0]);
    } catch (e) { console.log('ERROR', e.message); } finally { await p.end(); }
  }
})();
