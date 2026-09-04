/* DMS JOURNEYS — the dealer journey, end to end, from DMS's OWN audit trail.
 *
 * DISCOVERY (31 Aug 2026, dms-business-discover on Clara via MaxScale 172.31.43.75):
 * schema dms_audit_logs = 31 tables, one per journey step, written by the DMS microservices
 * through dms_audit_logs_producer/consumer (seen on mvno-appdigp01:/opt/application). So the
 * "parse the backend log files" problem is already solved upstream by DMS itself — we read the
 * SINK, read-only, with the credential the console already holds. No new access, no file parsing.
 *
 * INGESTION: id-watermark pull (prod-sync pattern). NEVER a time scan: user_onboarding_logs is
 * ~365M rows and even min()/max() on its datetime column times out (measured). id is the PK —
 * always indexed — so `WHERE id > ? ORDER BY id LIMIT n` is cheap on any size. First run anchors
 * the watermark near the tip (max_id − BACKFILL) instead of replaying years of history.
 * Aggregates land in console-Postgres dms_journey_stats (hourly, permanent, tiny); failing rows
 * land in dms_journey_events, PII MASKED AT INGEST — full identifiers never enter the console DB.
 *
 * ERROR DEFINITION (conservative, refine with DMS L2): a response code that looks like an HTTP
 * 4xx/5xx, or starts with E/ERR, or equals FAIL/FAILURE/FAILED. Everything else counts as a call
 * with its code kept in the per-bucket code mix, so business codes (e.g. Semati 715) stay visible
 * without being mislabeled technical. Codes are DATA here, not verdicts.
 *
 * Env: DMS_JOURNEY_SYNC=0 disables · DMS_JOURNEY_INTERVAL_SEC (300) · DMS_JOURNEY_BATCH (20000)
 *      DMS_JOURNEY_MAX_BATCHES (5/journey/cycle) · DMS_JOURNEY_BACKFILL (150000 rows/journey)
 *      DMS_JOURNEY_EVENTS_CAP (60 failing rows kept per journey per cycle)
 *      DMS_JOURNEY_RETENTION_DAYS (events only; stats are permanent) — default 45
 */
'use strict';
const db = require('./db');
const dms = require('./dmsDb');

const SCHEMA = process.env.DMS_AUDIT_SCHEMA || 'dms_audit_logs';

/* ---- registry: one entry per journey step. Column CANDIDATES come from the discovery dump;
 * resolution happens at runtime against information_schema (house rule — we don't own this
 * schema). A journey whose table/columns vanish degrades to a note in its state row. ---- */
const JOURNEYS = {
  activation:   { label: 'SIM activation',      icon: '▶', table: 'sim_activation_logs',
                  note: 'the dealer sale itself — one row per activation attempt' },
  mnp:          { label: 'Port-in (MNP)',       icon: '⇄', table: 'mnp_logs',
                  note: 'port-in requests raised by dealers, with donor operator' },
  sim_swap:     { label: 'SIM swap',            icon: '↺', table: 'sim_swap_logs' },
  data_swap:    { label: 'Data-SIM swap',       icon: '⇋', table: 'data_sim_swap_logs' },
  ownership:    { label: 'Transfer ownership',  icon: '⇆', table: 'transfer_ownership_logs' },
  topup:        { label: 'Top-up / voucher',    icon: '＋', table: 'topup_logs' },
  wallet_refill:{ label: 'Wallet refill',       icon: '◈', table: 'wallet_refill_logs',
                  note: 'dealer wallet credit — HyperPay / SADAD' },
  wallet_move:  { label: 'Wallet transfer',     icon: '⇉', table: 'wallet_money_transfer_logs',
                  note: 'dealer-to-dealer wallet moves' },
  plan_renew:   { label: 'Plan renewal',        icon: '⟳', table: 'renew_priceplan_logs' },
  plan_change:  { label: 'Billing change',      icon: '≒', table: 'price_plan_logs' },
  reauth:       { label: 'SIM re-auth',         icon: '✓', table: 'sim_reauthentication_logs' },
  device_sale:  { label: 'Device sale',         icon: '▣', table: 'device_sales_logs' },
  dealer_sms:   { label: 'Dealer SMS',          icon: '✉', table: 'dealer_sms_log' },
  nafath:       { label: 'Nafath checks',       icon: '🪪', table: 'nafath_logs',
                  note: 'identity approvals — terminal statuses are business outcomes' },
  semati:       { label: 'Semati checks',       icon: '🛡', table: 'semati_logs' },
  cms:          { label: 'Dealer admin (CMS)',  icon: '⚙', table: 'cms_logs',
                  note: 'dealer management actions: create, packages, balance' },
  self_activation:{ label: 'Self-activation (portal)', icon: '◉', schema: 'dms_v1',
                  table: 'report_request_self_activation',
                  note: 'hybrid portal + MNP — customer self-serve under a dealer' }
};
/* journeys may live outside dms_audit_logs — resolve schema per journey */
const SC = k => JOURNEYS[k].schema || SCHEMA;

/* logical → candidate physical columns (from the discovery dump; extend as schemas move) */
const F = {
  at:      ['insert_date_time', 'created_at', 'created_date', 'date_time', 'creation_time', 'insert_datetime'],
  dealer:  ['channel_username', 'dealer_username', 'dealer_code', 'dealer_id', 'channel_user', 'user_name', 'created_by', 'agent_mobile'],
  dealer2: ['channel_user_id', 'channel_id'],           // numeric fallback when no username col
  msisdn:  ['msisdn', 'mobile_number', 'default_number', 'purchased_number', 'customer_mobile', 'dealer_contact_number'],
  customer:['customer_id_number', 'person_id', 'id_number', 'customer_personal_id', 'previous_customer_id_number', 'customer_id'],
  code:    ['response_code', 'response_Code', 'order_status', 'status', 'sms_delivery_status', 'job_status'],
  message: ['response_message', 'response_Message', 'description', 'reason'],
  ref:     ['logs_reference_id', 'uil_transaction_id', 'wallet_transaction_id', 'trans_id', 'dms_reference_id', 'transaction_id', 'sms_id'],
  api:     ['api_name', 'request_type', 'job_name', 'service'],
  plan:    ['price_plan_name', 'plan_name', 'price_plan', 'package_name'],
  plan_id: ['price_plan_id', 'plan_id', 'package_id']
};

/* GRANDFATHER WATCH — Flex scheme update 31 Aug 2026 (Khalid/Haroon/Waleed thread): plans
 * 100238/100239 (Super Flex 85/110 Plus) were blocked for NEW activations at customer-ID level
 * at ~15:49 KSA. Renewals stay legitimate; a NEW ACTIVATION on them is a config leak (wrong
 * commission paid, blocked plan still sellable somewhere). Checked on the rows the activation
 * sync already pulls — no extra queries. Extend DMS_GRANDFATHERED_PLANS when CST approves the
 * 200/300 switch (then add 100262,100263). */
const GF = () => ({
  enabled: process.env.DMS_GRANDFATHER_WATCH !== '0',
  ids: String(process.env.DMS_GRANDFATHERED_PLANS || '100238,100239').split(',').map(s => s.trim()).filter(Boolean),
  names: String(process.env.DMS_GRANDFATHERED_NAMES || 'Super Flex 85 Plus,Super Flex 110 Plus')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  cutover: new Date(process.env.DMS_GRANDFATHER_CUTOVER || '2026-08-31T12:49:00Z'),  // 15:49 KSA
  severity: process.env.DMS_GRANDFATHER_SEV || 'P3'
});
async function raiseGrandfather(hits) {
  if (!hits.length) return;
  const now = new Date().toISOString();
  const plans = [...new Set(hits.map(h => h.plan))].join(', ');
  const dealers = [...new Set(hits.map(h => h.dealer).filter(Boolean))].slice(0, 5).join(', ');
  const msg = `${hits.length} NEW activation(s) on grandfathered Flex plan(s) [${plans}] AFTER the 31 Aug 15:49 KSA block`
    + (dealers ? ` — dealers: ${dealers}` : '') + `. Old Plus plans must be renew-only; the customer-ID restriction is leaking. Latest: ${hits[hits.length - 1].at}`;
  const key = 'dms:grandfather-leak';
  const cur = (await db.console.query(`SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=observed_value+$3, message=$4, breach_count=breach_count+1 WHERE id=$1`,
    [cur.id, now, hits.length, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,'Grandfathered Flex plan still activating',$2,'Digital Ops','open','dms.grandfather.leak','>',0,$3,$3,1,$4,$5,$6,$6,$3,1)`,
    [key, GF().severity, hits.length, JSON.stringify({ plans: plans.slice(0, 200), source: 'journey sync: activation + self_activation ledgers' }), msg, now]);
}

const CFG = () => ({
  enabled: process.env.DMS_JOURNEY_SYNC !== '0',
  intervalSec: Math.max(60, Number(process.env.DMS_JOURNEY_INTERVAL_SEC) || 300),
  batch: Math.min(50000, Math.max(1000, Number(process.env.DMS_JOURNEY_BATCH) || 20000)),
  maxBatches: Math.max(1, Number(process.env.DMS_JOURNEY_MAX_BATCHES) || 5),
  backfill: Math.max(0, Number(process.env.DMS_JOURNEY_BACKFILL) || 150000),
  eventsCap: Math.max(10, Number(process.env.DMS_JOURNEY_EVENTS_CAP) || 60),
  retentionDays: Math.max(7, Number(process.env.DMS_JOURNEY_RETENTION_DAYS) || 45)
});

/* ---- masking at ingest: identifiers never reach the console DB in full ---- */
const maskNum = v => v == null ? null :
  String(v).replace(/\d{5,}/g, m => m.slice(0, 2) + '*'.repeat(Math.min(6, m.length - 4)) + m.slice(-2)).slice(0, 40);
const isErr = code => {
  if (code == null || code === '') return false;
  const c = String(code).trim().toUpperCase();
  if (/^[45]\d\d$/.test(c)) return true;                       // HTTP-style 4xx/5xx
  if (/^(E|ERR)[-_ ]?\w*/.test(c) && !/^ERROR?_?0*$/.test(c)) return true;
  return c === 'FAIL' || c === 'FAILURE' || c === 'FAILED' || c === 'EXCEPTION';
};
/* LESSON FROM THE 31 AUG RECHARGE INCIDENT (Redknee SOAP fault 21, "Errors communicating
 * between CRM and external applications", ~45 customers): BSS faults come back as BARE NUMERIC
 * codes ('21'), which the conservative isErr() waves through — the outage was invisible to the
 * red counters. Success codes are a small closed set ('00', 'Success', 'Completed'…); everything
 * outside it that is a short numeric or matches isErr is a FAILED OUTCOME (technical vs business
 * attribution is a separate question — a failed Semati check is still a failed check). */
const SUCCESS = new Set(String(process.env.DMS_JOURNEY_SUCCESS_CODES ||
  '00,0,600,success,completed,ok,200,processed,delivered,sent,y,approved,active')   // 600 = Semati/TCC success (proven 1 Sep)
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const isFail = (code, message) => {
  if (code == null || code === '') return false;
  const c = String(code).trim().toLowerCase();
  if (SUCCESS.has(c)) return false;
  // the ledger's own message is the closest thing to ground truth — "success" is not a failure,
  // whatever the numeric code (Semati 600 taught us that on day one)
  if (message != null && /^(success|ok|completed|approved)\.?$/i.test(String(message).trim())) return false;
  return isErr(code) || /^\d{1,4}$/.test(c);                   // bare numeric fault (e.g. 21)
};

/* ---- runtime resolution, cached per process ---- */
const _res = new Map();
async function resolve(key) {
  if (_res.has(key)) return _res.get(key);
  const J = JOURNEYS[key];
  const out = { ok: false, table: `${SC(key)}.${J.table}`, cols: {} };
  if (await dms.hasTable(SC(key), J.table)) {
    const have = await dms.columnsOf(SC(key), J.table);
    const pickOf = cands => cands.find(c => have.has(c.toLowerCase())) || null;
    out.cols = {
      at: pickOf(F.at), dealer: pickOf(F.dealer) || pickOf(F.dealer2), msisdn: pickOf(F.msisdn),
      customer: pickOf(F.customer), code: pickOf(F.code), message: pickOf(F.message),
      ref: pickOf(F.ref), api: pickOf(F.api), plan: pickOf(F.plan), plan_id: pickOf(F.plan_id)
    };
    out.ok = have.has('id') && !!out.cols.at;   // id watermark + a timestamp are the two essentials
    if (!out.ok) out.why = !have.has('id') ? 'no id column' : 'no timestamp column';
    /* TIMEZONE MEASUREMENT (1 Sep 2026): report_request_self_activation writes KSA LOCAL time
     * while the dms_audit_logs ledgers write UTC — read as UTC, portal rows landed +3h in the
     * future. Don't guess per table: read the newest row (by PK, instant) and compare with now.
     * A freshest-row ~+3h AHEAD of now is physically impossible on a correct clock ⇒ the table
     * is KSA-written and all its timestamps get -3h normalization on every read path. */
    if (out.ok) {
      try {
        const nr = await dms.q(`SELECT \`${out.cols.at}\` a FROM \`${SC(key)}\`.\`${J.table}\` ORDER BY id DESC LIMIT 1`);
        const a = nr[0] && nr[0].a != null ? new Date(nr[0].a).getTime() : null;
        const dh = a != null ? (a - Date.now()) / 3600e3 : 0;
        out.tzShiftMs = (dh > 2 && dh < 4) ? 3 * 3600e3 : 0;
      } catch (_) { out.tzShiftMs = 0; }
    }
  } else out.why = 'table not visible';
  _res.set(key, out);
  return out;
}
/* normalize a KSA-written timestamp to true UTC (no-op for UTC tables) */
const atFix = (res, v) => v == null ? null : new Date(new Date(v).getTime() - (res.tzShiftMs || 0));

/* ---- one sync pass for one journey ---- */
async function syncOne(key, cfg) {
  const r = await resolve(key);
  const stName = key;
  if (!r.ok) {
    await db.console.query(
      `INSERT INTO dms_journey_state(journey,src,note,updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(journey) DO UPDATE SET note=$3, updated_at=now()`, [stName, r.table, r.why]);
    return { key, skipped: r.why };
  }
  const C = r.cols;
  const st = await db.console.query(`SELECT last_id FROM dms_journey_state WHERE journey=$1`, [stName]);
  let lastId = st.rows.length ? Number(st.rows[0].last_id) : null;

  const mx = await dms.q(`SELECT max(id) m FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\``);
  const maxId = Number((mx[0] || {}).m || 0);
  if (lastId == null) {                       // first run: anchor near the tip, don't replay years
    lastId = Math.max(0, maxId - cfg.backfill);
    await db.console.query(
      `INSERT INTO dms_journey_state(journey,src,last_id,note,updated_at)
       VALUES($1,$2,$3,'anchored near tip (first run)',now())
       ON CONFLICT(journey) DO UPDATE SET last_id=$3, src=$2, note='re-anchored', updated_at=now()`,
      [stName, r.table, lastId]);
  }
  if (maxId <= lastId) {
    await db.console.query(`UPDATE dms_journey_state SET updated_at=now(), note='up to date' WHERE journey=$1`, [stName]);
    return { key, rows: 0 };
  }

  const sel = ['`id`', `\`${C.at}\` AS at`]
    .concat(C.dealer ? [`\`${C.dealer}\` AS dealer`] : [])
    .concat(C.msisdn ? [`\`${C.msisdn}\` AS msisdn`] : [])
    .concat(C.customer ? [`\`${C.customer}\` AS customer`] : [])
    .concat(C.code ? [`\`${C.code}\` AS code`] : [])
    .concat(C.message ? [`\`${C.message}\` AS message`] : [])
    .concat(C.ref ? [`\`${C.ref}\` AS ref`] : [])
    .concat(C.api ? [`\`${C.api}\` AS api`] : [])
    .concat(C.plan ? [`\`${C.plan}\` AS plan`] : [])
    .concat(C.plan_id ? [`\`${C.plan_id}\` AS plan_id`] : []).join(', ');

  // grandfather watch rides the activation stream — no extra queries
  const gf = ((key === 'activation' || key === 'self_activation') && (C.plan || C.plan_id)) ? GF() : null;
  const gfHits = [];
  let total = 0;
  for (let b = 0; b < cfg.maxBatches; b++) {
    const rows = await dms.qSlow(
      `SELECT ${sel} FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\` WHERE id > ? ORDER BY id LIMIT ${cfg.batch}`,
      [lastId], 45000);
    if (!rows.length) break;

    // aggregate into hourly buckets in JS — one upsert per touched bucket
    const buckets = new Map();  // iso hour -> {calls, errors, dealers:Set, codes:Map}
    const events = [];
    for (const row of rows) {
      const t = row.at ? atFix(r, row.at) : null;
      if (t && !isNaN(t)) {
        const hb = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours())).toISOString();
        let B = buckets.get(hb);
        if (!B) { B = { calls: 0, errors: 0, dealers: new Set(), codes: new Map(), apis: new Map(), dcnt: new Map() }; buckets.set(hb, B); }
        B.calls++;
        const code = row.code == null ? null : String(row.code).slice(0, 40);
        if (code) B.codes.set(code, (B.codes.get(code) || 0) + 1);
        if (row.api != null && row.api !== '') { const a = String(row.api).slice(0, 120); B.apis.set(a, (B.apis.get(a) || 0) + 1); }
        if (row.dealer != null && row.dealer !== '') { const dl = String(row.dealer).slice(0, 60);
          B.dealers.add(dl); B.dcnt.set(dl, (B.dcnt.get(dl) || 0) + 1); }
        if (gf && gf.enabled && t >= gf.cutover) {
          const pid = row.plan_id == null ? '' : String(row.plan_id);
          const pn = row.plan == null ? '' : String(row.plan).trim().toLowerCase();
          if (((pid && gf.ids.includes(pid)) || (pn && gf.names.includes(pn))) && gfHits.length < 50)
            gfHits.push({ at: t.toISOString(), plan: row.plan || pid,
              dealer: row.dealer == null ? null : String(row.dealer).slice(0, 60) });
        }
        if (isFail(code, row.message)) {
          B.errors++;
          if (events.length < cfg.eventsCap) events.push({
            src_id: Number(row.id), at: t.toISOString(), dealer: row.dealer == null ? null : String(row.dealer).slice(0, 60),
            msisdn: maskNum(row.msisdn), customer: maskNum(row.customer), code,
            message: row.message == null ? null : String(row.message).slice(0, 300),
            ref: row.ref == null ? null : String(row.ref).slice(0, 80),
            api: row.api == null ? null : String(row.api).slice(0, 120)
          });
        }
      }
      lastId = Math.max(lastId, Number(row.id));
    }
    for (const [hb, B] of buckets) {
      const top = (m, k) => Object.fromEntries([...m.entries()].sort((a, z) => z[1] - a[1]).slice(0, k));
      /* jsonb dimensions MERGE ADDITIVELY across batches/cycles — the old overwrite kept only the
       * last batch's counts, so a 600-call hour could show 9 codes (found 1 Sep). */
      const merge = (col, lim) =>
        `${col} = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
            SELECT k, sum(v) v FROM (
              SELECT key k, (value)::numeric v FROM jsonb_each_text(COALESCE(dms_journey_stats.${col}, '{}'::jsonb))
              UNION ALL
              SELECT key, (value)::numeric FROM jsonb_each_text(COALESCE(EXCLUDED.${col}, '{}'::jsonb))
            ) u GROUP BY k ORDER BY v DESC LIMIT ${lim}) s2)`;
      await db.console.query(
        `INSERT INTO dms_journey_stats(bucket,journey,calls,errors,dealers,codes,apis,top_dealers)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(bucket,journey) DO UPDATE SET
           calls=dms_journey_stats.calls+EXCLUDED.calls,
           errors=dms_journey_stats.errors+EXCLUDED.errors,
           dealers=GREATEST(dms_journey_stats.dealers,EXCLUDED.dealers),
           ${merge('codes', 12)}, ${merge('apis', 10)}, ${merge('top_dealers', 8)}`,
        [hb, key, B.calls, B.errors, B.dealers.size,
         JSON.stringify(top(B.codes, 12)), JSON.stringify(top(B.apis, 10)), JSON.stringify(top(B.dcnt, 8))]);
    }
    for (const ev of events)
      await db.console.query(
        `INSERT INTO dms_journey_events(journey,src_id,at,dealer,msisdn,customer,code,message,ref,api)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [key, ev.src_id, ev.at, ev.dealer, ev.msisdn, ev.customer, ev.code, ev.message, ev.ref, ev.api]);

    total += rows.length;
    await db.console.query(
      `UPDATE dms_journey_state SET last_id=$2, rows_done=rows_done+$3, updated_at=now(),
         note=$4 WHERE journey=$1`,
      [stName, lastId, rows.length, maxId - lastId > 0 ? `catching up · ${(maxId - lastId).toLocaleString()} behind` : 'up to date']);
    if (rows.length < cfg.batch) break;
  }
  if (gfHits.length) { try { await raiseGrandfather(gfHits); } catch (e) { /* alert best-effort */ } }
  return { key, rows: total, gf_hits: gfHits.length || undefined };
}

/* JOURNEY FAULT-SURGE WATCH — born from the 31 Aug 2026 recharge incident: dms-customer-services
 * → Redknee SOAP TransactionService (172.31.45.28:8001) returned fault 21 "Errors communicating
 * between CRM and external applications" for ~45 customers, found by customers, escalated by
 * mail at 18:53. The data was in our journey stream the whole time — a surge of non-success
 * codes on the recharge journeys. This watches every journey's last N hours: too many failed
 * outcomes AND a failure share above threshold → one alert per journey through the normal
 * pipeline, auto-resolving when the surge clears.
 * Env: DMS_JOURNEY_FAULT_WATCH=0 off · DMS_JF_MIN (10) · DMS_JF_PCT (15) · DMS_JF_WINDOW_H (2) */
const JF = () => ({
  enabled: process.env.DMS_JOURNEY_FAULT_WATCH !== '0',
  minFails: Math.max(3, Number(process.env.DMS_JF_MIN) || 10),
  pct: Math.max(1, Number(process.env.DMS_JF_PCT) || 15),
  windowH: Math.max(1, Number(process.env.DMS_JF_WINDOW_H) || 2)
});
// money-touching journeys page harder — a failing recharge is a customer paying for nothing
const MONEY = new Set(['topup', 'wallet_refill', 'plan_renew', 'wallet_move', 'activation', 'self_activation']);
async function faultWatch() {
  const cfg = JF(); if (!cfg.enabled) return;
  const now = new Date().toISOString();
  const { rows } = await db.console.query(
    `SELECT journey, calls, errors, codes, apis FROM dms_journey_stats
      WHERE bucket >= now() - ($1 || ' hours')::interval`, [String(cfg.windowH)]);
  const agg = new Map();
  for (const r of rows) {
    let a = agg.get(r.journey);
    if (!a) { a = { calls: 0, errors: 0, codes: {}, apis: {} }; agg.set(r.journey, a); }
    a.calls += Number(r.calls); a.errors += Number(r.errors);
    for (const [c, x] of Object.entries(r.codes || {})) a.codes[c] = (a.codes[c] || 0) + Number(x);
    for (const [c, x] of Object.entries(r.apis || {})) a.apis[c] = (a.apis[c] || 0) + Number(x);
  }
  const tripped = new Map();
  for (const [j, a] of agg) {
    if (!JOURNEYS[j]) continue;
    const rate = a.calls ? 100 * a.errors / a.calls : 0;
    if (a.errors >= cfg.minFails && rate >= cfg.pct) {
      const failCodes = Object.entries(a.codes).filter(([c]) => isFail(c)).sort((x, z) => z[1] - x[1]).slice(0, 4);
      const topApi = Object.entries(a.apis).sort((x, z) => z[1] - x[1])[0];
      let msg = `${a.errors} of ${a.calls} ${JOURNEYS[j].label} calls FAILED in the last ${cfg.windowH}h (${rate.toFixed(1)}%).`
        + (failCodes.length ? ` Codes: ${failCodes.map(([c, x]) => `${c} × ${x}`).join(', ')}.` : '')
        + (topApi ? ` Busiest API: ${topApi[0]}.` : '');
      if (failCodes.some(([c]) => String(c).trim() === '21'))
        msg += ' Code 21 = Redknee/BSS "CRM ↔ external applications" fault — the 31 Aug recharge-outage signature; engage BSS/Impact team.';
      tripped.set(`dms:journey-fault:${j}`, { j, a, rate, msg });
    }
  }
  // resolve cleared surges
  const open = (await db.console.query(
    `SELECT id, rule_key FROM alerts WHERE status='open' AND rule_key LIKE 'dms:journey-fault:%'`)).rows;
  for (const row of open) if (!tripped.has(row.rule_key))
    await db.console.query(`UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [row.id, now]);
  // open / refresh
  for (const [key, t] of tripped) {
    const cur = (await db.console.query(
      `SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
    if (cur) await db.console.query(
      `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
         peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, t.a.errors, t.msg]);
    else await db.console.query(
      `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
         window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
       VALUES ($1,$2,$3,'Digital Ops','open',$4,'>',$5,$6,$7,$8,$9,$10,$11,$11,$6,1)`,
      [key, `DMS ${JOURNEYS[t.j].label} failing`, MONEY.has(t.j) ? 'P2' : 'P3',
       `dms.journey.${t.j}.failrate`, cfg.pct, t.a.errors, t.a.calls, cfg.windowH,
       JSON.stringify({ journey: t.j, rate: Number(t.rate.toFixed(1)), source: 'dms_journey_stats' }), t.msg, now]);
  }
}

/* ---- scheduler ---- */
let _timer = null, _running = false;
const _status = { enabled: false, last_run: null, last_ms: null, cycles: 0, results: [], error: null };

/* ---- COMMISSION-LAG WATCH (Yosri, 2 Sep 2026) ------------------------------------------------
 * "Alert when commission is not recorded even 30 minutes after a successful activation."
 * The activation ledger stamps a commission flag (commission_sync / commission_flag — resolved by
 * commissionReport's discovery, never hardcoded) when DMS processes the commission. So the honest
 * signal is: sale rows past the grace period whose flag is still unset.
 * SELF-CALIBRATING: some rows are legitimately non-commissionable (flag stays 0 forever), so we
 * measure the >24h-old baseline share of unset flags in the same id window and alert only when the
 * 30min–6h "stuck" share exceeds baseline by DMS_COMM_LAG_DELTA points with ≥ DMS_COMM_LAG_MIN_N
 * rows — a stopped commission engine trips it, a plan mix that never pays commission does not.
 * Bounded: one aggregate over a recent PK window; time reference = the ledger's own max(at), so
 * Clara's KSA-local timestamps cannot skew the grace period. */
const COMM_CFG = () => ({
  minutes: Number(process.env.DMS_COMM_LAG_MINUTES || 30),
  minN:    Number(process.env.DMS_COMM_LAG_MIN_N   || 5),
  delta:   Number(process.env.DMS_COMM_LAG_DELTA   || 20),
  idWin:   Number(process.env.DMS_COMM_LAG_IDWIN   || 150000)
});
async function commissionWatch() {
  if (!dms.configured || !dms.configured()) return;
  const cr = require('./commissionReport');
  const rf = await cr.resolveFields();
  if (!rf.ok || !rf.map.commission || !rf.map.at) { _status.comm_watch = 'no commission/at column resolved'; return; }
  const cfg = COMM_CFG();
  const T = `\`${cr.SCHEMA}\`.\`${cr.TABLE}\``;
  const cC = rf.map.commission, atC = rf.map.at;
  const mx = await dms.q(`SELECT max(id) m FROM ${T}`);
  const loId = Math.max(0, Number((mx[0] || {}).m || 0) - cfg.idWin);
  if (!loId && !Number((mx[0] || {}).m || 0)) return;
    // string list ONLY — a numeric 0 in the IN list would coerce 'y'/'yes' to 0 on varchar
  // columns and mark EVERY row unset. '0' covers int columns via its own coercion.
  const unset = `(\`${cC}\` IS NULL OR \`${cC}\` IN ('0','','n','no','false','pending'))`;
  const r = (await dms.qSlow(`
    SELECT
      SUM(CASE WHEN \`${atC}\` >= mx - INTERVAL 6 HOUR AND \`${atC}\` < mx - INTERVAL ${cfg.minutes} MINUTE THEN 1 ELSE 0 END) fresh_n,
      SUM(CASE WHEN \`${atC}\` >= mx - INTERVAL 6 HOUR AND \`${atC}\` < mx - INTERVAL ${cfg.minutes} MINUTE AND ${unset} THEN 1 ELSE 0 END) fresh_miss,
      SUM(CASE WHEN \`${atC}\` < mx - INTERVAL 24 HOUR THEN 1 ELSE 0 END) base_n,
      SUM(CASE WHEN \`${atC}\` < mx - INTERVAL 24 HOUR AND ${unset} THEN 1 ELSE 0 END) base_miss
    FROM ${T}, (SELECT max(\`${atC}\`) mx FROM ${T} WHERE id > ?) x
    WHERE id > ?`, [loId, loId], 30000))[0] || {};
  const fN = Number(r.fresh_n || 0), fM = Number(r.fresh_miss || 0);
  const bN = Number(r.base_n || 0), bM = Number(r.base_miss || 0);
  const freshPct = fN ? 100 * fM / fN : 0;
  const basePct  = bN ? 100 * bM / bN : 0;
  _status.comm_watch = { fresh: `${fM}/${fN} unset (${freshPct.toFixed(1)}%)`, baseline: `${bM}/${bN} (${basePct.toFixed(1)}%)` };
  const key = 'dms:commission-lag';
  const now = new Date().toISOString();
  const trip = fM >= cfg.minN && (freshPct - basePct) >= cfg.delta;
  if (!trip) {
    const open = (await db.console.query(`SELECT id FROM alerts WHERE status='open' AND rule_key=$1`, [key])).rows;
    for (const row of open) await db.console.query(`UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [row.id, now]);
    return;
  }
  // evidence: 5 sample stuck rows (id / plan / dealer), masked identifiers not needed here
  let sample = [];
  try {
    const sel = ['id', rf.map.plan, rf.map.dealer].filter(Boolean).map(c => `\`${c}\``).join(', ');
    sample = await dms.qSlow(`
      SELECT ${sel} FROM ${T}, (SELECT max(\`${atC}\`) mx FROM ${T} WHERE id > ?) x
       WHERE id > ? AND \`${atC}\` >= mx - INTERVAL 6 HOUR AND \`${atC}\` < mx - INTERVAL ${cfg.minutes} MINUTE AND ${unset}
       ORDER BY id DESC LIMIT 5`, [loId, loId], 20000);
  } catch (e) { sample = []; }
  const msg = `${fM} of ${fN} activations in the last 6h are past the ${cfg.minutes}-minute grace with NO commission recorded `
    + `(${freshPct.toFixed(1)}% vs a ${basePct.toFixed(1)}% structural baseline). `
    + `Sample ledger rows: ${sample.map(x => '#' + x.id).join(', ') || '—'}. `
    + `Check the DMS commission engine / queue; ledger = ${cr.SCHEMA}.${cr.TABLE}.${cC}.`;
  const cur = (await db.console.query(`SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
       peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, fM, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,$2,'P2','Digital Ops','open',$3,'>',$4,$5,$6,6,$7,$8,$9,$9,$5,1)`,
    [key, 'DMS commissions not recorded after activation', 'dms_commission_lag', cfg.minN, fM,
     JSON.stringify({ fresh: { n: fN, missing: fM }, baseline_pct: basePct, sample }), 'commission', msg, now]);
}

/* ---- AUDIT-PIPELINE FRESHNESS WATCH — `dms:audit-stale` (Phase 0 of the APIGW/DMS logs plan,
 * 3 Sep 2026; see Salam DMS/APIGW-DMS-Logs-Observability-Plan.md) --------------------------------
 * DISCOVERY (3 Sep, live trace on the APP nodes): every UIL/DMS call is audited via
 * UIL AuditLogService → dms_audit_logs_producer (:9045) → RabbitMQ → dms_audit_logs_consumer →
 * the very Clara `dms_audit_logs` ledgers THIS collector ingests. If that pipeline stalls
 * (consumer down, Rabbit backlog), the ledgers stop growing and every journey stat, fault-surge
 * and commission watch goes silently blind — the worst failure mode, because silence looks like
 * health. This watch detects it.
 *
 * ZERO EXTRA LOAD ON CLARA BY DESIGN (this is prod): it reads ONLY the per-journey results the
 * cycle just produced (rows>0 = the ledger advanced; syncOne already fetched max(id) anyway) and
 * seeds across restarts from console-PG dms_journey_stats. Not one additional MariaDB query.
 *
 * TRIP LOGIC (calibrated to avoid night-time false alarms): a single quiet journey is normal;
 * ≥ DMS_AUDIT_STALE_MIN_J (3) CORE high-traffic journeys ALL frozen for DMS_AUDIT_STALE_MINUTES
 * (45) is a pipeline event. KSA quiet hours 01:00–07:00 multiply the threshold by
 * DMS_AUDIT_QUIET_MULT (3). A journey whose sync ERRORED or was SKIPPED this cycle is excluded
 * both ways — a broken sync is not evidence of a stalled pipeline (it has its own state note),
 * and it must not mask one either. Auto-resolves when the ledgers advance again. */
const AUDIT_CFG = () => ({
  minutes: Number(process.env.DMS_AUDIT_STALE_MINUTES || 45),
  minJ:    Number(process.env.DMS_AUDIT_STALE_MIN_J   || 3),
  quiet:   Number(process.env.DMS_AUDIT_QUIET_MULT    || 3),
  core:    String(process.env.DMS_AUDIT_CORE || 'activation,nafath,semati,topup,dealer_sms,cms')
             .split(',').map(s => s.trim()).filter(k => JOURNEYS[k])
});
const _advance = {};                    // journey -> ISO of last observed ledger advance
let _advanceSeeded = false;
async function auditWatch(results) {
  const cfg = AUDIT_CFG();
  if (!cfg.core.length || process.env.DMS_AUDIT_STALE === '0') return;
  const nowMs = Date.now(), now = new Date(nowMs).toISOString();
  if (!_advanceSeeded) {                // restart survival: last hour-bucket with calls, console PG only
    const { rows } = await db.console.query(
      `SELECT journey, max(bucket) b FROM dms_journey_stats WHERE calls > 0 AND journey = ANY($1) GROUP BY journey`,
      [cfg.core]);
    for (const r of rows) {             // a bucket covers an hour — credit its end, capped at now
      const end = Math.min(nowMs, new Date(r.b).getTime() + 3600e3);
      _advance[r.journey] = new Date(end).toISOString();
    }
    _advanceSeeded = true;
  }
  const byKey = Object.fromEntries((results || []).map(r => [r.key, r]));
  for (const j of cfg.core) {
    const r = byKey[j];
    if (r && Number(r.rows) > 0) _advance[j] = now;       // ledger advanced this cycle
  }
  // KSA (UTC+3) quiet hours: low genuine traffic → longer grace before we call it a stall
  const ksaHour = (new Date(nowMs + 3 * 3600e3)).getUTCHours();
  const grace = cfg.minutes * (ksaHour >= 1 && ksaHour < 7 ? cfg.quiet : 1);
  const stalled = [], unknown = [];
  for (const j of cfg.core) {
    const r = byKey[j];
    if (r && (r.error || r.skipped)) { unknown.push(j); continue; }   // sync problem ≠ pipeline stall
    const last = _advance[j];
    if (!last) { unknown.push(j); continue; }                          // never seen data — can't judge
    if ((nowMs - new Date(last).getTime()) / 60000 >= grace) stalled.push(j);
  }
  _status.audit_watch = {
    grace_min: grace, stalled, unknown,
    last_advance: Object.fromEntries(cfg.core.map(j => [j, _advance[j] || null]))
  };
  const key = 'dms:audit-stale';
  const trip = stalled.length >= cfg.minJ;
  if (!trip) {
    const open = (await db.console.query(`SELECT id FROM alerts WHERE status='open' AND rule_key=$1`, [key])).rows;
    for (const row of open) await db.console.query(
      `UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [row.id, now]);
    return;
  }
  const oldest = Math.round(Math.max(...stalled.map(j => (nowMs - new Date(_advance[j]).getTime()) / 60000)));
  const msg = `Audit pipeline appears STALLED: ${stalled.length} core ledgers frozen ≥${grace} min `
    + `(${stalled.map(j => JOURNEYS[j].label).join(', ')}; oldest ${oldest} min). The Clara dms_audit_logs `
    + `sink is not receiving rows — dms_audit_logs_consumer / RabbitMQ / producer on the APP nodes `
    + `(mvno-appdigp01–04, /opt/application) is the likely fault. While this lasts ALL journey stats, `
    + `fault-surge and commission alerts are blind. Verify with DMS L2; check consumer logs for `
    + `"Pushing messges" without "Saved".`;
  const cur = (await db.console.query(
    `SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
       peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, stalled.length, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,$2,'P1','Digital Ops','open',$3,'>=',$4,$5,$6,1,$7,$8,$9,$9,$5,1)`,
    [key, 'DMS audit pipeline stalled — journey monitoring is blind', 'dms_audit_stale', cfg.minJ,
     stalled.length, JSON.stringify({ stalled, unknown, grace_min: grace,
       last_advance: _status.audit_watch.last_advance }), 'audit-pipeline', msg, now]);
}

async function cycle() {
  if (_running) return; _running = true;
  const t0 = Date.now(); const cfg = CFG(); const out = [];
  try {
    for (const key of Object.keys(JOURNEYS)) {
      try { out.push(await syncOne(key, cfg)); }
      catch (e) {
        out.push({ key, error: e.message.slice(0, 160) });
        try { await db.console.query(
          `INSERT INTO dms_journey_state(journey,note,updated_at) VALUES($1,$2,now())
           ON CONFLICT(journey) DO UPDATE SET note=$2, updated_at=now()`, [key, 'sync error: ' + e.message.slice(0, 200)]); } catch (_) {}
      }
    }
    // retention: events only — hourly stats are small and permanent
    await db.console.query(`DELETE FROM dms_journey_events WHERE at < now() - ($1 || ' days')::interval`, [String(cfg.retentionDays)]);
    try { await faultWatch(); } catch (e) { _status.fault_watch_error = e.message.slice(0, 160); }
    try { await commissionWatch(); } catch (e) { _status.comm_watch_error = e.message.slice(0, 160); }
    try { await auditWatch(out); } catch (e) { _status.audit_watch_error = e.message.slice(0, 160); }
    _status.error = null;
  } catch (e) { _status.error = e.message; }
  _status.last_run = new Date().toISOString(); _status.last_ms = Date.now() - t0;
  _status.cycles++; _status.results = out; _running = false;
}
/* ONE-TIME REPAIR (1 Sep 2026): before '600' entered the success set, an hour or two of Semati
 * rows were ingested as failures — permanent red rows in the Failures list and inflated error
 * counts in that window's stats. Fix the stored history once, marker-guarded so it never reruns. */
async function repairOnce() {
  const done = await db.console.query(`SELECT 1 FROM dms_journey_state WHERE journey='_repair_success_codes'`);
  if (done.rows.length) return;
  const del = await db.console.query(
    `DELETE FROM dms_journey_events WHERE lower(trim(coalesce(code,''))) = ANY($1)`, [[...SUCCESS]]);
  await db.console.query(
    `UPDATE dms_journey_stats SET errors = GREATEST(0, errors - COALESCE((codes->>'600')::int, 0))
      WHERE journey = 'semati' AND codes ? '600' AND errors > 0`);
  await db.console.query(
    `INSERT INTO dms_journey_state(journey, note, updated_at) VALUES ('_repair_success_codes', $1, now())
     ON CONFLICT (journey) DO UPDATE SET note = $1, updated_at = now()`,
    ['success-coded events purged: ' + del.rowCount + ' · semati error counts corrected']);
  console.log('[dms-journeys] repair: purged', del.rowCount, 'success-coded event rows');
}
/* v2 (1 Sep): the codes-overwrite bug meant v1 under-corrected — some buckets still carry
 * inflated error counts their own code mix cannot justify (e.g. semati 23:00: 481 "fails",
 * 9 coded). Clamp every bucket's errors to the sum of its FAILING codes. Under-counts where
 * codes were lost to the overwrite — a documented under-count beats a false failure rate that
 * pages people. Marker-guarded, runs once. */
async function repairStatsV2() {
  const done = await db.console.query(`SELECT 1 FROM dms_journey_state WHERE journey='_repair_stats_v2'`);
  if (done.rows.length) return;
  const { rows } = await db.console.query(`SELECT bucket, journey, calls, errors, codes FROM dms_journey_stats WHERE errors > 0`);
  let fixed = 0;
  for (const r of rows) {
    const failSum = Object.entries(r.codes || {}).reduce((a, [c, n]) => a + (isFail(c) ? Number(n) : 0), 0);
    const clamped = Math.min(Number(r.errors), failSum);
    if (clamped < Number(r.errors)) {
      await db.console.query(`UPDATE dms_journey_stats SET errors=$3 WHERE bucket=$1 AND journey=$2`,
        [r.bucket, r.journey, clamped]);
      fixed++;
    }
  }
  await db.console.query(
    `INSERT INTO dms_journey_state(journey, note, updated_at) VALUES ('_repair_stats_v2', $1, now())
     ON CONFLICT (journey) DO UPDATE SET note = $1, updated_at = now()`,
    ['error counts clamped to failing-code evidence in ' + fixed + ' bucket(s)']);
  console.log('[dms-journeys] repair v2: clamped', fixed, 'bucket(s)');
}

function start() {
  const cfg = CFG();
  _status.enabled = cfg.enabled && dms.configured();
  if (!_status.enabled) { console.log('[dms-journeys] disabled (DMS_JOURNEY_SYNC=0 or DMS DB not configured)'); return; }
  setTimeout(() => repairOnce().then(() => repairStatsV2()).catch(e => console.error('[dms-journeys] repair:', e.message)), 10000);
  setTimeout(() => cycle().catch(() => {}), 20000);       // let boot finish first
  _timer = setInterval(() => cycle().catch(() => {}), cfg.intervalSec * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[dms-journeys] collector armed · every ${cfg.intervalSec}s · ${Object.keys(JOURNEYS).length} journeys`);
}
const status = () => ({ ..._status, journeys: Object.keys(JOURNEYS).length });

/* ---- board query (console DB only — instant) ---- */
async function board(fromIso, toIso) {
  const { rows } = await db.console.query(
    `SELECT journey, sum(calls)::bigint calls, sum(errors)::bigint errors, max(dealers) peak_dealers
       FROM dms_journey_stats WHERE bucket >= $1 AND bucket < $2 GROUP BY journey`, [fromIso, toIso]);
  const { rows: spark } = await db.console.query(
    `SELECT journey, bucket, calls, errors FROM dms_journey_stats
      WHERE bucket >= $1 AND bucket < $2 ORDER BY bucket`, [fromIso, toIso]);
  const { rows: state } = await db.console.query(`SELECT * FROM dms_journey_state`);
  const byJ = {};
  for (const key of Object.keys(JOURNEYS)) {
    const agg = rows.find(x => x.journey === key);
    byJ[key] = { key, label: JOURNEYS[key].label, icon: JOURNEYS[key].icon, note: JOURNEYS[key].note || null,
      calls: Number(agg && agg.calls || 0), errors: Number(agg && agg.errors || 0),
      peak_dealers: Number(agg && agg.peak_dealers || 0),
      spark: spark.filter(x => x.journey === key).map(x => ({ t: x.bucket, c: Number(x.calls), e: Number(x.errors) })),
      state: state.find(s => s.journey === key) || null };
  }
  return { ok: true, from: fromIso, to: toIso, journeys: Object.values(byJ), collector: status() };
}

/* ---- drill: one journey — code mix + recent failures (console DB only) ---- */
async function drill(key, fromIso, toIso) {
  if (!JOURNEYS[key]) throw new Error('unknown journey');
  const { rows: hourly } = await db.console.query(
    `SELECT bucket t, calls, errors, dealers, codes, apis, top_dealers FROM dms_journey_stats
      WHERE journey=$1 AND bucket >= $2 AND bucket < $3 ORDER BY bucket`, [key, fromIso, toIso]);
  const agg = () => new Map();
  const codeAgg = agg(), apiAgg = agg(), dlrAgg = agg();
  const fold = (m, obj) => { for (const [c, n] of Object.entries(obj || {})) m.set(c, (m.get(c) || 0) + Number(n)); };
  for (const h of hourly) { fold(codeAgg, h.codes); fold(apiAgg, h.apis); fold(dlrAgg, h.top_dealers); }
  const rank = (m, k) => [...m.entries()].sort((a, z) => z[1] - a[1]).slice(0, k).map(([v, n]) => ({ v, n }));
  const { rows: events } = await db.console.query(
    `SELECT src_id, at, dealer, msisdn, customer, code, message, ref, api FROM dms_journey_events
      WHERE journey=$1 AND at >= $2 AND at < $3 ORDER BY at DESC LIMIT 120`, [key, fromIso, toIso]);
  const r = await resolve(key).catch(() => null);
  return { ok: true, key, label: JOURNEYS[key].label, note: JOURNEYS[key].note || null, hourly,
    codes: rank(codeAgg, 15).map(x => ({ code: x.v, n: x.n })),
    apis: rank(apiAgg, 12), top_dealers: rank(dlrAgg, 12),
    events, source: r ? { table: r.table, cols: r.cols } : null };
}

/* ---- end-to-end trace: one identifier across every journey table, LIVE on Clara.
 * Bounded: only tables where the matched column is INDEXED or the table is small; each query
 * time-boxed; digits-only identifier; results masked. This is the "dealer journey for one
 * customer/sale" answer — activation + nafath + semati + payment + sms in one timeline. ---- */
async function trace(qRaw, unmask) {
  const um = !!unmask;   // capability verified + audited by the route
  const dq = String(qRaw || '').replace(/\D/g, '');
  if (dq.length < 6) throw new Error('give at least 6 digits of an MSISDN, national ID, or reference');
  const hits = []; const scanned = [], skipped = [];
  for (const key of Object.keys(JOURNEYS)) {
    const r = await resolve(key); if (!r.ok) { skipped.push({ key, why: r.why }); continue; }
    const C = r.cols;
    const idx = await dms.indexedCols(SC(key), JOURNEYS[key].table);
    const stats = await dms.q(
      `SELECT table_rows n FROM information_schema.tables WHERE table_schema=? AND table_name=?`,
      [SC(key), JOURNEYS[key].table]).catch(() => [{ n: 9e9 }]);
    const small = Number((stats[0] || {}).n || 9e9) < 400000;
    const cands = [C.msisdn, C.customer, C.ref].filter(Boolean);
    let usable = cands.filter(c => small || idx.has(c.toLowerCase()));
    let boundCond = '', boundNote = '';
    if (!usable.length) {
      /* no indexed identifier — instead of SKIPPING (which made the activation ledger invisible
       * in every trace, found 1 Sep), scan a bounded recent-id window on the PK: ~150k rows
       * covers months and costs 1-2s. Marked "(recent)" so the coverage is honest. */
      const mx = await dms.q(`SELECT max(id) m FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\``).catch(() => [{}]);
      const loId = Math.max(0, Number((mx[0] || {}).m || 0) - 150000);
      if (!loId && !Number((mx[0] || {}).m || 0)) { skipped.push({ key, why: 'unreadable' }); continue; }
      boundCond = `id > ${loId} AND `; boundNote = ' (recent)';
      usable = cands;
    }
    scanned.push(key + boundNote);
    const where = boundCond + '(' + usable.map(c => `\`${c}\` LIKE ?`).join(' OR ') + ')';
    const params = usable.map(() => '%' + dq + '%');
    try {
      const rows = await dms.qSlow(
        `SELECT id, \`${C.at}\` at${C.code ? `, \`${C.code}\` code` : ''}${C.message ? `, \`${C.message}\` message` : ''}` +
        `${C.dealer ? `, \`${C.dealer}\` dealer` : ''}${C.api ? `, \`${C.api}\` api` : ''}${C.ref ? `, \`${C.ref}\` ref` : ''}` +
        `${C.msisdn ? `, \`${C.msisdn}\` msisdn` : ''}` +
        ` FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\` WHERE ${where} ORDER BY id DESC LIMIT 25`,
        params, 25000);
      const pii = (v, n) => v == null ? null : (um ? String(v).slice(0, n) : maskNum(String(v).slice(0, n)));
      for (const row of rows) hits.push({
        journey: key, label: JOURNEYS[key].label, icon: JOURNEYS[key].icon, src_id: Number(row.id),
        at: atFix(r, row.at), code: row.code == null ? null : String(row.code).slice(0, 40),
        message: pii(row.message, 200), msisdn: pii(row.msisdn, 40),
        dealer: row.dealer == null ? null : String(row.dealer).slice(0, 60),
        api: row.api == null ? null : String(row.api).slice(0, 120),
        ref: row.ref == null ? null : String(row.ref).slice(0, 80), err: isFail(row.code, row.message)
      });
    } catch (e) { skipped.push({ key, why: 'query: ' + e.message.slice(0, 80) }); }
  }
  hits.sort((a, z) => new Date(a.at) - new Date(z.at));
  return { ok: true, q: maskNum(dq), unmasked: um, hits: hits.slice(0, 200), scanned, skipped };
}

/* ---- home KPIs — the DMS-channel truth for "how are dealers doing today".
 * The old header read the replica's onboarding_orders (Salam-app flow only — 2 dealers!); the
 * real network activates through DMS. Live bounded query: recent ids only (PK range — no time
 * scan), aggregated in SQL. today + yesterday SAME TIME-OF-DAY, KSA day boundaries. ---- */
async function home() {
  const r = await resolve('activation');
  if (!r.ok) return { ok: false, error: 'activation journey unresolved: ' + (r.why || '') };
  const C = r.cols;
  if (!C.dealer || !C.code) return { ok: false, error: 'dealer/code column missing on activation table' };
  const KSA = 3 * 3600e3, now = new Date();
  const day0 = new Date(Math.floor((now.getTime() + KSA) / 864e5) * 864e5 - KSA);
  const y0 = new Date(day0.getTime() - 864e5), yCut = new Date(y0.getTime() + (now - day0));
  const f = d => d.toISOString().slice(0, 19).replace('T', ' ');
  const mx = await dms.q(`SELECT max(id) m FROM \`${SCHEMA}\`.\`${JOURNEYS.activation.table}\``);
  const lo = Math.max(0, Number((mx[0] || {}).m || 0) - 80000);   // ≈ months of activations, cheap PK range
  const [a] = await dms.qSlow(
    `SELECT SUM(ts >= ?) attempts, SUM(ts >= ? AND code = '00') ok,
            COUNT(DISTINCT CASE WHEN ts >= ? THEN dealer END) dealers,
            SUM(ts >= ? AND ts < ?) y_attempts, SUM(ts >= ? AND ts < ? AND code = '00') y_ok,
            COUNT(DISTINCT CASE WHEN ts >= ? AND ts < ? THEN dealer END) y_dealers
       FROM (SELECT \`${C.at}\` ts, \`${C.code}\` code, \`${C.dealer}\` dealer
               FROM \`${SCHEMA}\`.\`${JOURNEYS.activation.table}\` WHERE id > ?) t`,
    [f(day0), f(day0), f(day0), f(y0), f(yCut), f(y0), f(yCut), f(y0), f(yCut), lo], 30000);
  const N = v => Number(v || 0);
  const t = { attempts: N(a.attempts), activated: N(a.ok), dealers: N(a.dealers) };
  const y = { attempts: N(a.y_attempts), activated: N(a.y_ok), dealers: N(a.y_dealers) };
  return { ok: true, source: `${SCHEMA}.${JOURNEYS.activation.table} (DMS channel — all dealers)`,
    success_code: '00', today: t, yesterday_same_time: y,
    pace: y.attempts ? Math.round(100 * t.attempts / y.attempts) : null };
}

/* ---- browse: ALL calls of one journey, latest first — live on Clara, by PK (instant on any
 * size), masked, cursor-paged. This is the "show me the data, not just failures" view. ---- */
async function browse(key, beforeId, limit, opts = {}) {
  if (!JOURNEYS[key]) throw new Error('unknown journey');
  const r = await resolve(key);
  if (!r.ok) throw new Error(`${key}: ${r.why || 'unresolved'}`);
  const um = !!opts.unmask;   // capability + ?unmask=1 verified by the ROUTE, audited there
  const ids = Array.isArray(opts.ids) ? opts.ids.map(Number).filter(Number.isFinite).slice(0, 150) : null;
  const codeF = opts.code != null && String(opts.code).trim() !== '' ? String(opts.code).trim().slice(0, 40) : null;
  const C = r.cols, L = Math.min(200, Math.max(20, Number(limit) || 100));
  const sel = ['`id`', `\`${C.at}\` AS at`]
    .concat(C.dealer ? [`\`${C.dealer}\` AS dealer`] : []).concat(C.msisdn ? [`\`${C.msisdn}\` AS msisdn`] : [])
    .concat(C.customer ? [`\`${C.customer}\` AS customer`] : []).concat(C.code ? [`\`${C.code}\` AS code`] : [])
    .concat(C.message ? [`\`${C.message}\` AS message`] : []).concat(C.ref ? [`\`${C.ref}\` AS ref`] : [])
    .concat(C.api ? [`\`${C.api}\` AS api`] : []).join(', ');
  let cond, params;
  if (ids && ids.length) { cond = `WHERE id IN (${ids.join(',')})`; params = []; }
  else {
    const parts = [], ps = [];
    if (beforeId) { parts.push('id < ?'); ps.push(Number(beforeId)); }
    if (codeF && C.code) {
      // code filter walks the PK backwards until L matches — bound the walk so a rare code on an
      // 8M-row table cannot become a full scan (recent 2M ids ≈ weeks of any journey's traffic)
      const mx = await dms.q(`SELECT max(id) m FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\``);
      parts.push(`\`${C.code}\` = ?`); ps.push(codeF);
      parts.push('id > ?'); ps.push(Math.max(0, Number((mx[0] || {}).m || 0) - 2000000));
    }
    cond = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    params = ps;
  }
  const rows = await dms.qSlow(
    `SELECT ${sel} FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\` ${cond} ORDER BY id DESC LIMIT ${L}`, params, 25000);
  const pii = (v, n) => v == null ? null : (um ? String(v).slice(0, n) : maskNum(String(v).slice(0, n)));
  return { ok: true, key, label: JOURNEYS[key].label, source: r.table, unmasked: um, code_filter: codeF,
    tz_note: r.tzShiftMs ? 'source table writes KSA local time — normalized to UTC (-3h)' : null,
    rows: rows.map(row => ({ id: Number(row.id), at: atFix(r, row.at),
      dealer: row.dealer == null ? null : String(row.dealer).slice(0, 60),
      msisdn: pii(row.msisdn, 40), customer: pii(row.customer, 40),
      code: row.code == null ? null : String(row.code).slice(0, 40),
      message: pii(row.message, 220),
      ref: row.ref == null ? null : String(row.ref).slice(0, 80),
      api: row.api == null ? null : String(row.api).slice(0, 120), err: isFail(row.code, row.message) })),
    next_before: (!ids && rows.length === L) ? Number(rows[rows.length - 1].id) : null };
}

/* ---- dealer API timeline: one dealer's calls merged across every journey ledger, newest
 * first — "what did this dealer DO", endpoint + outcome per call; each hit opens the full-row
 * popup for request fields + response. Only tables where the dealer column is INDEXED or the
 * table is small (same discipline as trace — no full scans on 2M-row tables). ---- */
async function dealerTimeline(dealerQ, unmask) {
  const dq = String(dealerQ || '').trim().slice(0, 60);
  if (dq.length < 3) throw new Error('dealer code required');
  const um = !!unmask;
  const hits = [], scanned = [], skipped = [];
  for (const key of Object.keys(JOURNEYS)) {
    const r = await resolve(key);
    if (!r.ok || !r.cols.dealer) { skipped.push({ key, why: r.ok ? 'no dealer column' : (r.why || '') }); continue; }
    const C2 = r.cols;
    const idx = await dms.indexedCols(SC(key), JOURNEYS[key].table);
    const stats = await dms.q(
      `SELECT table_rows n FROM information_schema.tables WHERE table_schema=? AND table_name=?`,
      [SC(key), JOURNEYS[key].table]).catch(() => [{ n: 9e9 }]);
    const small = Number((stats[0] || {}).n || 9e9) < 400000;
    if (!small && !idx.has(C2.dealer.toLowerCase())) { skipped.push({ key, why: 'dealer column not indexed' }); continue; }
    scanned.push(key);
    try {
      const rows = await dms.qSlow(
        `SELECT id, \`${C2.at}\` at${C2.code ? `, \`${C2.code}\` code` : ''}${C2.api ? `, \`${C2.api}\` api` : ''}` +
        `${C2.message ? `, \`${C2.message}\` message` : ''}${C2.ref ? `, \`${C2.ref}\` ref` : ''}` +
        `${C2.msisdn ? `, \`${C2.msisdn}\` msisdn` : ''}${C2.plan ? `, \`${C2.plan}\` plan` : ''}` +
        ` FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\` WHERE \`${C2.dealer}\` = ? ORDER BY id DESC LIMIT 25`,
        [dq], 20000);
      const pii = (v, n2) => v == null ? null : (um ? String(v).slice(0, n2) : maskNum(String(v).slice(0, n2)));
      for (const row of rows) hits.push({
        journey: key, label: JOURNEYS[key].label, icon: JOURNEYS[key].icon, src_id: Number(row.id),
        at: atFix(r, row.at), code: row.code == null ? null : String(row.code).slice(0, 40),
        api: row.api == null ? null : String(row.api).slice(0, 120),
        message: pii(row.message, 160), msisdn: pii(row.msisdn, 40),
        plan: row.plan == null ? null : String(row.plan).slice(0, 60),
        ref: row.ref == null ? null : String(row.ref).slice(0, 80), err: isFail(row.code, row.message)
      });
    } catch (e) { skipped.push({ key, why: 'query: ' + e.message.slice(0, 60) }); }
  }
  hits.sort((a, z) => new Date(z.at) - new Date(a.at));
  return { ok: true, dealer: dq, unmasked: um, hits: hits.slice(0, 150), scanned, skipped };
}

/* ---- a dealer's activations in a range — for the timelines walker. Bounded PK-range scan
 * (last ~120k ids ≈ months of activations) with equality filter; the commission-report path
 * used dealer LIKE over the time window = unindexed multi-second scan per click (1 Sep). ---- */
async function dealerActs(dealerQ, fromIso, toIso) {
  const dq = String(dealerQ || '').trim().slice(0, 60);
  if (dq.length < 3) throw new Error('dealer code required');
  const f0 = fromIso ? new Date(fromIso).getTime() : -Infinity;
  const t0 = toIso ? new Date(toIso).getTime() : Infinity;
  /* every journey whose ledger carries BOTH a dealer and an msisdn column (msisdn is what the
   * timeline resolves by). Bounded PK window per table, run in parallel — wall time ≈ slowest. */
  const keys = Object.keys(JOURNEYS);
  const per = await Promise.all(keys.map(async key => {
    try {
      const r = await resolve(key);
      if (!r.ok || !r.cols.dealer || !r.cols.msisdn) return [];
      const C = r.cols;
      const mx = await dms.q(`SELECT max(id) m FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\``);
      const lo = Math.max(0, Number((mx[0] || {}).m || 0) - 120000);
      const rows = await dms.qSlow(
        `SELECT id, \`${C.at}\` at, \`${C.msisdn}\` ms${C.plan ? `, \`${C.plan}\` plan` : ''}${C.code ? `, \`${C.code}\` code` : ''}${C.api ? `, \`${C.api}\` api` : ''}
           FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\`
          WHERE id > ? AND \`${C.dealer}\` = ? ORDER BY id DESC LIMIT 80`, [lo, dq], 25000);
      return rows.filter(row => row.ms != null && String(row.ms).replace(/\D/g, '').length >= 8)
        .map(row => ({ journey: key, label: JOURNEYS[key].label, icon: JOURNEYS[key].icon,
        rid: Number(row.id), at: atFix(r, row.at),
        plan: row.plan == null ? null : String(row.plan).slice(0, 60),
        code: row.code == null ? null : String(row.code).slice(0, 40) }));
    } catch (e) { return []; }
  }));
  const acts = per.flat()
    .filter(x => { const t = new Date(x.at).getTime(); return t >= f0 && t <= t0; })
    .sort((a, z) => new Date(z.at) - new Date(a.at)).slice(0, 80);
  return { ok: true, dealer: dq, acts,
    note: acts.length ? null : 'no ledger rows for this exact dealer key inside the range (recent-id windows)' };
}

/* ---- one row, EVERY column — the "all details" view behind a table row. Live by PK (instant),
 * every value masked unless the route verified the capability. ---- */
async function rowDetail(key, id, unmask) {
  if (!JOURNEYS[key]) throw new Error('unknown journey');
  const r = await resolve(key);
  if (!r.ok) throw new Error(`${key}: ${r.why || 'unresolved'}`);
  const rows = await dms.qSlow(
    `SELECT * FROM \`${SC(key)}\`.\`${JOURNEYS[key].table}\` WHERE id = ? LIMIT 1`, [Number(id)], 15000);
  if (!rows.length) return { ok: true, found: false, key };
  const um = !!unmask;
  const fields = Object.entries(rows[0]).map(([k, v]) => ({
    k, v: v == null ? null : (um ? String(v).slice(0, 500) : maskNum(String(v).slice(0, 500)))
  }));
  const ref = r.cols.ref ? rows[0][r.cols.ref] : null;   // correlation id — not PII, feeds the trace
  // resolved identifier values — the dmsrow timeline path needs them under STABLE names,
  // whatever this ledger calls its columns (raw only when um, i.e. internal server calls)
  const idv = c => (c && rows[0][c] != null) ? (um ? String(rows[0][c]) : maskNum(String(rows[0][c]))) : null;
  return { ok: true, found: true, key, label: JOURNEYS[key].label, icon: JOURNEYS[key].icon,
    msisdn_value: idv(r.cols.msisdn), customer_value: idv(r.cols.customer),
    source: r.table, unmasked: um, ref: ref == null ? null : String(ref).slice(0, 80),
    tz_note: r.tzShiftMs ? 'NOTE: this table writes KSA local time — raw timestamps below are KSA (UTC+3)' : null,
    fields };
}

module.exports = { start, status, board, drill, trace, home, browse, rowDetail, dealerTimeline, dealerActs, JOURNEYS };
