#!/usr/bin/env node
/* Discover the real OSB log database/table on 172.31.43.72.
 *
 * We now KNOW the credentials work — MySQL returned ER_BAD_DB_ERROR ("Unknown database 'logs'"),
 * which it only sends AFTER authenticating. So the account is fine and only the database name in
 * OSB_LOG_URL is wrong. This connects WITHOUT selecting a database and asks the server what exists.
 *
 * Run ON 152 (uses the console's own mysql2 — nothing to install):
 *     cd /apps/console/server && set -a; . ../.env; set +a
 *     node /apps/console/server/find-osb-log-table.cjs
 *
 * READ-ONLY: SHOW DATABASES, information_schema lookups, and at most a few SELECTs with LIMIT.
 */
process.env.TZ = 'UTC';
const mysql = require('mysql2/promise');

const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
            b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` };
const head = t => console.log('\n' + C.b(t) + '\n' + '─'.repeat(t.length));

// Reuse OSB_LOG_URL but DROP the database part — that is the bit we know is wrong.
function connCfg() {
  const raw = process.env.OSB_LOG_URL;
  if (raw) {
    const u = new URL(raw);
    return { host: u.hostname, port: Number(u.port || 3306),
             user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  }
  if (process.env.OSB_DB_HOST) {
    return { host: process.env.OSB_DB_HOST, port: Number(process.env.OSB_DB_PORT || 3306),
             user: process.env.OSB_DB_USER, password: process.env.OSB_DB_PASSWORD };
  }
  console.error('Neither OSB_LOG_URL nor OSB_DB_HOST is set — source /apps/console/.env first.');
  process.exit(2);
}

(async () => {
  const cfg = connCfg();
  console.log(`Connecting to ${cfg.user}@${cfg.host}:${cfg.port} ${C.d('(no database selected)')}`);
  let c;
  try { c = await mysql.createConnection({ ...cfg, connectTimeout: 10000 }); }
  catch (e) {
    console.error(C.r('\nconnection failed: ') + e.message + C.d(`  [${e.code}]`));
    if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('  → credentials rejected (they worked a moment ago — check for a typo)');
    process.exit(1);
  }
  console.log(C.g('authenticated ✓'));

  head('1 · databases this account can see');
  const [dbs] = await c.query('SHOW DATABASES');
  const names = dbs.map(r => Object.values(r)[0]);
  const sys = ['information_schema', 'performance_schema', 'mysql', 'sys'];
  const user = names.filter(n => !sys.includes(n));
  user.forEach(n => console.log('  · ' + n));
  if (!user.length) console.log(C.y('  none — the account can authenticate but has no database grants'));

  head('2 · tables that look like an integration/UIL log');
  const [tabs] = await c.query(
    `SELECT table_schema, table_name, table_rows
       FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys')
        AND (table_name LIKE '%uil%' OR table_name LIKE '%log%' OR table_name LIKE '%osb%'
             OR table_name LIKE '%audit%' OR table_name LIKE '%transaction%')
      ORDER BY table_rows DESC LIMIT 40`);
  if (!tabs.length) {
    console.log(C.y('  no candidate tables visible to this account'));
  } else {
    for (const t of tabs)
      console.log(`  ${C.b(t.table_schema + '.' + t.table_name)}` +
                  C.d(`   ~${Number(t.table_rows || 0).toLocaleString()} rows`));
  }

  head('3 · which candidate actually holds the 1500 / OSB-382000 faults?');
  let winner = null;
  for (const t of tabs.slice(0, 12)) {
    const [cols] = await c.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema=? AND table_name=?`, [t.table_schema, t.table_name]);
    const cn = cols.map(x => (x.column_name || x.COLUMN_NAME).toLowerCase());
    const code = cn.find(x => /response_code|resp_code|status_code|error_code/.test(x));
    const msg  = cn.find(x => /response_message|resp_msg|message|error_message|response/.test(x));
    const time = cn.find(x => /insert_date_time|created|timestamp|log_date|date_time/.test(x));
    const api  = cn.find(x => /api_name|api|service|operation|endpoint/.test(x));
    if (!code && !msg) continue;
    try {
      const where = [];
      if (code) where.push(`\`${code}\` = '1500'`);
      if (msg)  where.push(`\`${msg}\` LIKE '%OSB-382000%'`);
      const [n] = await c.query(
        `SELECT count(*) AS n FROM \`${t.table_schema}\`.\`${t.table_name}\` WHERE ${where.join(' OR ')}`);
      const hits = Number(n[0].n);
      const mark = hits > 0 ? C.g('★ ' + hits.toLocaleString() + ' faults') : C.d('0 faults');
      console.log(`  ${t.table_schema}.${t.table_name}  ${mark}`);
      console.log(C.d(`      code=${code || '—'}  msg=${msg || '—'}  time=${time || '—'}  api=${api || '—'}`));
      if (hits > 0 && !winner) winner = { ...t, code, msg, time, api, hits };
    } catch (e) { console.log(C.d(`  ${t.table_schema}.${t.table_name}  — ${e.code || e.message}`)); }
  }

  head('4 · what to put in /apps/console/.env');
  if (!winner) {
    console.log(C.y('  No table with 1500 / OSB-382000 rows was found.'));
    console.log('  Either this account cannot see the right schema, or the faults live elsewhere.');
    console.log('  Send section 1+2 above to the OSB team (Debasis) and ask which schema.table holds');
    console.log('  the integration log, then set OSB_LOG_* to match.');
  } else {
    const u = new URL(process.env.OSB_LOG_URL || 'mysql://x:y@h:3306/d');
    console.log(C.g(`  Found: ${winner.table_schema}.${winner.table_name} — ${winner.hits.toLocaleString()} fault rows\n`));
    console.log(`  OSB_LOG_URL=mysql://${u.username}:${u.password}@${u.hostname}:${u.port || 3306}/${winner.table_schema}`);
    console.log(`  OSB_LOG_TABLE=${winner.table_name}`);
    if (winner.time) console.log(`  OSB_LOG_TIME_COL=${winner.time}`);
    if (winner.code) console.log(`  OSB_LOG_CODE_COL=${winner.code}`);
    if (winner.msg)  console.log(`  OSB_LOG_MSG_COL=${winner.msg}`);
    if (winner.api)  console.log(`  OSB_LOG_API_COL=${winner.api}`);
    console.log(C.d('\n  (password shown already URL-encoded, exactly as it is in your current .env)'));

    if (winner.time) {
      head('5 · faults in the last 24h — the read-path we have never been able to see');
      try {
        const [rows] = await c.query(
          `SELECT date_format(\`${winner.time}\`, '%Y-%m-%d %H:00') AS hour, count(*) AS faults
             FROM \`${winner.table_schema}\`.\`${winner.table_name}\`
            WHERE (${winner.code ? `\`${winner.code}\`='1500'` : '1=0'}
                   ${winner.msg ? `OR \`${winner.msg}\` LIKE '%OSB-382000%'` : ''})
              AND \`${winner.time}\` >= now() - interval 24 hour
            GROUP BY 1 ORDER BY 1`);
        if (!rows.length) console.log(C.d('  none in the last 24h'));
        const max = Math.max(1, ...rows.map(r => Number(r.faults)));
        for (const r of rows)
          console.log(`  ${r.hour}  ${'█'.repeat(Math.round(Number(r.faults) / max * 40)).padEnd(40, '·')} ${r.faults}`);
        console.log(C.d('\n  Use this to set OSB_FAULT_ALERT_THRESHOLD — the default 300 per 10 min was a guess.'));
      } catch (e) { console.log(C.d('  hourly query failed: ' + e.message)); }
    }
  }

  await c.end();
  console.log('');
})().catch(e => { console.error(C.r('failed: ') + e.message); process.exit(1); });
