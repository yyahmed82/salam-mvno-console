#!/usr/bin/env node
/* PURGE CREDENTIAL MATERIAL FROM THE REPLICA — one-shot cleanup of the pre-sync bulk copy.
 *
 * WHY THIS EXISTS
 * prodSync now refuses to replicate credential columns (prodSync.SKIP_COLUMNS), so nothing new
 * arrives. But `users` was first loaded onto this replica by a FULL COPY (ending 2026-07-06)
 * that predates that rule, and those values are still sitting in the table. Two of them are not
 * merely stale — they are live secrets:
 *
 *   otp_secret_key   the TOTP seed for the customer's LOGIN OTP. User#send_otp only ever calls
 *                    `otp_regenerate_secret if otp_secret_key.blank?` — it NEVER rotates an
 *                    existing seed. A key copied in July still generates that customer's valid
 *                    login code today. Holding this column is equivalent to being able to mint
 *                    the second factor for half a million subscribers.
 *   password_digest  bcrypt hashes, offline-crackable at leisure.
 *
 * Both columns are NULLABLE in the app schema (db/schema.rb: `t.string "password_digest"`,
 * `t.string "otp_secret_key"`), and NOTHING in the console reads either one — verified by grep
 * across server/src and the web bundle. So nulling them costs no functionality.
 *
 * SAFETY
 *   • DRY RUN BY DEFAULT. Writes only with --apply.
 *   • Targets SOURCE_DATABASE_URL (the console's replica). Never production: PROD_DATABASE_URL is
 *     opened read-only by the sync and is not touched here at all.
 *   • Skips any column that is NOT NULL, or absent, rather than guessing a placeholder.
 *   • Batched by primary key so a large table never holds one long transaction.
 *   • Re-runnable: rows already cleared are skipped by the WHERE clause.
 *
 * Usage (from /apps/console/server, where .env is loaded):
 *   node purge-user-secrets.cjs                 # report what would be cleared
 *   node purge-user-secrets.cjs --apply         # clear it
 *   node purge-user-secrets.cjs --table=users --apply
 */
'use strict';
process.env.TZ = 'UTC';

const DEFAULTS = {
  users: ['password_digest', 'otp_secret_key', 'reset_password_token', 'confirmation_token',
    'unlock_token', 'authentication_token', 'encrypted_password']
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tableArg = (args.find(a => a.startsWith('--table=')) || '').split('=')[1];
const BATCH = Number((args.find(a => a.startsWith('--batch=')) || '').split('=')[1]) || 20000;
const tables = tableArg ? [tableArg] : Object.keys(DEFAULTS);

const url = process.env.SOURCE_DATABASE_URL;
if (!url) { console.error('Missing SOURCE_DATABASE_URL. Did you `set -a; . ../.env; set +a`?'); process.exit(2); }

const { Pool } = require('pg');
const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 300000, options: '-c timezone=UTC' });

(async () => {
  const c = await pool.connect();
  let exit = 0;
  try {
    console.log(APPLY ? '⚠  APPLY MODE — this will write to the replica.\n' : 'DRY RUN — nothing will be written. Add --apply to clear.\n');
    for (const table of tables) {
      const wanted = DEFAULTS[table] || [];
      const meta = (await c.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = ANY($2::text[])`, [table, wanted])).rows;
      if (!meta.length) { console.log(`${table}: none of the tracked credential columns exist — nothing to do.`); continue; }

      const pkRow = (await c.query(
        `SELECT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = ($1)::regclass AND i.indisprimary LIMIT 1`, [table])).rows[0];
      if (!pkRow) { console.log(`${table}: no primary key — refusing to batch. Skipped.`); exit = 1; continue; }
      const pk = pkRow.attname;

      const clearable = [], refused = [];
      for (const m of meta) (m.is_nullable === 'YES' ? clearable : refused).push(m.column_name);
      refused.forEach(col => console.log(`  ${table}.${col}: NOT NULL — refusing to invent a placeholder. Left untouched.`));
      if (!clearable.length) { console.log(`${table}: nothing clearable.`); continue; }

      const notNull = clearable.map(col => `"${col}" IS NOT NULL`).join(' OR ');
      const before = (await c.query(`SELECT count(*)::bigint n FROM "${table}" WHERE ${notNull}`)).rows[0].n;
      console.log(`${table}: ${Number(before).toLocaleString()} rows still carry ${clearable.join(', ')}`);
      if (!APPLY || before === '0') { console.log(''); continue; }

      const setClause = clearable.map(col => `"${col}" = NULL`).join(', ');
      let cleared = 0;
      for (;;) {
        /* updated_at is deliberately NOT touched: it is the sync watermark, and bumping it would
         * make every purged row look freshly changed and re-enter the next incremental pass. */
        const r = await c.query(
          `WITH victims AS (
             SELECT "${pk}" FROM "${table}" WHERE ${notNull} ORDER BY "${pk}" LIMIT ${BATCH}
           )
           UPDATE "${table}" t SET ${setClause}
            FROM victims v WHERE t."${pk}" = v."${pk}"`);
        if (!r.rowCount) break;
        cleared += r.rowCount;
        process.stdout.write(`\r  cleared ${cleared.toLocaleString()} / ${Number(before).toLocaleString()}`);
      }
      const after = (await c.query(`SELECT count(*)::bigint n FROM "${table}" WHERE ${notNull}`)).rows[0].n;
      console.log(`\n  ✓ ${table}: ${cleared.toLocaleString()} rows cleared · ${Number(after).toLocaleString()} remaining\n`);
      if (Number(after) > 0) exit = 1;
    }
    if (!APPLY) console.log('Re-run with --apply to perform the purge.');
  } catch (e) {
    console.error('\nFAILED:', e.message);
    exit = 1;
  } finally {
    c.release(); await pool.end();
  }
  process.exit(exit);
})();
