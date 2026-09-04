#!/usr/bin/env node
/* Alert noise tuning + trigger-code seeding — answers L2 ticket TKT-000002 (Debasis).
 *
 * Based on the 14-day firing stats (top offenders by breaches-per-fire):
 *   anomaly volume signals 133-159 breaches/fire · tap_hard_down 106 · semati_flapping 105
 *   api_latency_per_api 69 · payment_web_fail 71
 * An alert re-breaching 100+ times before resolving is describing a NORMAL condition, not an
 * incident. This script raises those to realistic levels, adds min_sample guards to the
 * low-volume gateway watchdogs, downgrades chronic-state rules to watch-level, and fills in
 * the `trigger_codes` field so every alert states WHAT fires it.
 *
 * Run:  cd /apps/console/server && set -a; . ../.env; set +a && node tune-alerts.cjs [--dry-run]
 * Everything is written to audit_log (actor 'tune-alerts.cjs'). Re-runnable.
 */
const { Pool } = require('pg');
const DRY = process.argv.includes('--dry-run');

/* ---- 1. threshold / severity tuning ------------------------------------------------------ */
const TUNE = [
  // key                          patch                                                     why
  ['tap_hard_down',        { min_sample: 30, window_hours: 3 },
    'Tap does ~200 payments/month — a zero-success watchdog fires in every natural gap. Needs meaningful traffic before it can fire.'],
  ['hyperpay_hard_down',   { min_sample: 30 },
    'Same low-volume false-positive pattern, milder (12 breaches/fire).'],
  ['semati_flapping',      { severity: 'P3', threshold: 8 },
    'Worst historical offender: 304 fires / 31,820 breaches. Flapping is a state, not an incident — watch-level + higher bar.'],
  ['payment_zatca_gap',    { threshold: 1500 },
    'Backlog sits ~500 steady-state; 800 was barely above normal (122 fires).'],
  ['volume_drop',          { threshold: 0.55 },
    '90 fires and still firing — the drop bar was inside normal daily variation.'],
  ['payment_web_fail',     { min_sample: 50 },
    '71 breaches/fire — small web samples were tripping the rate rule.'],
  ['api_latency_per_api',  { min_sample: 40 },
    'Second-pass calibration: needs more traffic per API before a p95 can page.'],
  ['nafath_fail_spike',    { min_sample: 40 },
    '49 breaches/fire on a low-sample rate metric.'],
  ['recharge_fail_spike',  { min_sample: 40 },
    '67 breaches/fire — same small-sample effect.']
];

/* ---- 2. trigger codes (L2 transparency: WHAT fires this alert) --------------------------- */
const CODES = {
  semati_provider_down:      'Semati/TCC 715 (SERVICE_NOT_AVAILABLE) + 5002 · excludes 727/726/738/740 (business validation)',
  semati_flapping:           'Semati 715/5002 alternating with success · excludes business declines',
  semati_fail_storm:         'All Semati non-success codes · business (727 MOBILE_DOESNT_EXIST, 726, 738, 740) counted separately',
  nafath_fail_spike:         'Nafath authorize failures + 400-N999 transport · excludes -700 PENDING / -701 REJECTED (customer states)',
  payment_fail_storm:        'Any gateway decline (UPG/Tap/HyperPay) · business class — transport faults are in the stuck/watchdog rules',
  payment_stuck_storm:       'Gateway committed but app never finalised >30min · excludes abandonment (no commit response)',
  payment_stuck_spike:       'Same as storm, earlier tier',
  payment_duplicate:         'Same MSISDN + amount charged twice inside the dedupe window',
  payment_zatca_gap:         'Successful payments not reported to ZATCA (e-invoicing backlog)',
  payment_web_fail:          'Web-platform payment declines only (dim platform=web)',
  tap_hard_down:             'Zero successful Tap payments while traffic exists (gateway_success_volume)',
  hyperpay_hard_down:        'Zero successful HyperPay payments while traffic exists',
  upg_hard_down:             'Zero successful UPG/salam payments while traffic exists',
  bss_soap_fault_1500:       'BSS/OSB SOAP fault 1500 + OSB-382000 (read path, uil_logs)',
  activation_fail_storm_technical: 'activation_logs technical status codes (1500/5002/timeouts) · business codes (727/706/…) excluded',
  api_latency_breach:        'p95 ≥ its threshold (global 3000ms or the per-API override) — timing only, no error codes',
  api_latency_storm:         'p95 ≥ 2× its threshold',
  api_latency_per_api:       'Any single API over its own per-API override',
  api_technical_fail_spike:  'errclass TECHNICAL signatures: 1500 · 5xx · 408 · timeouts · SOAP/OSB faults · transport',
  api_technical_fail_storm:  'Same set, storm tier',
  app_ip_block_surge:        '-704 IP_RETRIES_EXCEEDED (IpRetrial concern: recharge voucher/validate_details)',
  app_ip_block_storm:        '-704 IP_RETRIES_EXCEEDED, storm tier',
  app_crash_surge:           '-501 WITH a Ruby exception_class (unhandled crashes) · plain -501 counted as backend instead',
  app_auth_fail_surge:       '-201/-202/-203/-204/-205 tokens · -300/-301 login · -612 password',
  app_backend_err_surge:     '-500 BACKEND_NOT_REACHABLE · -501 (no exception) · -702 TCC · -20003 Optiva',
  otp_verify_drop:           'otps sent→verified ratio (SMS delivery) · not an error code — customers not receiving SMS',
  otp_verify_collapse:       'Same metric, collapse tier',
  sms_gateway_unreachable:   'Unifonic probe transport failures (timeout/DNS/refused) from the API hosts · any HTTP answer = reachable',
  eligibility_deny_rate:     'Semati/Nafath eligibility denials · business class (customer not eligible)',
  volume_drop:               'Order volume vs expected — no error codes, a traffic signal',
  courier_backlog:           'Delivery requests created but not picked up by the courier',
  delivery_fail_rate:        'Courier-reported delivery failures/returns'
};

(async () => {
  const p = new Pool({ connectionString: process.env.CONSOLE_DATABASE_URL, max: 1 });
  const log = [];
  const audit = async (action, target, detail) => {
    if (DRY) return;
    try { await p.query(`INSERT INTO audit_log (actor, role, action, target, detail) VALUES ($1,$2,$3,$4,$5)`,
      ['tune-alerts.cjs', 'system', action, target, JSON.stringify(detail)]); } catch (e) {}
  };

  // 1. thresholds
  for (const [key, patch, why] of TUNE) {
    const cur = (await p.query(`SELECT key, threshold, severity, min_sample, window_hours FROM alert_rules WHERE key=$1`, [key])).rows[0];
    if (!cur) { log.push(`  ~ ${key.padEnd(32)} NOT FOUND (skipped)`); continue; }
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
    vals.push(key);
    if (!DRY) await p.query(`UPDATE alert_rules SET ${sets.join(',')}, updated_at=now() WHERE key=$${vals.length}`, vals);
    await audit('rule.tune', key, { patch, why, before: cur });
    log.push(`  ✓ ${key.padEnd(32)} ${JSON.stringify(patch)}`);
  }

  // 2. trigger codes
  let codeN = 0;
  for (const [key, codes] of Object.entries(CODES)) {
    const r = DRY ? { rowCount: 1 } : await p.query(`UPDATE alert_rules SET trigger_codes=$1, updated_at=now() WHERE key=$2`, [codes, key]);
    if (r.rowCount) codeN++;
  }
  await audit('rule.trigger_codes', 'bulk', { rules: codeN });
  log.push(`  ✓ trigger_codes set on ${codeN} rules`);

  // 3. anomaly engine — the 4 chronic volume signals (config lives in console_settings)
  const cur = (await p.query(`SELECT value FROM console_settings WHERE key='anomaly'`)).rows[0];
  const cfg = Object.assign({ enabled: true, z: 3.5, minSample: 30, lookbackWeeks: 4, raiseAlerts: true,
    gatewayAlerts: true, volFloor: 60, signals: {} }, (cur && cur.value) || {});
  cfg.z = 5.0;            // 3.5σ tripped on ordinary daily dips; a real collapse is 8-15σ
  cfg.volFloor = 300;     // quiet-hour lulls no longer page
  cfg.signals = cfg.signals || {};
  for (const j of ['onboarding', 'checkout', 'eligibility', 'nafath', 'payment', 'activation', 'semati', 'delivery', 'change_plan']) {
    cfg.signals[`${j}.volume`] = Object.assign({}, cfg.signals[`${j}.volume`], { maxSeverity: 'P3' });
  }
  if (!DRY) await p.query(
    `INSERT INTO console_settings (key, value) VALUES ('anomaly', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(cfg)]);
  await audit('anomaly.tune', 'global', { z: cfg.z, volFloor: cfg.volFloor, volume_signals_capped: 'P3' });
  log.push(`  ✓ anomaly engine: z 3.5→5.0 · volFloor 60→300 · all *.volume capped P3`);

  console.log(`\n${DRY ? 'DRY RUN — nothing written' : 'Applied'} (audited as tune-alerts.cjs):\n${log.join('\n')}\n`);
  const open = (await p.query(`SELECT count(*)::int n FROM alerts WHERE status='open'`)).rows[0].n;
  console.log(`open alerts right now: ${open} — chronic ones auto-resolve on the next evaluation once they no longer breach.\n`);
  await p.end();
})().catch(e => { console.error('tune failed:', e.message); process.exit(1); });
