#!/usr/bin/env node
/* arqami-day-check.cjs — is a day's Arqami figure real? (18 Sep 2026)
 *
 * The Arqami page shows what the console DB holds: cst_arqami_minutes, filled by cstOracle.js from
 * APPS.YY_REGISTER_NUMBER_AUDIT on EBPROD. When a day looks wrong — 624 requests and 1 371 silent minutes on
 * 09-16 against 17 673 the next day — the question is which of three things it is: the service really was quiet,
 * the console read the day badly, or the day boundary moved under us.
 *
 * This asks Oracle the same day three ways and prints the console's own number beside it:
 *   · the console's aggregation, verbatim (TRUNC(CAST(REQUEST_TIME AS DATE)))
 *   · a plain BETWEEN on the raw column, which shifts if REQUEST_TIME is a TIMESTAMP WITH TIME ZONE
 *   · the hour-by-hour shape, and the first and last request of the day
 * plus the neighbouring days for context and the session / database time zones, because a day that looks empty
 * is usually a day that landed in a different bucket.
 *
 * Read-only. Run on 152: set -a; . /apps/unified/.env; set +a; node server/scripts/arqami-day-check.cjs 2026-09-16
 */
'use strict';
process.env.CST_ORACLE_DISABLED = process.env.CST_ORACLE_DISABLED || '';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const oracle = require(path.join(SRC, 'cstOracle.js'));
const db = require(path.join(SRC, 'db.js'));

const day = (process.argv[2] || '').trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { console.error('usage: node arqami-day-check.cjs YYYY-MM-DD'); process.exit(2); }
const shift = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const T = process.env.CST_ORACLE_TABLE || 'APPS.YY_REGISTER_NUMBER_AUDIT';
const TC = process.env.CST_ORACLE_TIME_COL || 'REQUEST_TIME';
const OK = process.env.CST_ORACLE_SUCCESS_COL || 'SUCCESS';
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
const rpad = (s, n) => String(s == null ? '' : s).padStart(n);
const head = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

(async () => {
  if (!oracle.configured()) { console.error('CST_ORACLE_* not set — run this with /apps/unified/.env loaded'); process.exit(2); }

  head('1. Which Oracle are we asking, and on whose clock');
  const who = await oracle.query(
    `SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB, SYS_CONTEXT('USERENV','SESSION_USER') AS USR,
            TO_CHAR(SYSDATE,'YYYY-MM-DD HH24:MI:SS') AS SYSDATE_, DBTIMEZONE AS DB_TZ, SESSIONTIMEZONE AS SES_TZ
       FROM DUAL`, [], 30000);
  const w = who[0];
  console.log(`database ${w.DB} as ${w.USR} · SYSDATE ${w.SYSDATE_} · DB timezone ${w.DB_TZ} · session timezone ${w.SES_TZ}`);

  const [owner, tbl] = T.includes('.') ? T.split('.') : ['', T];
  const col = await oracle.query(
    `SELECT DATA_TYPE FROM ALL_TAB_COLUMNS WHERE OWNER = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [owner.toUpperCase(), tbl.toUpperCase(), TC.toUpperCase()], 30000).catch(() => []);
  console.log(`${T}.${TC} is ${col.length ? col[0].DATA_TYPE : 'of a type this account cannot read from ALL_TAB_COLUMNS'}`
    + (col.length && /TIME ZONE/i.test(col[0].DATA_TYPE) ? '  <-- carries a zone: CAST(... AS DATE) resolves it in the SESSION zone above' : ''));

  head(`2. ${day} and its neighbours, counted exactly as the console counts them`);
  const days = [shift(day, -2), shift(day, -1), day, shift(day, 1), shift(day, 2)];
  console.log(pad('DAY', 12) + rpad('ORACLE ROWS', 13) + rpad('OK', 10) + rpad('MINUTES', 10) + rpad('CONSOLE', 10) + rpad('CONSOLE MIN', 13) + '  SOURCE');
  for (const d of days) {
    const o = await oracle.query(
      `SELECT COUNT(*) AS N, SUM(CASE WHEN ${OK} = 'Y' THEN 1 ELSE 0 END) AS OKN,
              COUNT(DISTINCT TRUNC(CAST(${TC} AS DATE),'MI')) AS MINS
         FROM ${T}
        WHERE TRUNC(CAST(${TC} AS DATE)) = TO_DATE(?, 'YYYY-MM-DD')`, [d], 180000);
    const c = await db.console.query(
      `SELECT COALESCE(SUM(requests),0)::int AS n, COUNT(*)::int AS mins,
              COALESCE(string_agg(DISTINCT source, '+'), '-') AS src
         FROM cst_arqami_minutes WHERE day = $1`, [d]);
    const r = o[0], k = c.rows[0];
    const flag = Number(r.N) === k.n ? '' : '   <-- console and Oracle disagree';
    console.log(pad(d, 12) + rpad(Number(r.N).toLocaleString('en-US'), 13) + rpad(Number(r.OKN || 0).toLocaleString('en-US'), 10)
      + rpad(r.MINS, 10) + rpad(k.n.toLocaleString('en-US'), 10) + rpad(k.mins, 13) + '  ' + k.src + flag);
  }

  head(`3. ${day} on the raw column, without the CAST`);
  const raw = await oracle.query(
    `SELECT COUNT(*) AS N, TO_CHAR(MIN(${TC}), 'YYYY-MM-DD HH24:MI:SS') AS FIRST_, TO_CHAR(MAX(${TC}), 'YYYY-MM-DD HH24:MI:SS') AS LAST_
       FROM ${T} WHERE ${TC} >= TO_DATE(?, 'YYYY-MM-DD') AND ${TC} < TO_DATE(?, 'YYYY-MM-DD') + 1`, [day, day], 180000);
  console.log(`${Number(raw[0].N).toLocaleString('en-US')} rows · first ${raw[0].FIRST_ || '—'} · last ${raw[0].LAST_ || '—'}`);
  console.log('a different number from section 2 means the day boundary moves with the session time zone.');

  head(`4. ${day} hour by hour — where in the day the traffic actually is`);
  const hrs = await oracle.query(
    `SELECT TO_CHAR(TRUNC(CAST(${TC} AS DATE), 'HH24'), 'HH24') AS HR, COUNT(*) AS N,
            COUNT(DISTINCT TRUNC(CAST(${TC} AS DATE),'MI')) AS MINS
       FROM ${T} WHERE TRUNC(CAST(${TC} AS DATE)) = TO_DATE(?, 'YYYY-MM-DD')
      GROUP BY TRUNC(CAST(${TC} AS DATE), 'HH24') ORDER BY 1`, [day], 180000);
  if (!hrs.length) console.log('no row at all on this day.');
  else {
    const max = Math.max(...hrs.map(h => Number(h.N)));
    for (const h of hrs) console.log(`${h.HR}:00  ${rpad(Number(h.N).toLocaleString('en-US'), 8)}  ${rpad(h.MINS + ' min', 8)}  ` + '#'.repeat(Math.max(1, Math.round(Number(h.N) / max * 46))));
    console.log(`\n${hrs.length} of 24 hours carry traffic; the rest of the day has no row in the audit table.`);
  }

  head('5. The earliest row the table holds');
  const first = await oracle.query(`SELECT TO_CHAR(MIN(${TC}), 'YYYY-MM-DD HH24:MI:SS') AS F, COUNT(*) AS N FROM ${T}`, [], 300000).catch(e => [{ F: 'could not read: ' + e.message, N: null }]);
  console.log(`first request ever recorded: ${first[0].F}${first[0].N == null ? '' : ` · ${Number(first[0].N).toLocaleString('en-US')} rows in the table`}`);
  console.log('if that is on or after the day you are checking, the day is short because the audit only starts there.');

  process.exit(0);
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
