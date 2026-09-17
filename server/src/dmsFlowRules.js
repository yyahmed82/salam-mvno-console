/* DMS FLOW RULES — recognising abnormal dealer journeys from the databases alone (17 Sep 2026).
 *
 * WHY: the code review (DMS-JOURNEYS-CODE.md §5–6) showed that the journey ledgers can never show
 * a failure (rows are written only on responseCode "00"), that several journeys report success
 * after the wallet debit failed, that money moves before BSS with no reversal, and that Semati is
 * compensated in exactly one place. None of that is an "error" anywhere — it is a SHAPE across
 * tables: a semati_logs row without its activation row, a topup_logs success without its wallet
 * row, a port order without its mnp_logs row. These rules encode those shapes as bounded SQL over
 * Clara (dms_audit_logs / dms_v1 / trms_wallet), run on a schedule, keep the findings in the
 * console DB (identifiers masked at ingest) and raise alerts for the money/regulator ones.
 *
 * PROD-SAFETY: every ledger is read through an ID WINDOW, never a time scan — the timestamp
 * column is not known to be indexed on any of these tables and user_onboarding_logs alone is
 * ~365M rows. The id that corresponds to the window start is found by binary search on the PK
 * (≈25 point lookups), cached, and every table alias in a rule carries `alias.id > floor`. Rules
 * run one at a time, each with its own budget, and a rule that cannot resolve its columns degrades
 * to a note (house rule: we do not own this schema).
 *
 * Env: DMS_FLOW_RULES=0 disables · DMS_FLOW_RULES_INTERVAL_SEC (900) · DMS_FLOW_RULES_WINDOW_H (2)
 *      DMS_FLOW_RULES_BUDGET_MS (25000 per rule) · DMS_FLOW_RULES_RETENTION_DAYS (30) */
'use strict';
const db = require('./db');
const dms = require('./dmsDb');
const { RULE_META } = require('./dmsJourneySpec');

const AUD = process.env.DMS_AUDIT_SCHEMA || 'dms_audit_logs', V1 = 'dms_v1', WAL = 'trms_wallet';
const CFG = () => ({
  enabled: process.env.DMS_FLOW_RULES !== '0',
  intervalSec: Number(process.env.DMS_FLOW_RULES_INTERVAL_SEC) || 900,
  windowH: Number(process.env.DMS_FLOW_RULES_WINDOW_H) || 2,
  budgetMs: Number(process.env.DMS_FLOW_RULES_BUDGET_MS) || 25000,
  retentionDays: Number(process.env.DMS_FLOW_RULES_RETENTION_DAYS) || 30
});
const H = 3600e3, MIN = 60e3;
const q = (schema, table) => `\`${schema}\`.\`${table}\``;

/* ---- per-table facts: timezone (newest row vs now, same method as dmsJourneys.resolve) ---- */
const _tz = new Map();
async function tzShift(schema, table, atCol) {
  const k = `${schema}.${table}`; const c = _tz.get(k);
  if (c && Date.now() - c.t < 30 * MIN) return c.ms;
  let ms = 0;
  try {
    const r = await dms.q(`SELECT \`${atCol}\` a FROM ${q(schema, table)} ORDER BY id DESC LIMIT 1`);
    const a = r[0] && r[0].a != null ? new Date(r[0].a).getTime() : null;
    const dh = a != null ? (a - Date.now()) / H : 0;
    ms = (dh > 2 && dh < 4) ? 3 * H : 0;
  } catch (_) { ms = 0; }
  _tz.set(k, { t: Date.now(), ms }); return ms;
}
/* ---- id floor for a UTC instant: binary search on the PK ---- */
const _floor = new Map();
async function floorId(schema, table, atCol, sinceUtc) {
  const bucket = Math.floor(sinceUtc.getTime() / (10 * MIN));
  const k = `${schema}.${table}@${bucket}`; if (_floor.has(k)) return _floor.get(k);
  const shift = await tzShift(schema, table, atCol);
  const target = sinceUtc.getTime() + shift;
  const mx = await dms.q(`SELECT MAX(id) m FROM ${q(schema, table)}`);
  const max = Number((mx[0] || {}).m || 0);
  if (!max) { _floor.set(k, 0); return 0; }
  let lo = 0, hi = max;
  for (let i = 0; i < 40 && hi - lo > 200; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await dms.q(`SELECT \`${atCol}\` a FROM ${q(schema, table)} WHERE id >= ? ORDER BY id LIMIT 1`, [mid]);
    const a = r[0] && r[0].a != null ? new Date(r[0].a).getTime() : null;
    if (a == null || a >= target) hi = mid; else lo = mid;
  }
  _floor.set(k, lo); return lo;
}

/* ---- rule context: T() resolves a table alias with its bound + local-time params ---- */
async function makeCtx(fromUtc, toUtc) {
  const cols = new Map();
  const ctx = { from: fromUtc, to: toUtc, notes: [] };
  ctx.have = async (schema, table, wanted) => {
    const k = `${schema}.${table}`; if (!cols.has(k)) cols.set(k, await dms.columnsOf(schema, table));
    const have = cols.get(k); const missing = wanted.filter(c => !have.has(c.toLowerCase()));
    if (!have.size) throw Object.assign(new Error(`${k} not visible`), { skip: true });
    if (missing.length) throw Object.assign(new Error(`${k} lacks ${missing.join(', ')}`), { skip: true });
    return true;
  };
  ctx.col = async (schema, table, col) => { const k = `${schema}.${table}`; if (!cols.has(k)) cols.set(k, await dms.columnsOf(schema, table)); return cols.get(k).has(col.toLowerCase()); };
  /* select list that tolerates missing optional columns (NULL AS col) */
  ctx.sel = async (schema, table, alias, list) => { const out = []; for (const [col, as] of list.map(x => Array.isArray(x) ? x : [x, x])) out.push((await ctx.col(schema, table, col)) ? `${alias}.\`${col}\` ${as}` : `NULL ${as}`); return out.join(', '); };
  ctx.T = async (schema, table, alias, atCol = 'insert_date_time', extraCols = []) => {
    await ctx.have(schema, table, ['id', atCol, ...extraCols]);
    const shift = await tzShift(schema, table, atCol);
    const floor = await floorId(schema, table, atCol, new Date(fromUtc.getTime() - 30 * MIN));   // 30 min slack for look-behind joins
    return { ref: `${q(schema, table)} ${alias}`, b: `${alias}.id > ${floor}`, at: `${alias}.\`${atCol}\``, shiftH: shift / H,
      lo: new Date(fromUtc.getTime() + shift), hi: new Date(toUtc.getTime() + shift), floor };
  };
  return ctx;
}
/* time-window predicate for a resolved table (local clock of that table) */
const W = t => `${t.at} >= ? AND ${t.at} < ?`;
const digits9 = col => `RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 9)`;

/* ---- CLOCK NORMALISATION (added after the first live run, 17 Sep 2026).
 * Each ledger is read with its OWN clock for the window predicate (index-friendly), but the moment
 * two tables are compared with each other the raw columns must not be mixed: trms_wallet and the
 * KSA-written dms_v1 tables run 3 h ahead of the dms_audit_logs ledgers. U(t) expresses a table's
 * timestamp in UTC, so every cross-table comparison below is clock-safe by construction. ---- */
const U = t => `(${t.at} - INTERVAL ${t.shiftH} HOUR)`;

/* ---- the rules. Each returns { rows, note? }. rows ≤ LIMIT (capped flag set by the runner). ---- */
const LIMIT = 1000;
const RULES = {
  /* Regulator: Semati type 1 accepted, no activation / re-auth / cancel afterwards */
  S1: { grace: 30 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn']);
    const a = await c.T(AUD, 'sim_activation_logs', 'a', 'insert_date_time', ['mobile_number']);
    const r = await c.T(AUD, 'sim_reauthentication_logs', 'r', 'insert_date_time', ['mobile_number']).catch(() => null);
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'msisdn_req', 'response_Code']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.person_id, x.dealer, x.tcn, x.uil_transaction_id, x.logs_reference_id
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} m, s.msisdn, s.person_id, s.employee_username dealer, s.tcn, s.uil_transaction_id, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='1' AND s.response_Code='600' AND ${W(s)}) x
      LEFT JOIN (SELECT ${digits9('a.mobile_number')} m, ${U(a)} at FROM ${a.ref} WHERE ${a.b}) act ON act.m = x.m AND act.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 30 MINUTE
      ${r ? `LEFT JOIN (SELECT ${digits9('r.mobile_number')} m, ${U(r)} at FROM ${r.ref} WHERE ${r.b}) ra ON ra.m = x.m AND ra.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 30 MINUTE` : ''}
      LEFT JOIN (SELECT ${digits9('cm.msisdn_req')} m, ${U(cm)} at FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%reauthenticate' AND cm.response_Code='00') rc ON rc.m = x.m AND rc.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 30 MINUTE
      LEFT JOIN (SELECT ${digits9('s.msisdn')} m, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='4') cn ON cn.m = x.m AND cn.at >= x.at
      WHERE act.m IS NULL ${r ? 'AND ra.m IS NULL' : ''} AND rc.m IS NULL AND cn.m IS NULL
      GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: type 2 (new SIM) with neither a data-SIM activation nor a cancel-SIM (swap) after it */
  S2: { grace: 30 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn', 'person_id']);
    const a = await c.T(AUD, 'sim_activation_logs', 'a', 'insert_date_time', ['api_name', 'customer_id_number']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.person_id, x.dealer, x.tcn, x.logs_reference_id
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} m, s.msisdn, s.person_id, s.employee_username dealer, s.tcn, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='2' AND s.response_Code='600' AND ${W(s)}) x
      LEFT JOIN (SELECT a.customer_id_number pid, ${U(a)} at FROM ${a.ref} WHERE ${a.b} AND a.api_name LIKE '%activatedatasim') act ON act.pid = x.person_id AND act.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 30 MINUTE
      LEFT JOIN (SELECT ${digits9('s.msisdn')} m, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='5') sw ON sw.m = x.m AND sw.at BETWEEN x.at AND x.at + INTERVAL 10 MINUTE
      WHERE act.pid IS NULL AND sw.m IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows, note: 'type 2 rows followed by a type 5 within 10 min are swaps and are excluded' };
  } },
  /* Regulator: swap half-done — new SIM (2) then no cancel of the old SIM (5) while a swap was attempted */
  S3: { grace: 5 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn', 'logs_reference_id']);
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code', 'logs_reference_id']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.dealer, x.logs_reference_id, MAX(sc.swap_call) swap_call
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} m, s.msisdn, s.employee_username dealer, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='2' AND s.response_Code='600' AND ${W(s)}) x
      JOIN (SELECT cm.logs_reference_id ref, CONCAT(cm.api_name,' → ',cm.response_Code) swap_call FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%swap%' AND cm.logs_reference_id <> '') sc ON sc.ref = x.logs_reference_id
      LEFT JOIN (SELECT ${digits9('s.msisdn')} m, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='5' AND s.response_Code='600') cn ON cn.m = x.m AND cn.at BETWEEN x.at AND x.at + INTERVAL 5 MINUTE
      WHERE cn.m IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: MNP transfer-operator accepted, no port order and no cancel */
  S4: { grace: 10 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn']);
    const m = await c.T(AUD, 'mnp_logs', 'm', 'insert_date_time', ['mobile_number']);
    /* was: semati vs uil_logs create-port-order. X1 proved the cms/uil trace does not correlate and
     * uil_logs.msisdn is empty for the MNP DTO, so the port order is invisible there — the ledger
     * written by the same consumer (mnp_logs, success only) is the honest counterpart. */
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.person_id, x.dealer, x.logs_reference_id
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} mm, s.msisdn, s.person_id, s.employee_username dealer, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='18' AND s.response_Code='600' AND ${W(s)}) x
      LEFT JOIN (SELECT ${digits9('m.mobile_number')} mm, ${U(m)} at FROM ${m.ref} WHERE ${m.b}) p
        ON p.mm = x.mm AND p.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 15 MINUTE
      LEFT JOIN (SELECT ${digits9('s.msisdn')} mm, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='4') cn
        ON cn.mm = x.mm AND cn.at BETWEEN x.at AND x.at + INTERVAL 15 MINUTE
      WHERE p.mm IS NULL AND cn.mm IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows, note: 'Semati moved the number to Salam but no successful mnp_logs row followed and no cancel was sent' };
  } },
  /* Regulator: ownership transferred at Semati, no ledger success within 10 min and no revert */
  S6: { grace: 15 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn']);
    const t = await c.T(AUD, 'transfer_ownership_logs', 't', 'insert_date_time', ['mobile_number']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.person_id, x.dealer, x.logs_reference_id
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} m, s.msisdn, s.person_id, s.employee_username dealer, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='17' AND s.response_Code='600' AND ${W(s)}) x
      LEFT JOIN (SELECT ${digits9('t.mobile_number')} m, ${U(t)} at FROM ${t.ref} WHERE ${t.b}) tr ON tr.m = x.m AND tr.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 15 MINUTE
      LEFT JOIN (SELECT s.id sid, ${digits9('s.msisdn')} m, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='17') rv ON rv.m = x.m AND rv.sid <> x.id AND rv.at BETWEEN x.at AND x.at + INTERVAL 60 MINUTE
      WHERE tr.m IS NULL AND rv.m IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: subscription changed at Semati (6) but no BSS conversion/option update and no revert */
  S7: { grace: 10 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn']);
    const pp = await c.T(AUD, 'price_plan_logs', 'pp', 'insert_date_time', ['mobile_number']);
    /* same correction as S4: the plan change is confirmed by price_plan_logs (written on 00), not by
     * a uil_logs row the trace cannot reach. */
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.person_id, x.dealer, x.logs_reference_id
      FROM (SELECT s.id, ${U(s)} at, ${digits9('s.msisdn')} mm, s.msisdn, s.person_id, s.employee_username dealer, s.logs_reference_id
            FROM ${s.ref} WHERE ${s.b} AND s.request_type='6' AND s.response_Code='600' AND ${W(s)}) x
      LEFT JOIN (SELECT ${digits9('pp.mobile_number')} mm, ${U(pp)} at FROM ${pp.ref} WHERE ${pp.b}) c2
        ON c2.mm = x.mm AND c2.at BETWEEN x.at - INTERVAL 5 MINUTE AND x.at + INTERVAL 15 MINUTE
      LEFT JOIN (SELECT s.id sid, ${digits9('s.msisdn')} mm, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type='6') rv
        ON rv.mm = x.mm AND rv.sid <> x.id AND rv.at BETWEEN x.at AND x.at + INTERVAL 15 MINUTE
      WHERE c2.mm IS NULL AND rv.mm IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows, note: 'Semati accepted the subscription change with no price_plan_logs success and no revert' };
  } },
  /* Regulator: compensation (cancel number / cancel SIM) rejected by Semati */
  S8: { grace: 0, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code']);
    const rows = await dms.qSlow(`SELECT s.id, ${U(s)} at, s.request_type, s.response_Code, s.response_Message, s.msisdn, s.employee_username dealer, s.logs_reference_id
      FROM ${s.ref} WHERE ${s.b} AND s.request_type IN ('4','5') AND s.response_Code <> '600' AND ${W(s)} ORDER BY s.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: cancel ratio per dealer / platform */
  S9: { grace: 0, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code']);
    const rows = await dms.qSlow(`SELECT s.employee_username dealer, SUM(s.request_type='4') cancels, SUM(s.request_type='1' AND s.response_Code='600') registrations
      FROM ${s.ref} WHERE ${s.b} AND ${W(s)} GROUP BY s.employee_username HAVING cancels >= 3 AND cancels > registrations * 0.10 ORDER BY cancels DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows, note: 'dealers with ≥3 cancels and cancels > 10 % of registrations in the window' };
  } },
  /* Regulator: activation success with no Semati verify row (bypass or lost push) */
  S10: { grace: 5 * MIN, run: async c => {
    const a = await c.T(AUD, 'sim_activation_logs', 'a', 'insert_date_time', ['mobile_number', 'logs_reference_id']);
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code', 'msisdn', 'logs_reference_id']);
    const asel = await c.sel(AUD, 'sim_activation_logs', 'a', ['api_name', ['mobile_number', 'msisdn'], ['sim_iccid_number', 'iccid'], ['channel_username', 'dealer'], 'logs_reference_id']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.api_name, x.msisdn, x.iccid, x.dealer, x.logs_reference_id
      FROM (SELECT a.id, ${U(a)} at, ${digits9('a.mobile_number')} m, ${asel} FROM ${a.ref} WHERE ${a.b} AND ${W(a)}) x
      LEFT JOIN (SELECT s.logs_reference_id ref, ${digits9('s.msisdn')} m, ${U(s)} at FROM ${s.ref} WHERE ${s.b} AND s.request_type IN ('1','2') AND s.response_Code='600') sm
        ON (sm.ref = x.logs_reference_id AND sm.ref <> '') OR (sm.m = x.m AND sm.at BETWEEN x.at - INTERVAL 30 MINUTE AND x.at + INTERVAL 5 MINUTE)
      WHERE sm.m IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [a.lo, a.hi], c.budget);
    return { rows, note: 'bypassSemati from the app, or the Semati push was lost (producer down during the verify)' };
  } },
  /* Regulator: Semati accepted but the wrapping UIL call did not end 600 (push failed after Semati) */
  S11: { grace: 2 * MIN, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['response_Code', 'uil_transaction_id']);
    const u = await c.T(AUD, 'uil_logs', 'u', 'insert_date_time', ['response_Code', 'uil_transaction_id']);
    const rows = await dms.qSlow(`SELECT s.id, ${U(s)} at, s.request_type, s.msisdn, s.employee_username dealer, s.uil_transaction_id, u.response_Code uil_code, u.response_Message uil_message
      FROM ${s.ref} LEFT JOIN ${u.ref} ON ${u.b} AND u.uil_transaction_id = s.uil_transaction_id AND u.uil_transaction_id <> ''
      WHERE ${s.b} AND s.response_Code='600' AND s.uil_transaction_id <> '' AND ${W(s)} AND (u.id IS NULL OR u.response_Code NOT IN ('600','00'))
      ORDER BY s.id DESC LIMIT ${LIMIT}`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: rejection mix per request type (informational; alert when > 30 % non-600 with ≥10 calls) */
  S12: { grace: 0, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['request_type', 'response_Code']);
    const rows = await dms.qSlow(`SELECT s.request_type, COUNT(*) n, SUM(s.response_Code<>'600') rejected, ROUND(100*SUM(s.response_Code<>'600')/COUNT(*),1) pct,
        SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT CASE WHEN s.response_Code<>'600' THEN s.response_Code END), ',', 5) codes
      FROM ${s.ref} WHERE ${s.b} AND ${W(s)} GROUP BY s.request_type HAVING n >= 10 AND pct > 30 ORDER BY rejected DESC`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Regulator: Semati latency */
  S13: { grace: 0, run: async c => {
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['response_time_msec']);
    const rows = await dms.qSlow(`SELECT COUNT(*) n, ROUND(AVG(CAST(REPLACE(s.response_time_msec,' ms','') AS UNSIGNED))) avg_ms, MAX(CAST(REPLACE(s.response_time_msec,' ms','') AS UNSIGNED)) max_ms,
        SUM(CAST(REPLACE(s.response_time_msec,' ms','') AS UNSIGNED) > 60000) over_60s
      FROM ${s.ref} WHERE ${s.b} AND ${W(s)} HAVING n >= 5 AND (avg_ms > 20000 OR over_60s >= 3)`, [s.lo, s.hi], c.budget);
    return { rows };
  } },
  /* Integrity: a 00 call on a ledgered URI whose journey row is missing (mapper/DB error in the consumer) */
  J2: { grace: 10 * MIN, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code', 'logs_reference_id']);
    const MAP = [['/cus/simactivation/activate', 'sim_activation_logs'], ['/cus/simactivation/activatedatasim', 'sim_activation_logs'], ['/cus/e-simactivation/esim-activate', 'sim_activation_logs'],
      ['/cus/mnp/transportoperator', 'mnp_logs'], ['/cus/simswap/swap', 'sim_swap_logs'], ['/cus/ownership/update', 'transfer_ownership_logs'], ['/cus/priceplan/update', 'price_plan_logs'],
      ['/cus/priceplan/renew', 'renew_priceplan_logs'], ['/cus/addon/purchase', 'addon_logs'], ['/cus/recharge/topup', 'topup_logs'], ['/cus/recharge/evoucher', 'topup_logs'], ['/cus/wallet/wallettransfer', 'wallet_money_transfer_logs']];
    const out = [];
    for (const [api, table] of MAP) {
      const j = await c.T(AUD, table, 'j', 'insert_date_time', ['logs_reference_id']).catch(() => null); if (!j) continue;
      const rows = await dms.qSlow(`SELECT cm.id, ${U(cm)} at, cm.api_name, cm.msisdn_req msisdn, cm.username dealer, cm.logs_reference_id, '${table}' missing_in
        FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name = ? AND cm.response_Code='00' AND ${W(cm)} AND cm.logs_reference_id <> ''
        AND NOT EXISTS (SELECT 1 FROM ${j.ref} WHERE ${j.b} AND j.logs_reference_id = cm.logs_reference_id) ORDER BY cm.id DESC LIMIT 30`, [api, cm.lo, cm.hi], c.budget);
      out.push(...rows); if (out.length >= LIMIT) break;
    }
    return { rows: out.slice(0, LIMIT) };
  } },
  /* Integrity: share of cms_logs rows without channel attribution */
  J4: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['channel_id']);
    const rows = await dms.qSlow(`SELECT COUNT(*) n, SUM(cm.channel_id IS NULL OR cm.channel_id='') unattributed, ROUND(100*SUM(cm.channel_id IS NULL OR cm.channel_id='')/COUNT(*),1) pct
      FROM ${cm.ref} WHERE ${cm.b} AND ${W(cm)} HAVING n >= 20 AND pct > 5`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Integrity: ledger silence — age of the newest row per ledger (PK lookup, instant) */
  J5: { grace: 0, run: async c => {
    const out = [];
    for (const [table, maxMin] of [['cms_logs', 10], ['uil_logs', 10], ['semati_logs', 30], ['user_onboarding_logs', 10]]) {
      try {
        const shift = await tzShift(AUD, table, 'insert_date_time');
        const r = await dms.q(`SELECT id, insert_date_time a FROM ${q(AUD, table)} ORDER BY id DESC LIMIT 1`);
        const a = r[0] && r[0].a != null ? new Date(r[0].a).getTime() - shift : null;
        const ageMin = a == null ? null : Math.round((Date.now() - a) / MIN);
        if (ageMin == null || ageMin > maxMin) out.push({ table, newest_id: r[0] && r[0].id, newest_at: a == null ? null : new Date(a), age_min: ageMin, threshold_min: maxMin });
      } catch (e) { out.push({ table, error: e.message.slice(0, 120) }); }
    }
    return { rows: out, note: 'KSA business hours matter: a quiet night is not an outage — compare with gateway traffic (api_logger) before escalating' };
  } },
  /* Integrity: re-used ICCID attempts */
  J7: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['response_Code', 'response_Message', 'cardPackageId_req']);
    const rows = await dms.qSlow(`SELECT cm.cardPackageId_req iccid, COUNT(*) attempts, MAX(${U(cm)}) last_at, SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT cm.username), ',', 3) dealers
      FROM ${cm.ref} WHERE ${cm.b} AND cm.response_Code='1532' AND cm.response_Message LIKE 'The Requested ICCID%' AND ${W(cm)} GROUP BY cm.cardPackageId_req HAVING attempts > 1 ORDER BY attempts DESC LIMIT ${LIMIT}`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Integrity: Absher verifications never consumed */
  J8: { grace: 60 * MIN, run: async c => {
    await c.have(V1, 'person_verification_log', ['transaction_id', 'request_status', 'activation_status']);
    const at = await dms.pick(V1, 'person_verification_log', ['create_datetime', 'created_at', 'created_on', 'insert_date_time']);
    if (!at) throw Object.assign(new Error('person_verification_log: no timestamp column'), { skip: true });
    const p = await c.T(V1, 'person_verification_log', 'p', at, []);
    const rows = await dms.qSlow(`SELECT p.transaction_id, ${U(p)} at, p.request_status, p.activation_status FROM ${p.ref}
      WHERE ${p.b} AND ${W(p)} AND ((p.request_status='PENDING') OR (p.request_status='COMPLETED' AND (p.activation_status=0 OR p.activation_status IS NULL))) ORDER BY p.id DESC LIMIT ${LIMIT}`, [p.lo, p.hi], c.budget);
    return { rows };
  } },
  /* Integrity: terminations without the expected pre-steps */
  J10: { grace: 5 * MIN, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code', 'msisdn_req']);
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.msisdn, x.dealer, x.logs_reference_id, MAX(b.m IS NOT NULL) had_balance_step, MAX(o.m IS NOT NULL) had_otp_step
      FROM (SELECT cm.id, ${U(cm)} at, ${digits9('cm.msisdn_req')} m, cm.msisdn_req msisdn, cm.username dealer, cm.logs_reference_id
            FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%/linedeactivation/line-deactivation' AND cm.response_Code='00' AND ${W(cm)}) x
      LEFT JOIN (SELECT ${digits9('cm.msisdn_req')} m, ${U(cm)} at FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%/linedeactivation/get-balance') b ON b.m = x.m AND b.at BETWEEN x.at - INTERVAL 30 MINUTE AND x.at
      LEFT JOIN (SELECT ${digits9('cm.msisdn_req')} m, ${U(cm)} at FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%verifyotp' AND cm.response_Code='00') o ON o.m = x.m AND o.at BETWEEN x.at - INTERVAL 30 MINUTE AND x.at
      GROUP BY x.id HAVING had_balance_step = 0 OR had_otp_step = 0 ORDER BY x.id DESC LIMIT ${LIMIT}`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Integrity: static OTP in production */
  J12: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['otp_req', 'username']);
    const rows = await dms.qSlow(`SELECT SUM(cm.otp_req='7777') static_otps, COUNT(*) total_otps,
        SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT CASE WHEN cm.otp_req='7777' THEN cm.username END), ',', 5) dealers, MAX(${U(cm)}) last_at
      FROM ${cm.ref} WHERE ${cm.b} AND ${W(cm)} AND cm.otp_req IS NOT NULL AND cm.otp_req <> ''
      HAVING static_otps >= 3 AND static_otps > total_otps / 500`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Integrity: OTP brute force */
  J13: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code', 'msisdn_req']);
    const rows = await dms.qSlow(`SELECT cm.msisdn_req msisdn, cm.username dealer, COUNT(*) bad_attempts, MAX(${U(cm)}) last_at FROM ${cm.ref}
      WHERE ${cm.b} AND cm.api_name LIKE '%verifyotp' AND cm.response_Code IN ('1525','1521') AND ${W(cm)} GROUP BY cm.msisdn_req, cm.username HAVING bad_attempts >= 3 ORDER BY bad_attempts DESC LIMIT ${LIMIT}`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Integrity: downstream timeouts per UIL operation */
  J14: { grace: 0, run: async c => {
    const u = await c.T(AUD, 'uil_logs', 'u', 'insert_date_time', ['api_name', 'response_Code', 'response_Message']);
    const rows = await dms.qSlow(`SELECT u.api_name, u.response_Code, COUNT(*) n, MAX(${U(u)}) last_at, SUBSTRING_INDEX(MAX(u.response_Message), 'nested', 1) sample_message FROM ${u.ref}
      WHERE ${u.b} AND ${W(u)} AND (u.response_Code='5002' OR (u.response_Code='1500' AND (u.response_Message LIKE '%Timeout%' OR u.response_Message LIKE '%Transport%' OR u.response_Message LIKE '%Connection%')))
      GROUP BY u.api_name, u.response_Code HAVING n >= 3 ORDER BY n DESC LIMIT ${LIMIT}`, [u.lo, u.hi], c.budget);
    return { rows };
  } },
  /* Diagnostic: DOES THE TRACE ID ACTUALLY JOIN? Half the rules below assume that one dealer request
   * carries one Sleuth trace id through customer-service -> UIL -> the ledgers. The first live run made
   * that doubtful (J1/J3 matched almost everything). This measures it instead of assuming it. */
  X1: { grace: 5 * MIN, run: async c => {
    const u = await c.T(AUD, 'uil_logs', 'u', 'insert_date_time', ['api_name', 'logs_reference_id']);
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['logs_reference_id']);
    const s = await c.T(AUD, 'semati_logs', 's', 'insert_date_time', ['logs_reference_id']);
    const rows = await dms.qSlow(`SELECT COUNT(*) uil_rows,
        SUM(x.ref IS NOT NULL AND x.ref <> '') with_ref,
        COUNT(DISTINCT CASE WHEN cmx.ref IS NOT NULL THEN x.ref END) refs_matching_cms,
        COUNT(DISTINCT CASE WHEN sx.ref IS NOT NULL THEN x.ref END) refs_matching_semati,
        COUNT(DISTINCT x.ref) distinct_refs
      FROM (SELECT u.logs_reference_id ref FROM ${u.ref} WHERE ${u.b} AND ${W(u)}) x
      LEFT JOIN (SELECT DISTINCT cm.logs_reference_id ref FROM ${cm.ref} WHERE ${cm.b} AND ${W(cm)}) cmx ON cmx.ref = x.ref AND x.ref <> ''
      LEFT JOIN (SELECT DISTINCT s.logs_reference_id ref FROM ${s.ref} WHERE ${s.b} AND ${W(s)}) sx ON sx.ref = x.ref AND x.ref <> ''`,
      [u.lo, u.hi, cm.lo, cm.hi, s.lo, s.hi], c.budget);
    const r = rows[0] || {};
    const pct = Number(r.distinct_refs) ? Math.round(100 * Number(r.refs_matching_cms) / Number(r.distinct_refs)) : 0;
    return { rows, note: `${pct}% of UIL trace ids also appear in cms_logs — below ~70% the trace-join rules (J1,J2,J3,S5,S7,M4,M5) are unreliable and must fall back to msisdn+time` };
  } },

  /* Money: top-up success without a PAID wallet row */
  M1: { grace: 5 * MIN, run: async c => {
    const t = await c.T(AUD, 'topup_logs', 't', 'insert_date_time', ['channel_user_id', 'amount', 'response_Code']);
    const w = await c.T(WAL, 'wallet_payment_initiate', 'w', 'created_on', ['account_from', 'amount', 'status', 'comments']);
    await c.have(V1, 'dms_users', ['id', 'account_number']);
    const tsel = await c.sel(AUD, 'topup_logs', 't', [['mobile_number', 'msisdn'], 'amount', 'payment_mode', 'channel_user_id', 'logs_reference_id']);
    const rech = (await c.col(AUD, 'topup_logs', 'recharge')) ? `AND IFNULL(t.recharge,'Y')='Y'` : '';
    const pm = (await c.col(AUD, 'topup_logs', 'payment_mode')) ? `AND IFNULL(t.payment_mode,'') <> 'TPP'` : '';
    const rows = await dms.qSlow(`SELECT t.id, ${U(t)} at, ${tsel}, u.username dealer, u.account_number
      FROM ${t.ref} LEFT JOIN ${q(V1, 'dms_users')} u ON u.id = t.channel_user_id
      WHERE ${t.b} AND t.response_Code='00' ${rech} ${pm} AND ${W(t)}
      AND NOT EXISTS (SELECT 1 FROM ${w.ref} WHERE ${w.b} AND w.account_from = u.account_number AND w.status='PAID' AND w.comments IN ('Topup','Top up','TopUp')
        AND ${U(w)} BETWEEN ${U(t)} - INTERVAL 3 MINUTE AND ${U(t)} + INTERVAL 3 MINUTE)
      ORDER BY t.id DESC LIMIT ${LIMIT}`, [t.lo, t.hi], c.budget);
    return { rows, note: 'VoucherServiceImpl.topup() overwrites a wallet failure with 00 — verify the wallet comment literal on first hits' };
  } },
  /* Money: journey success rows with no payment id (activation / swap / MNP) — plan exemption excluded when visible */
  M2: { grace: 5 * MIN, run: async c => {
    const out = [];
    const ex = await dms.hasTable(V1, 'plan_price_exempted');
    for (const table of ['sim_activation_logs', 'mnp_logs', 'sim_swap_logs', 'data_sim_swap_logs']) {
      const j = await c.T(AUD, table, 'j', 'insert_date_time', ['payment_id', 'response_Code']).catch(() => null); if (!j) continue;
      const pm = await c.col(AUD, table, 'payment_mode');
      const jsel = await c.sel(AUD, table, 'j', ['api_name', ['mobile_number', 'msisdn'], ['channel_username', 'dealer'], ['price_plan_id', 'plan'], 'payment_id', 'payment_mode', 'logs_reference_id']);
      const exOk = ex && (await c.col(AUD, table, 'channel_username')) && (await c.col(AUD, table, 'price_plan_id'));
      const rows = await dms.qSlow(`SELECT j.id, ${U(j)} at, '${table}' ledger, ${jsel}
        FROM ${j.ref} WHERE ${j.b} AND j.response_Code='00' AND (j.payment_id IS NULL OR j.payment_id='' OR j.payment_id='0') AND ${W(j)}
        ${pm ? `AND IFNULL(j.payment_mode,'') <> 'TPP'` : ''}
        ${exOk ? `AND NOT EXISTS (SELECT 1 FROM ${q(V1, 'plan_price_exempted')} e WHERE e.channel_username = j.channel_username AND e.price_plan_id = j.price_plan_id)` : ''}
        ORDER BY j.id DESC LIMIT 40`, [j.lo, j.hi], c.budget).catch(e => { c.notes.push(`${table}: ${e.message.slice(0, 100)}`); return []; });
      out.push(...rows);
    }
    return { rows: out.slice(0, LIMIT), note: 'success reported although the wallet step returned nothing — the code sets 00 unconditionally after the debit' };
  } },
  /* Money: Renew now debited with no renewal success for the dealer within 5 min */
  M3: { grace: 5 * MIN, run: async c => {
    const w = await c.T(WAL, 'wallet_payment_initiate', 'w', 'created_on', ['account_from', 'status', 'comments']);
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code', 'username']);
    await c.have(V1, 'dms_users', ['username', 'account_number']);
    /* both sides are materialised ONCE (the first run timed out at 25 s re-scanning cms_logs per
     * wallet row); the renewal side is tiny because it is filtered to the one URI. */
    const rows = await dms.qSlow(`SELECT x.id, x.at, x.account_from, x.dealer, x.amount, x.comments
      FROM (SELECT w.id, ${U(w)} at, w.account_from, w.amount, w.comments, u.username dealer
            FROM ${w.ref} LEFT JOIN ${q(V1, 'dms_users')} u ON u.account_number = w.account_from
            WHERE ${w.b} AND w.status='PAID' AND w.comments LIKE 'Renew%' AND ${W(w)}) x
      LEFT JOIN (SELECT cm.username dealer, ${U(cm)} at FROM ${cm.ref}
                 WHERE ${cm.b} AND cm.api_name LIKE '%/priceplan/renew' AND cm.response_Code='00') r
        ON r.dealer = x.dealer AND r.at BETWEEN x.at - INTERVAL 1 MINUTE AND x.at + INTERVAL 5 MINUTE
      WHERE r.dealer IS NULL GROUP BY x.id ORDER BY x.id DESC LIMIT ${LIMIT}`, [w.lo, w.hi, cm.lo, cm.hi], c.budget);
    return { rows, note: 'no refund path exists in the service — each hit is a manual reconciliation' };
  } },
  /* Money: stuck wallet initiates */
  M6: { grace: 0, run: async c => {
    const w = await c.T(WAL, 'wallet_payment_initiate', 'w', 'created_on', ['status', 'transaction_type', 'signature_expiry']);
    const nowLocal = new Date(Date.now() + w.shiftH * H), nowUtc = new Date();
    const rows = await dms.qSlow(`SELECT w.id, ${U(w)} at, w.transaction_type, w.source_system, w.status, w.amount, w.account_from, w.account_to, w.comments, w.signature_expiry
      FROM ${w.ref} WHERE ${w.b} AND ${W(w)} AND (w.status='CONSUMED'
        OR (w.status='PENDING' AND ((w.signature_expiry < ? - INTERVAL 40 MINUTE) OR (w.transaction_type IN ('CC','REFUND') AND ${U(w)} < ? - INTERVAL 10 MINUTE) OR (w.transaction_type='WALLET_TRANSFER' AND ${U(w)} < ? - INTERVAL 60 MINUTE))))
      ORDER BY w.id DESC LIMIT ${LIMIT}`, [w.lo, w.hi, nowLocal, nowUtc, nowUtc], c.budget);
    return { rows };
  } },
  /* Money: e-voucher issued (voucher number in the response) but the call did not end 00 */
  M9: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'response_Code']);
    if (!(await c.col(AUD, 'cms_logs', 'voucherNo_resp'))) throw Object.assign(new Error('cms_logs lacks voucherNo_resp'), { skip: true });
    const rows = await dms.qSlow(`SELECT cm.id, ${U(cm)} at, cm.msisdn_req msisdn, cm.username dealer, cm.response_Code, cm.response_Message, cm.logs_reference_id
      FROM ${cm.ref} WHERE ${cm.b} AND cm.api_name LIKE '%/recharge/evoucher' AND cm.response_Code <> '00' AND cm.voucherNo_resp IS NOT NULL AND cm.voucherNo_resp <> '' AND ${W(cm)} ORDER BY cm.id DESC LIMIT ${LIMIT}`, [cm.lo, cm.hi], c.budget);
    return { rows };
  } },
  /* Money: bill payment PAID in the wallet without a payment_history row */
  M10: { grace: 5 * MIN, run: async c => {
    const w = await c.T(WAL, 'wallet_payment_initiate', 'w', 'created_on', ['status', 'comments', 'account_from']);
    await c.have(V1, 'payment_history', ['payment_id']);
    const rows = await dms.qSlow(`SELECT w.id, ${U(w)} at, w.account_from, w.amount, w.comments FROM ${w.ref}
      WHERE ${w.b} AND w.status='PAID' AND w.comments LIKE 'Bill Payment%' AND ${W(w)}
      AND NOT EXISTS (SELECT 1 FROM ${q(V1, 'payment_history')} p WHERE p.payment_id = w.id OR p.payment_id = CAST(w.id AS CHAR)) ORDER BY w.id DESC LIMIT ${LIMIT}`, [w.lo, w.hi], c.budget);
    return { rows, note: 'payment_history.payment_id semantics assumed = wallet initiate id — verify on first hits' };
  } },
  /* Money: duplicate money movements (same dealer, same msisdn, same URI within 10 min) */
  M12: { grace: 0, run: async c => {
    const cm = await c.T(AUD, 'cms_logs', 'cm', 'insert_date_time', ['api_name', 'msisdn_req', 'username']);
    const rows = await dms.qSlow(`SELECT cm.api_name, cm.msisdn_req msisdn, cm.username dealer, COUNT(*) calls, SUM(cm.response_Code='00') ok, MIN(${U(cm)}) first_at, MAX(${U(cm)}) last_at
      FROM ${cm.ref} WHERE ${cm.b} AND ${W(cm)} AND cm.msisdn_req <> '' AND cm.api_name IN ('/cus/recharge/topup','/cus/recharge/evoucher','/cus/bill/payment','/cus/priceplan/renew','/cus/addon/purchase','/cus/mnp/transportoperator','/cus/simactivation/activate','/cus/wallet/wallettransfer')
      GROUP BY cm.api_name, cm.msisdn_req, cm.username HAVING calls > 1 AND ok > 1 AND TIMESTAMPDIFF(MINUTE, first_at, last_at) <= 10 ORDER BY ok DESC LIMIT ${LIMIT}`, [cm.lo, cm.hi], c.budget);
    return { rows, note: 'more than one 00 for the same dealer/msisdn/URI within 10 min — no idempotency key exists in the code' };
  } },
  /* Access: Nafath records stuck INITIATED */
  L5: { grace: 10 * MIN, run: async c => {
    await c.have(V1, 'nafath_record', ['status']);
    const at = await dms.pick(V1, 'nafath_record', ['created_at', 'created_on', 'create_datetime', 'insert_date_time', 'updated_at']);
    if (!at) throw Object.assign(new Error('nafath_record: no timestamp column'), { skip: true });
    const n = await c.T(V1, 'nafath_record', 'n', at, []);
    const rows = await dms.qSlow(`SELECT n.id, ${U(n)} at, n.status FROM ${n.ref} WHERE ${n.b} AND ${W(n)} AND n.status='INITIATED' ORDER BY n.id DESC LIMIT ${LIMIT}`, [n.lo, n.hi], c.budget);
    return { rows };
  } },
  /* Access: login failure bursts */
  L1: { grace: 0, run: async c => {
    const o = await c.T(AUD, 'user_onboarding_logs', 'o', 'insert_date_time', ['api_name', 'response_Code', 'username_req']);
    const rows = await dms.qSlow(`SELECT o.username_req dealer, COUNT(*) failures, SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT o.response_Code), ',', 4) codes, MAX(${U(o)}) last_at
      FROM ${o.ref} WHERE ${o.b} AND o.api_name = '/onboarding/user/login' AND o.response_Code <> '00' AND ${W(o)} GROUP BY o.username_req HAVING failures >= 5 ORDER BY failures DESC LIMIT ${LIMIT}`, [o.lo, o.hi], c.budget);
    return { rows, note: 'failed logins also evict the dealer\'s live sessions (pruning runs before the password check)' };
  } },
  /* Access: not-active spike */
  L3: { grace: 0, run: async c => {
    const o = await c.T(AUD, 'user_onboarding_logs', 'o', 'insert_date_time', ['api_name', 'response_Code']);
    const rows = await dms.qSlow(`SELECT COUNT(*) n, COUNT(DISTINCT o.username_req) dealers FROM ${o.ref} WHERE ${o.b} AND o.api_name='/onboarding/user/login' AND o.response_Code='1502' AND ${W(o)} HAVING dealers >= 5`, [o.lo, o.hi], c.budget);
    return { rows };
  } }
};
/* window end grace: give in-flight journeys time to complete before calling them abnormal */

/* ---- MASKING AT INGEST — identifiers never enter the console DB.
 * The first live run (17 Sep 2026) leaked `person_id` (a national id) in clear: the old pass-through
 * pattern allowed anything ending in `_id`, which is true of both a Sleuth trace id and a national id.
 * The policy is explicit now: a short allow-list of TECHNICAL keys stays readable because tracing is
 * impossible without it; a deny-list is dropped outright; everything else has its digit runs masked. */
const CLEAR = new Set([                                    // technical, never personal
  'id', 'src_id', 'newest_id', 'payment_initiate_id', 'logs_reference_id', 'uil_transaction_id', 'tcn',
  'rule', 'table', 'ledger', 'missing_in', 'api_name', 'swap_call', 'outcome', 'info', 'note', 'error',
  'dealer', 'username', 'employee_username', 'channel_code', 'dealer_type', 'request_type', 'plan',
  'response_code', 'uil_code', 'adj_code', 'codes', 'status', 'user_status', 'wallet_status',
  'transaction_type', 'source_system', 'comments', 'payment_mode', 'payment_id', 'capped', 'skipped']);
const DROP = new Set(['otp', 'otp_req', 'otp_mob', 'sim_list', 'request', 'response', 'token',
  'api_key', 'iam_token', 'manafith_app_token', 'signature', 'password']);
const NUMERIC_OK = /^(n|calls|ok|attempts|failures|cancels|registrations|dealers|unattributed|rejected|over_60s|pct|bad_attempts|rows|amount|avg_ms|max_ms|ms|age_min|threshold_min|slowest_ms|total_ms|uil_rows|with_ref|distinct_refs|semati_type1|activations|had_[a-z_]+|refs_[a-z_]+|[a-z_]*count[a-z_]*|[a-z_]*_rows|[a-z_]*_n)$/;
function maskRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    const kl = k.toLowerCase();
    if (DROP.has(kl)) continue;
    if (v == null || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) { o[k] = v; continue; }
    /* mysql2 returns SUM()/DECIMAL as a STRING: without this an aggregate like 8123410 was masked
     * into "81**10" (seen on X1's with_ref in the first run). Numbers are not identifiers. */
    if (NUMERIC_OK.test(kl) && /^-?\d+(\.\d+)?$/.test(String(v))) { o[k] = Number(v); continue; }
    if (CLEAR.has(kl) || NUMERIC_OK.test(kl) || /(^|_)at$/.test(kl)) { o[k] = String(v).slice(0, 200); continue; }
    o[k] = String(v).replace(/\d{4,}/g, m => m.slice(0, 2) + '*'.repeat(Math.min(6, Math.max(2, m.length - 4))) + m.slice(-2)).slice(0, 120);
  }
  return o;
}

/* ---- persistence ---- */
let _ensured = false;
async function ensure() {
  if (_ensured) return; _ensured = true;
  await db.console.query(`CREATE TABLE IF NOT EXISTS dms_flow_findings (
    id bigserial PRIMARY KEY, rule text NOT NULL, at timestamptz NOT NULL DEFAULT now(), win_from timestamptz, win_to timestamptz,
    n integer NOT NULL DEFAULT 0, capped boolean NOT NULL DEFAULT false, sample jsonb, note text, ms integer, error text, skipped boolean NOT NULL DEFAULT false)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS dms_flow_findings_rule_at ON dms_flow_findings(rule, at DESC)`);
}

let _running = false, _last = null;
async function runRules(ids, opts = {}) {
  const cfg = CFG(); await ensure();
  if (_running) return { ok: false, error: 'a run is already in progress' };
  _running = true;
  const t0 = Date.now(); const results = [];
  try {
    const now = new Date(); const windowMs = (Number(opts.hours) || cfg.windowH) * H;
    for (const id of ids) {
      const R = RULES[id]; if (!R) { results.push({ rule: id, error: 'unknown rule' }); continue; }
      const to = new Date(now.getTime() - (R.grace || 0)), from = new Date(to.getTime() - windowMs);
      const ctx = await makeCtx(from, to); ctx.budget = cfg.budgetMs;
      const r0 = Date.now(); let rec;
      try {
        const out = await R.run(ctx);
        const rows = (out.rows || []).map(maskRow);
        rec = { rule: id, at: now, win_from: from, win_to: to, n: rows.length, capped: rows.length >= LIMIT, sample: rows.slice(0, 40), note: [out.note, ...ctx.notes].filter(Boolean).join(' · ') || null, ms: Date.now() - r0, error: null, skipped: false };
      } catch (e) {
        rec = { rule: id, at: now, win_from: from, win_to: to, n: 0, capped: false, sample: null, note: null, ms: Date.now() - r0, error: String(e.message || e).slice(0, 300), skipped: !!e.skip };
      }
      await db.console.query(`INSERT INTO dms_flow_findings(rule,at,win_from,win_to,n,capped,sample,note,ms,error,skipped) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rec.rule, rec.at, rec.win_from, rec.win_to, rec.n, rec.capped, rec.sample ? JSON.stringify(rec.sample) : null, rec.note, rec.ms, rec.error, rec.skipped]);
      results.push(rec);
    }
    await alertsFromResults(results, now).catch(e => console.error('dms flow alerts:', e.message));
    await db.console.query(`DELETE FROM dms_flow_findings WHERE at < now() - ($1 || ' days')::interval`, [String(cfg.retentionDays)]).catch(() => {});
    _last = { at: now, ms: Date.now() - t0, rules: results.length, hits: results.filter(r => r.n > 0).length, errors: results.filter(r => r.error && !r.skipped).length };
    return { ok: true, results, ms: Date.now() - t0 };
  } finally { _running = false; }
}

/* ---- alerts: money/regulator rules (P2/P3) open one alert per rule while hits persist ---- */
async function alertsFromResults(results, now) {
  for (const r of results) {
    const meta = RULE_META[r.rule];
    /* alert === false = the rule runs and is visible in Explore, but does not raise an alert until its
     * cross-table join has been validated against live data (see DMS-JOURNEYS-CODE.md §6). */
    if (!meta || meta.alert === false || !['P2', 'P3'].includes(meta.sev)) continue;
    const key = `dms:flow:${r.rule}`;
    const cur = (await db.console.query(`SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
    if (r.error || r.n === 0) { if (cur && !r.error) await db.console.query(`UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [cur.id, now]); continue; }
    const first = r.sample && r.sample[0] ? Object.entries(r.sample[0]).filter(([k]) => ['dealer', 'msisdn', 'api_name', 'ledger', 'request_type', 'table', 'age_min'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ') : '';
    const msg = `${meta.title}: ${r.n}${r.capped ? '+' : ''} case(s) in the last ${Math.round((r.win_to - r.win_from) / H)}h (window ends ${new Date(r.win_to).toISOString().slice(11, 16)} UTC).`
      + (first ? ` First: ${first}.` : '') + (r.note ? ` ${r.note}.` : '') + ` See DMS ▸ Explore ▸ rule ${r.rule} (DMS-JOURNEYS-CODE.md §6).`;
    if (cur) await db.console.query(`UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1, peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, r.n, msg]);
    else await db.console.query(
      `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
       VALUES ($1,$2,$3,'Digital Ops','open',$4,'>',0,$5::numeric,$6::numeric,$7::int,$8,$9,$10,$10,$11::numeric,1)`,
      [key, `DMS flow ${r.rule} · ${meta.title}`, meta.sev, `dms.flow.${r.rule}`, r.n, r.n,
        Math.round((r.win_to - r.win_from) / H),
        JSON.stringify({ rule: r.rule, family: meta.family, source: 'dms_flow_findings' }), msg, now, r.n]);
  }
}

/* ---- read side ---- */
async function latest() {
  await ensure();
  const rows = (await db.console.query(`SELECT DISTINCT ON (rule) rule, at, win_from, win_to, n, capped, note, ms, error, skipped FROM dms_flow_findings ORDER BY rule, at DESC`)).rows;
  const by = new Map(rows.map(r => [r.rule, r]));
  return Object.entries(RULE_META).map(([id, meta]) => ({ id, ...meta, implemented: !!RULES[id], last: by.get(id) || null }));
}
async function history(rule, limit = 50) {
  await ensure();
  return (await db.console.query(`SELECT id, at, win_from, win_to, n, capped, note, ms, error, skipped, sample FROM dms_flow_findings WHERE rule=$1 ORDER BY at DESC LIMIT $2`, [rule, Math.min(200, Number(limit) || 50)])).rows;
}
function status() { const c = CFG(); return { enabled: c.enabled && dms.configured(), intervalSec: c.intervalSec, windowH: c.windowH, budgetMs: c.budgetMs, implemented: Object.keys(RULES), running: _running, last: _last }; }

/* ---- scheduler ---- */
let _timer = null;
function start() {
  const c = CFG(); if (!c.enabled || !dms.configured()) return;
  const tick = () => runRules(Object.keys(RULES)).catch(e => console.error('dms flow rules:', e.message));
  setTimeout(tick, 90e3);
  _timer = setInterval(tick, c.intervalSec * 1000); if (_timer.unref) _timer.unref();
}

module.exports = { start, status, runRules, latest, history, RULES: Object.keys(RULES) };
