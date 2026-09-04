#!/usr/bin/env node
/* Server-152 connectivity preflight for the Salam Digital Console + Yusr chatbot.
 * Pure Node (no deps) — run on 152:   node connectivity-check.cjs
 * Tests every network flow the console needs, prints PASS/FAIL + the SOC ticket line for each failure.
 * Read-only: TCP connect + immediate close, no data sent. ~30s total.
 */
const net = require('net');
const dns = require('dns');

const TIMEOUT = 6000;

// ── The flows the console stack needs from 172.31.38.152 ──────────────────────
const CHECKS = [
  // DATABASE (pick one path; test both)
  { group: 'DB', host: '172.31.15.121', port: 5432, label: 'Prod Postgres (prod-sync source / candidate app DB)', need: 'REQUIRED' },

  // OSB / UIL logs (BSS read-fault monitoring) — host TBD from Debasis; candidates:
  { group: 'OSB', host: '172.31.43.72', port: 3306, label: 'Clara MySQL node (uil_logs candidate)', need: 'REQUIRED for BSS/OSB monitoring' },
  { group: 'OSB', host: '172.16.1.115', port: 3306, label: 'Clara MySQL VIP (uil_logs candidate)', need: 'alt of above' },

  // API GW connectivity probe targets (the #apigw live map)
  { group: 'APIGW', host: '172.31.43.9',  port: 8443, label: 'API GW GWP01', need: 'REQUIRED for APIGW probe' },
  { group: 'APIGW', host: '172.31.43.10', port: 8443, label: 'API GW GWP02', need: 'REQUIRED for APIGW probe' },
  { group: 'APIGW', host: '172.31.42.23', port: 8443, label: 'API GW GWP03', need: 'nice-to-have (firewalled from console segment today)' },
  { group: 'APIGW', host: '172.31.42.24', port: 8443, label: 'API GW GWP04', need: 'nice-to-have' },
  { group: 'APIGW', host: '172.31.45.1',  port: 443,  label: 'LB VIP apigw.salammobile.sa', need: 'nice-to-have (DMZ-only today)' },
  { group: 'APIGW', host: '172.31.43.61', port: 3000, label: 'APIGW DMS entry', need: 'REQUIRED for APIGW probe' },

  // API-log collector SSH targets (apiLogCollector.js pulls api_logger.production.log from the
  // api hosts). Placeholder IPs — override with the real "server 17"/"server 18" via env:
  //   API_LOG_HOSTS=1.2.3.4,5.6.7.8 node connectivity-check.cjs
  ...String(process.env.API_LOG_HOSTS || '172.31.43.17,172.31.43.18').split(',')
    .map(s => s.trim()).filter(Boolean)
    .map(h => ({ group: 'APILOG', host: h, port: 22, label: 'api host SSH (api_logger.production.log collector)', need: 'REQUIRED for API-log collector' })),

  // Log-collection SSH targets from the DMS HLD (dmshld.html) — for extending the log
  // collectors beyond 43.17/18. Each needs: firewall 152→host:22 + read-only account + key.
  { group: 'LOGS-HLD', host: '172.31.43.9',   port: 22, label: 'APIGW GWP01 — gateway access logs', need: 'REQUIRED for APIGW log collector' },
  { group: 'LOGS-HLD', host: '172.31.43.10',  port: 22, label: 'APIGW GWP02 — gateway access logs', need: 'REQUIRED for APIGW log collector' },
  { group: 'LOGS-HLD', host: '172.31.43.61',  port: 22, label: 'APIGW DMS entry (:3000 app) — entry logs', need: 'nice-to-have (front door of DMS)' },
  { group: 'LOGS-HLD', host: '172.31.43.136', port: 22, label: 'DMS app-front/business tier n1 (43.136–139) — FTTH/TYGO QR app logs (OTP dispatch!)', need: 'REQUIRED to cover Digital-Sales-QR OTP journeys (Unifonic ticket blind spot)' },
  { group: 'LOGS-HLD', host: '172.31.43.137', port: 22, label: 'DMS app-front/business tier n2', need: 'as above' },
  { group: 'LOGS-HLD', host: '172.31.43.148', port: 22, label: 'SADAD payment driver app — payment logs', need: 'nice-to-have (SADAD correlation)' },

  // ServiceNow (CST ticket correlation in Yusr + alert-detail)
  { group: 'ITSM', host: 'servicehub.salam.sa', port: 443, label: 'ServiceNow (read-only Table API)', need: 'REQUIRED for CST ticket correlation' },

  // Internal SMTP (email notifications / OTP login mail)
  { group: 'SMTP', host: '172.16.1.115', port: 25, label: 'Internal SMTP relay (HLD messaging host — confirm)', need: 'REQUIRED for email/OTP' },

  // EXTERNAL — expected to FAIL on 152 (no internet). Documents which console features degrade.
  { group: 'EXTERNAL', host: 'graph.facebook.com', port: 443, label: 'WhatsApp Cloud API (chatops)', need: 'expected FAIL → WhatsApp alerts OFF unless internal proxy' },
  { group: 'EXTERNAL', host: 'api.tap.company', port: 443, label: 'Tap reconciliation API', need: 'expected FAIL → Tap recon OFF unless proxy' },
  { group: 'EXTERNAL', host: 'outlook.office.com', port: 443, label: 'Teams webhook (chatops)', need: 'expected FAIL → Teams alerts OFF unless proxy' },
];

function tcp(host, port) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    let done = false;
    const fin = (state, code) => { if (done) return; done = true; try { s.destroy(); } catch (_) {}
      resolve({ state, code, ms: Date.now() - t0 }); };
    s.setTimeout(TIMEOUT);
    s.on('connect', () => fin('OPEN'));
    s.on('timeout', () => fin('TIMEOUT', 'ETIMEDOUT'));
    s.on('error', e => fin(e.code === 'ECONNREFUSED' ? 'REFUSED' : 'BLOCKED', e.code));
  });
}
const lookup = h => new Promise(r => net.isIP(h) ? r(h) : dns.lookup(h, (e, a) => r(e ? null : a)));

(async () => {
  console.log(`\n=== Salam Console — 152 connectivity preflight === ${new Date().toISOString()}\n`);
  const rows = [];
  for (const c of CHECKS) {
    const addr = await lookup(c.host);
    if (!addr) { rows.push({ ...c, state: 'DNS-FAIL', ms: '-' }); continue; }
    const r = await tcp(addr, c.port);
    rows.push({ ...c, addr, ...r });
  }
  let lastGroup = '';
  for (const r of rows) {
    if (r.group !== lastGroup) { console.log(`\n[${r.group}]`); lastGroup = r.group; }
    const ok = r.state === 'OPEN';
    const mark = ok ? 'PASS ' : (r.state === 'REFUSED' ? 'PORT? ' : 'FAIL ');
    console.log(`  ${mark} ${String(r.host).padEnd(24)} :${String(r.port).padEnd(5)} ${r.state.padEnd(8)} ${ok ? r.ms + 'ms' : (r.code || '')}  — ${r.label}`);
  }
  console.log('\n=== SOC ticket lines (copy the FAIL/TIMEOUT rows that are REQUIRED) ===');
  for (const r of rows) {
    if (r.state !== 'OPEN' && r.group !== 'EXTERNAL' && /REQUIRED/.test(r.need))
      console.log(`  ALLOW 172.31.38.152 -> ${r.addr || r.host}:${r.port}/tcp   # ${r.label}`);
  }
  console.log('\nNotes: REFUSED = host reachable, wrong port (no SOC ticket — find the right port).');
  console.log('       TIMEOUT/BLOCKED = firewall — raise with SOC. EXTERNAL fails are EXPECTED (no internet on 152).\n');
})();
