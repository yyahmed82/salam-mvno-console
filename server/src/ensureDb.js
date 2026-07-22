/* Create the mvno_console database if it doesn't exist (connects to `postgres` db). */
const { Client } = require('pg');
const CONSOLE_URL = process.env.CONSOLE_DATABASE_URL || 'postgres://postgres:postgres@db:5432/mvno_console';
const dbName = new URL(CONSOLE_URL).pathname.slice(1);
const adminUrl = CONSOLE_URL.replace(/\/[^/]+$/, '/postgres');

(async () => {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  const r = await c.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [dbName]);
  if (!r.rowCount) { await c.query(`CREATE DATABASE ${dbName}`); console.log(`created database ${dbName}`); }
  else console.log(`database ${dbName} already exists`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
