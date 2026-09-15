/* OSB LOG ARCHIVE — importer + correlation queries (3 Sep 2026).
 * The OSB team delivers WebLogic log archives over SFTP (/sftp_data/uploads/osb_serverX_logs_*.tar.gz,
 * sha256-verified). Two file kinds inside (discovered 3 Sep, both days verified):
 *
 *  access.log*  — WebLogic extended access log, machine-parseable:
 *                 c-ip date time time-taken cs-method ctx-ecid ctx-rid cs-uri sc-status bytes
 *                 Covers BOTH the UIL-facing proxies (/bss/subscription/…, same paths as the UIL
 *                 tier) and the BSS backends they fan into (RedkneeSoap_v3_0 = Optiva, UIM,
 *                 Siebel/BRM bridges, Arqami…). OSB answers HTTP 200 even for SOAP faults —
 *                 status is nearly useless; faults live in the .out payloads.
 *  osb_serverN.out* — oracle.osb.logging.pipeline records with FULL payloads: MSISDNs, ECID
 *                 headers (X-ORACLE-DMS-ECID — joins to access rows), OSB-382000 / <faultcode> /
 *                 errorCode 1500 details, plus ZATCA→BRM, SADAD notifications, Siebel flows.
 *
 * CORRELATION KEYS (proved by discovery): uilTransactionId / Sleuth ids DO NOT appear in OSB —
 * the chain is msisdn+time → pipeline record → ECID → access row (uri/latency/backend), and
 * upward to the UIL tier by uri+timestamp window.
 *
 * USAGE (on 152, after extracting the archives):
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/osbArchive.js import /tmp/osb        # parses + loads into console PG (idempotent)
 *   node src/osbArchive.js status
 * Import is batch-inserted, per-file try/catch (errors travel), and safe to re-run: rows carry
 * a unique key and duplicates are skipped. Raw payloads are stored TRUNCATED (600 chars; 4000
 * for fault records) — enough for diagnosis, bounded for the DB.
 * PII: Troubleshoot surfaces are L2-gated and unmasked by decision (Yosri, 3 Sep). */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const db = require('./db');

const DEFAULT_UPLOAD_ROOTS = ['/uploads', '/sftp_data/uploads', '/apps/unified/uploads'];
const OSB_STACK = [
  { key: 'zatca',   label: 'ZATCA e-invoicing',        re: /zatca/i },
  { key: 'redknee', label: 'Redknee · charging (ECE)', re: /redknee/i },
  { key: 'uim',     label: 'UIM · inventory',          re: /uim/i },
  { key: 'arqami',  label: 'Arqami',                   re: /arqami/i },
  { key: 'siebel',  label: 'Siebel CRM',               re: /siebel|appcrm/i },
  { key: 'brm',     label: 'BRM · billing',            re: /brm/i },
  { key: 'proxy',   label: 'OSB proxy (UIL-facing)',   re: /^\/(bss|uil)\/|^\/get[a-z]+(subscription|account|balance)/i }
];
function componentOf(s) {
  const t = String(s || '');
  for (const c of OSB_STACK) if (c.re.test(t)) return c.key;
  return 'other';
}

const OSB_STORIES = [
  { key: 'recharge', label: 'Recharge / voucher', sql: 'recharge|voucher|TransactionService|create-subscription-transaction',
    re: /recharge|voucher|TransactionService|create-subscription-transaction/i,
    value: 'Was a recharge or voucher update seen by charging, and did it fault or run slow?' },
  { key: 'mnp', label: 'MNP porting', sql: 'mnp|port.?in|port.?out|ported|PortOut|PortIn',
    re: /mnp|port.?in|port.?out|ported|PortOut|PortIn/i,
    value: 'Port-in / port-out requests, acknowledgements, and provisioning callbacks seen on OSB.' },
  { key: 'remedy', label: 'Remedy tickets', sql: 'remedy|ticket|CreateCustomerOB',
    re: /remedy|ticket|CreateCustomerOB/i,
    value: 'Ticket creation calls and AR System faults that L2 can compare with Remedy itself.' },
  { key: 'onboarding_inventory', label: 'Onboarding / inventory', sql: 'reserve|reservation|ResourceReserve|NumberReserve|check-mobile-reservation|number-reserve|MobileNumberService|CardPackageService|GeneralProvisioning',
    re: /reserve|reservation|ResourceReserve|NumberReserve|check-mobile-reservation|number-reserve|MobileNumberService|CardPackageService|GeneralProvisioning/i,
    value: 'Number reservation, UIM inventory, SIM/package and provisioning calls behind onboarding.' },
  { key: 'billing_invoice', label: 'Billing / invoices', sql: 'zatca|invoice|GenerateInvoice|billNo|BRM_INVOICES|list-invoices',
    re: /zatca|invoice|GenerateInvoice|billNo|BRM_INVOICES|list-invoices/i,
    value: 'Invoice generation and BRM/ZATCA handoffs, including payload acknowledgements.' },
  { key: 'sadad_payment', label: 'SADAD / payment notices', sql: 'sadad|payment|bill.?pay|biller',
    re: /sadad|payment|bill.?pay|biller/i,
    value: 'Payment notification traffic that reaches OSB, mostly useful for reconciling BSS-side notices.' },
  { key: 'nafath', label: 'Nafath authorization', sql: 'nafath|NPACT|ActivateMobileCompany',
    re: /nafath|NPACT|ActivateMobileCompany/i,
    value: 'Nafath/NPACT authorization requests and responses when they are present in OSB payload logs.' },
  { key: 'balance_bundle', label: 'Balance / bundle reads', sql: 'balance|bundle|execute-account-blnc-query|AccountService',
    re: /balance|bundle|execute-account-blnc-query|AccountService/i,
    value: 'Balance and bundle reads; useful when the app shows stale or missing balance/package data.' },
  { key: 'plan_options', label: 'Plan / option changes', sql: 'price-plan|ShowPlan|update-subscription-price-plan|plan.?option',
    re: /price-plan|ShowPlan|update-subscription-price-plan|plan.?option/i,
    value: 'Plan catalogue reads and price-plan option updates, including slow or failed option changes.' },
  { key: 'profile_reads', label: 'Subscription profile reads', sql: 'get-subscription-profile|GetSubscriptionProfile|SubscriptionService|AppCrm/home|account-profile',
    re: /get-subscription-profile|GetSubscriptionProfile|SubscriptionService|AppCrm\/home|account-profile/i,
    value: 'Profile/account reads; useful as proof BSS saw the subscriber, but often not a failed journey by itself.' },
  { key: 'other', label: 'Other OSB traffic', sql: null, re: /$a/,
    value: 'Traffic outside the named customer journeys; keep for L2 drill-down and unknown patterns.' }
];
const storyByKey = Object.fromEntries(OSB_STORIES.map(s => [s.key, s]));
function storyText(row) {
  const r = row || {};
  return [r.uri, r.pipeline, r.stage, r.label, r.fault_kind, r.component, r.payload].filter(Boolean).join(' ');
}
function storyOf(row) {
  const t = storyText(row);
  for (const s of OSB_STORIES) if (s.key !== 'other' && s.re.test(t)) return s;
  return storyByKey.other;
}
function storySqlCase(expr) {
  return 'CASE ' + OSB_STORIES.filter(s => s.sql).map(s =>
    `WHEN ${expr} ~* '${s.sql.replace(/'/g, "''")}' THEN '${s.key}'`).join(' ') + ` ELSE 'other' END`;
}

function normMsisdn(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '966' + d;
  return d;
}
function extractMsisdns(text) {
  const out = new Set();
  const re = /(?:\+?9665\d{8}|\b05\d{8}\b|\b5\d{8}\b)/g;
  for (const m of String(text || '').match(re) || []) {
    const n = normMsisdn(m);
    if (/^9665\d{8}$/.test(n)) out.add(n);
  }
  return [...out].slice(0, 12);
}
function extractEcid(text) {
  const t = String(text || '');
  const pats = [
    /X-ORACLE-DMS-ECID"?\s+value="([^"]+)"/i,
    /X-ORACLE-DMS-ECID\s*[:=]\s*"?([^"\s,;<>]+)/i,
    /\becid\s*[:=]\s*"?([^"\s,;<>]+)/i
  ];
  for (const p of pats) {
    const m = p.exec(t);
    if (m && m[1]) return m[1].slice(0, 120);
  }
  return null;
}
function extractTxnIds(text) {
  const t = String(text || '');
  const out = new Set();
  const re = /\b(?:uilTransactionId|transactionId|transaction_id|txnId|requestId|request_id|correlationId|messageId)\b[^A-Za-z0-9_.-]{0,30}([A-Za-z0-9_.:-]{6,90})/gi;
  for (const m of t.matchAll(re)) {
    const v = String(m[1] || '').replace(/[<>"']/g, '').slice(0, 90);
    if (v && !/^9665\d{8}$/.test(v)) out.add(v);
  }
  for (const m of t.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) out.add(m[0]);
  return [...out].slice(0, 12);
}
function extractIdentifiers(text) {
  const t = String(text || '');
  const ids = { msisdns: extractMsisdns(t), national_ids: [], account_ids: [], order_refs: [] };
  for (const m of t.match(/\b[12]\d{9}\b/g) || []) ids.national_ids.push(m);
  for (const m of t.match(/\b\d{8,12}\b/g) || []) {
    if (!ids.national_ids.includes(m) && !ids.msisdns.includes(normMsisdn(m))) ids.account_ids.push(m);
  }
  for (const m of t.match(/\b(?:SO|ORD|ORDER|ACT|REQ)[-_]?[A-Za-z0-9]{5,30}\b/gi) || []) ids.order_refs.push(m);
  ids.national_ids = [...new Set(ids.national_ids)].slice(0, 8);
  ids.account_ids = [...new Set(ids.account_ids)].slice(0, 12);
  ids.order_refs = [...new Set(ids.order_refs)].slice(0, 8);
  return ids;
}
function stableHash(parts) {
  return crypto.createHash('sha256').update(parts.map(x => String(x == null ? '' : x)).join('\x1f')).digest('hex');
}
function readTextMaybeGz(file) {
  const buf = fs.readFileSync(file);
  return /\.gz$/i.test(file) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

/* ---------- schema ---------- */
let _ensured = false;
async function ensure() {
  if (_ensured) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS osb_access_events (
    id bigserial PRIMARY KEY, ts timestamptz NOT NULL, server text, c_ip text, method text,
    ecid text, uri text, qs_msisdn text, status int, ms int, bytes bigint, batch text)`);
  await db.console.query(`ALTER TABLE osb_access_events ADD COLUMN IF NOT EXISTS component text`);
  await db.console.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_osb_acc ON osb_access_events (ecid, uri, ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_ts ON osb_access_events (ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_uri ON osb_access_events (uri, ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_comp ON osb_access_events (component, ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_acc_qsms ON osb_access_events (qs_msisdn, ts) WHERE qs_msisdn IS NOT NULL`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS osb_pipeline_events (
    id bigserial PRIMARY KEY, ts timestamptz NOT NULL, server text, pipeline text, stage text,
    direction text, label text, ecid text, msisdns text[], fault boolean NOT NULL DEFAULT false,
    fault_kind text, payload text, batch text)`);
  await db.console.query(`ALTER TABLE osb_pipeline_events ADD COLUMN IF NOT EXISTS component text`);
  await db.console.query(`ALTER TABLE osb_pipeline_events ADD COLUMN IF NOT EXISTS txn_ids text[]`);
  await db.console.query(`ALTER TABLE osb_pipeline_events ADD COLUMN IF NOT EXISTS identifiers jsonb`);
  await db.console.query(`ALTER TABLE osb_pipeline_events ADD COLUMN IF NOT EXISTS event_hash text`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ts ON osb_pipeline_events (ts)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ms ON osb_pipeline_events USING gin (msisdns)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ecid ON osb_pipeline_events (ecid)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_fault ON osb_pipeline_events (ts) WHERE fault`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_txn ON osb_pipeline_events USING gin (txn_ids)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_ident ON osb_pipeline_events USING gin (identifiers)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_osb_pipe_comp ON osb_pipeline_events (component, ts)`);
  await db.console.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_osb_pipe_hash ON osb_pipeline_events (event_hash) WHERE event_hash IS NOT NULL`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS osb_archive_batches (
    id bigserial PRIMARY KEY, archive text UNIQUE NOT NULL, sha256 text, sha256_ok boolean,
    size_bytes bigint, imported_at timestamptz NOT NULL DEFAULT now(), files int,
    access_rows bigint, pipeline_rows bigint, window_lo timestamptz, window_hi timestamptz,
    errors jsonb)`);
  _ensured = true;
}

/* ---------- parsers ---------- */
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/* "<Sep 1, 2026 12:00:28,902 AM AST>" → ISO with the +03:00 the logs run in */
function wlTs(s) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2}),(\d{3}) (AM|PM)/.exec(s);
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[8] === 'PM') h += 12;
  const d = new Date(Date.UTC(Number(m[3]), MON[m[1]], Number(m[2]), h - 3, Number(m[5]), Number(m[6]), Number(m[7])));
  return isNaN(d) ? null : d.toISOString();
}

function parseAccessFile(file, server, batch) {
  const rows = [];
  const txt = readTextMaybeGz(file);
  for (const line of txt.split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 9) continue;
    // c-ip date time taken method ecid rid uri status bytes
    const ts = `${p[1]}T${p[2]}+03:00`;
    const uriFull = p[7] || '';
    const q = /[?&]msisdn=(\d{9,15})/.exec(uriFull);
    rows.push({ ts, server, c_ip: p[0], method: p[4], ecid: p[5],
      uri: uriFull.replace(/\?.*$/, '').slice(0, 200), qs_msisdn: q ? normMsisdn(q[1]) : null,
      status: Number(p[8]) || null, ms: Math.round(parseFloat(p[3]) * 1000) || 0,
      bytes: Number(p[9]) || null, batch, component: componentOf(uriFull) });
  }
  return rows;
}

const FAULT_RE = /OSB-382000|<faultcode|errorCode>\s*1500|<soapenv:Fault|<soap:Fault/i;
function parseOutFile(file, server, batch) {
  const txt = readTextMaybeGz(file);
  const rows = [];
  // split on the WebLogic record marker "<Mon D, YYYY …>"; spring-style lines are kept inside
  // the preceding record's payload (they are continuations of the stream, e.g. SADAD controller)
  const parts = txt.split(/\n(?=<[A-Z][a-z]{2} \d{1,2}, 20\d{2} )/);
  for (const rec of parts) {
    const ts = wlTs(rec.replace(/^</, ''));
    if (!ts) continue;
    // "< [Pipeline, request-id, Stage, REQUEST] label: payload>"
    const hm = /<\s*\[([^,\]]+),\s*([^,\]]*),\s*([^,\]]*),\s*(REQUEST|RESPONSE)\]\s*([^:>]{0,120}):?/.exec(rec);
    const pipeline = hm ? hm[1].trim().slice(0, 80) : 'osb';
    const stage = hm ? hm[3].trim().slice(0, 60) : null;
    const direction = hm ? hm[4] : null;
    const label = hm ? hm[5].trim().slice(0, 140) : rec.slice(0, 100).replace(/\s+/g, ' ');
    const ecid = extractEcid(rec);
    const msisdns = extractMsisdns(rec);
    const txn_ids = extractTxnIds(rec);
    const identifiers = extractIdentifiers(rec);
    const component = componentOf(`${pipeline} ${label} ${stage || ''} ${rec.slice(0, 1200)}`);
    const fault = FAULT_RE.test(rec);
    const fault_kind = fault
      ? (/OSB-382000/.test(rec) ? 'OSB-382000' : /errorCode>\s*1500/.test(rec) ? '1500' : 'soap-fault') : null;
    const payload = rec.slice(0, fault ? 4000 : 600);
    rows.push({ ts, server, pipeline, stage, direction, label, ecid, msisdns, fault, fault_kind,
      payload, batch, component, txn_ids, identifiers,
      event_hash: stableHash([ts, server, pipeline, stage, direction, label, ecid, fault_kind, payload.slice(0, 1000)]) });
  }
  return rows;
}

/* ---------- bulk load ---------- */
async function insertBatch(table, cols, rows) {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [], ph = [];
    chunk.forEach((r, j) => {
      ph.push('(' + cols.map((c, k) => `$${j * cols.length + k + 1}`).join(',') + ')');
      cols.forEach(c => vals.push(r[c]));
    });
    const conflict = table === 'osb_access_events' ? ' ON CONFLICT (ecid, uri, ts) DO NOTHING'
      : (table === 'osb_pipeline_events' && cols.includes('event_hash')) ? ' ON CONFLICT (event_hash) WHERE event_hash IS NOT NULL DO NOTHING' : '';
    const res = await db.console.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')}${conflict}`, vals);
    n += res.rowCount || 0;
  }
  return n;
}

async function importDir(dir, opts = {}) {
  await ensure();
  const out = { files: 0, access_rows: 0, pipeline_rows: 0, errors: [] };
  const walk = d => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(dir);
  const batch = opts.batch || (path.basename(dir) + '@' + new Date().toISOString().slice(0, 10));
  for (const f of files) {
    const server = /osb_server(\d)/.exec(f) ? 'osb_server' + /osb_server(\d)/.exec(f)[1]
      : /\/s(\d)\//.exec(f) ? 'osb_server' + /\/s(\d)\//.exec(f)[1] : '?';
    try {
      const base = path.basename(f);
      if (/^access\.log/.test(base)) {
        const rows = parseAccessFile(f, server, batch);
        out.access_rows += await insertBatch('osb_access_events',
          ['ts', 'server', 'c_ip', 'method', 'ecid', 'uri', 'qs_msisdn', 'status', 'ms', 'bytes', 'batch', 'component'], rows);
        out.files++;
      } else if (/\.out\d*/.test(base)) {
        const rows = parseOutFile(f, server, batch);
        out.pipeline_rows += await insertBatch('osb_pipeline_events',
          ['ts', 'server', 'pipeline', 'stage', 'direction', 'label', 'ecid', 'msisdns', 'fault', 'fault_kind', 'payload', 'batch', 'component', 'txn_ids', 'identifiers', 'event_hash'], rows);
        out.files++;
      }
      if (out.files % 10 === 0) console.log(`[osb-archive] ${out.files} files · ${out.access_rows} access · ${out.pipeline_rows} pipeline`);
    } catch (e) { out.errors.push(`${path.basename(f)}: ${e.message.slice(0, 140)}`); }
  }
  return out;
}

/* ---------- SFTP archive discovery/import (server 152) ---------- */
function walkFiles(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 3) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, depth + 1));
    else out.push(p);
  }
  return out;
}
function shaFileFor(archive) {
  const cands = [archive + '.sha256', archive.replace(/\.tar\.gz$/i, '.sha256'), path.join(path.dirname(archive), path.basename(archive) + '.sha256')];
  return cands.find(f => fs.existsSync(f)) || null;
}
function readSha256Sidecar(file) {
  const sha = shaFileFor(file);
  if (!sha) return null;
  const m = /\b([a-f0-9]{64})\b/i.exec(fs.readFileSync(sha, 'utf8'));
  return m ? { file: sha, sha256: m[1].toLowerCase() } : { file: sha, sha256: null };
}
function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function tarEntries(file) {
  const out = execFileSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const entries = out.split('\n').map(s => s.trim()).filter(Boolean);
  const bad = entries.find(e => e.startsWith('/') || e.includes('\0') || e.split('/').includes('..'));
  if (bad) throw new Error('unsafe path inside archive: ' + bad);
  return entries;
}
async function scanArchives(roots = DEFAULT_UPLOAD_ROOTS) {
  await ensure();
  const R = Array.isArray(roots) ? roots : [roots];
  const files = R.flatMap(r => walkFiles(r)).filter(f => /\.tar\.gz$/i.test(f) && /osb/i.test(path.basename(f)));
  const names = files.map(f => path.basename(f));
  const imported = names.length ? (await db.console.query(
    `SELECT archive, sha256_ok, imported_at, files, access_rows, pipeline_rows, window_lo, window_hi,
            jsonb_array_length(coalesce(errors, '[]'::jsonb))::int AS error_count
       FROM osb_archive_batches WHERE archive = ANY($1::text[])`, [names])).rows : [];
  const byName = Object.fromEntries(imported.map(r => [r.archive, r]));
  return files.sort().map(f => {
    const st = fs.statSync(f);
    const side = readSha256Sidecar(f);
    const imp = byName[path.basename(f)] || null;
    return {
      archive: path.basename(f), path: f, size_bytes: st.size, mtime: st.mtime.toISOString(),
      sha256_file: side && side.file, sha256_expected: side && side.sha256,
      imported: !!imp, imported_at: imp && imp.imported_at, sha256_ok: imp && imp.sha256_ok,
      files: imp && imp.files, access_rows: imp && imp.access_rows, pipeline_rows: imp && imp.pipeline_rows,
      window_lo: imp && imp.window_lo, window_hi: imp && imp.window_hi, error_count: imp && imp.error_count
    };
  });
}
async function importArchive(file) {
  await ensure();
  if (!file || !fs.existsSync(file)) throw new Error('archive not found: ' + file);
  const archive = path.basename(file);
  const side = readSha256Sidecar(file);
  let actual = null, shaOk = null;
  if (side && side.sha256) {
    actual = sha256File(file);
    shaOk = actual === side.sha256;
    if (!shaOk) throw new Error(`sha256 mismatch for ${archive}: expected ${side.sha256}, got ${actual}`);
  }
  tarEntries(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osb-archive-'));
  try {
    execFileSync('tar', ['-xzf', file, '-C', tmp], { stdio: ['ignore', 'inherit', 'inherit'] });
    const r = await importDir(tmp, { batch: archive.replace(/\.tar\.gz$/i, '') });
    const w = (await db.console.query(
      `SELECT min(lo) lo, max(hi) hi FROM (
         SELECT min(ts) lo, max(ts) hi FROM osb_access_events WHERE batch=$1
         UNION ALL
         SELECT min(ts) lo, max(ts) hi FROM osb_pipeline_events WHERE batch=$1
       ) x`, [archive.replace(/\.tar\.gz$/i, '')])).rows[0] || {};
    await db.console.query(
      `INSERT INTO osb_archive_batches
         (archive, sha256, sha256_ok, size_bytes, files, access_rows, pipeline_rows, window_lo, window_hi, errors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (archive) DO UPDATE SET
         sha256=excluded.sha256, sha256_ok=excluded.sha256_ok, size_bytes=excluded.size_bytes,
         imported_at=now(), files=excluded.files, access_rows=excluded.access_rows,
         pipeline_rows=excluded.pipeline_rows, window_lo=excluded.window_lo, window_hi=excluded.window_hi,
         errors=excluded.errors`,
      [archive, actual || (side && side.sha256) || null, shaOk, fs.statSync(file).size, r.files, r.access_rows,
       r.pipeline_rows, w.lo || null, w.hi || null, JSON.stringify(r.errors || [])]);
    return { archive, sha256_ok: shaOk, ...r, window: { lo: w.lo || null, hi: w.hi || null } };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
async function importArchives(root = null) {
  const list = await scanArchives(root ? [root] : DEFAULT_UPLOAD_ROOTS);
  const out = [];
  for (const a of list.filter(x => !x.imported)) out.push(await importArchive(a.path));
  return { scanned: list.length, imported: out.length, archives: out };
}

/* ---------- queries (console PG only — instant) ---------- */
async function archiveWindow() {
  await ensure();
  const w = (await db.console.query(
    `SELECT min(lo) lo, max(hi) hi FROM (
       SELECT min(ts) lo, max(ts) hi FROM osb_access_events
       UNION ALL
       SELECT min(ts) lo, max(ts) hi FROM osb_pipeline_events
     ) x`)).rows[0] || {};
  const b = (await db.console.query(
    `SELECT archive, sha256_ok, imported_at, files, access_rows, pipeline_rows, window_lo, window_hi,
            jsonb_array_length(coalesce(errors, '[]'::jsonb))::int AS error_count
       FROM osb_archive_batches ORDER BY imported_at DESC LIMIT 1`)).rows[0] || null;
  const bc = (await db.console.query(`SELECT count(*)::int n FROM osb_archive_batches`)).rows[0] || {};
  return { lo: w.lo ? new Date(w.lo).toISOString() : null, hi: w.hi ? new Date(w.hi).toISOString() : null,
    batches: Number(bc.n || 0), latest_batch: b };
}
async function status() {
  await ensure();
  const win = await archiveWindow();
  const a = (await db.console.query(
    `SELECT count(*)::bigint n, min(ts) lo, max(ts) hi FROM osb_access_events`)).rows[0];
  const p = (await db.console.query(
    `SELECT count(*)::bigint n, count(*) FILTER (WHERE fault)::bigint faults, min(ts) lo, max(ts) hi
       FROM osb_pipeline_events`)).rows[0];
  const b = (await db.console.query(
    `SELECT archive, sha256_ok, imported_at, files, access_rows, pipeline_rows, window_lo, window_hi,
            jsonb_array_length(coalesce(errors, '[]'::jsonb))::int AS error_count
       FROM osb_archive_batches ORDER BY imported_at DESC LIMIT 20`)).rows;
  const loVals = [a.lo, p.lo].filter(Boolean).map(x => new Date(x).getTime()).filter(Number.isFinite);
  const hiVals = [a.hi, p.hi].filter(Boolean).map(x => new Date(x).getTime()).filter(Number.isFinite);
  const daily = (await db.console.query(
    `WITH bounds AS (
       SELECT max(hi) hi FROM (
         SELECT max(ts) hi FROM osb_access_events
         UNION ALL
         SELECT max(ts) hi FROM osb_pipeline_events
       ) x
     )
     SELECT d::date::text AS "day", sum(access)::bigint access, sum(pipeline)::bigint pipeline, sum(faults)::bigint faults FROM (
       SELECT date_trunc('day', ts) d, count(*) access, 0::bigint pipeline, 0::bigint faults
         FROM osb_access_events, bounds WHERE bounds.hi IS NULL OR ts >= bounds.hi - interval '14 days' GROUP BY 1
       UNION ALL
       SELECT date_trunc('day', ts) d, 0::bigint access, count(*) pipeline, count(*) FILTER (WHERE fault)::bigint faults
         FROM osb_pipeline_events, bounds WHERE bounds.hi IS NULL OR ts >= bounds.hi - interval '14 days' GROUP BY 1
     ) x GROUP BY d ORDER BY d DESC LIMIT 14`)).rows;
  return { access: a, pipeline: p,
    archive: { lo: loVals.length ? new Date(Math.min(...loVals)).toISOString() : win.lo,
      hi: hiVals.length ? new Date(Math.max(...hiVals)).toISOString() : win.hi,
      batches: win.batches, latest_batch: b[0] || win.latest_batch || null },
    batches: b, daily };
}

async function topology({ from, to } = {}) {
  await ensure();
  const w = from && to ? `WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const params = from && to ? [from, to] : [];
  return (await db.console.query(
    `SELECT uri, count(*)::bigint calls, (avg(ms))::int avg_ms, max(ms) max_ms,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY ms)::int p95_ms
       FROM osb_access_events ${w} GROUP BY uri ORDER BY calls DESC LIMIT 60`, params)).rows;
}

async function faults({ from, to, limit = 60 } = {}) {
  await ensure();
  const w = from && to ? `AND ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const params = from && to ? [from, to] : [];
  const list = (await db.console.query(
    `SELECT ts, server, pipeline, stage, label, component, ecid, msisdns, txn_ids, identifiers,
            fault_kind, left(payload, 1200) payload
       FROM osb_pipeline_events WHERE fault ${w} ORDER BY ts DESC LIMIT ${Math.min(300, limit)}`, params)).rows;
  const byKind = (await db.console.query(
    `SELECT fault_kind, count(*)::bigint n FROM osb_pipeline_events WHERE fault ${w} GROUP BY 1`, params)).rows;
  return { byKind, list };
}

/* everything OSB saw for one customer in a window — the journey feed */
async function eventsFor(msisdn, fromIso, toIso, limit = 80) {
  await ensure();
  const m = String(msisdn || '').replace(/\D/g, '');
  const norm = /^05\d{8}$/.test(m) ? '966' + m.slice(1) : /^5\d{8}$/.test(m) ? '966' + m : m;
  const byMsisdn = /^9665\d{8}$/.test(norm);
  const byNid = /^[12]\d{9}$/.test(m);
  if (!byMsisdn && !byNid) return { pipeline: [], access: [], access_by_msisdn: [] };
  const where = byMsisdn ? `msisdns @> ARRAY[$1]` : `identifiers @> $1::jsonb`;
  const key = byMsisdn ? norm : JSON.stringify({ national_ids: [m] });
  const pipe = (await db.console.query(
    `SELECT id, ts, server, pipeline, stage, direction, label, component, ecid, msisdns, txn_ids, identifiers,
            fault, fault_kind, left(payload, 900) payload
       FROM osb_pipeline_events
      WHERE ${where} AND ts >= $2::timestamptz AND ts < $3::timestamptz
      ORDER BY ts LIMIT ${Math.min(200, limit)}`, [key, fromIso, toIso])).rows;
  // pull the access rows for the same ECIDs (uri + latency + backend for each hop)
  const ecids = [...new Set(pipe.map(x => x.ecid).filter(Boolean))].slice(0, 100);
  let acc = [];
  if (ecids.length) acc = (await db.console.query(
    `SELECT id, ts, server, ecid, uri, component, method, status, ms, bytes FROM osb_access_events WHERE ecid = ANY($1) ORDER BY ts`, [ecids])).rows;
  // plus direct query-string hits (Siebel bridges carry ?msisdn=)
  const qs = byMsisdn ? (await db.console.query(
    `SELECT id, ts, server, ecid, uri, component, method, status, ms, bytes FROM osb_access_events
      WHERE qs_msisdn = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz ORDER BY ts LIMIT 60`,
    [norm, fromIso, toIso])).rows : [];
  return { pipeline: pipe, access: acc, access_by_msisdn: qs };
}

function summariseCustomerEvents(ev, archiveWindow, key) {
  const pipeline = ev.pipeline || [], access = ev.access || [], qs = ev.access_by_msisdn || [];
  const byComp = {};
  const byStory = {};
  for (const r of pipeline.concat(access).concat(qs)) {
    const c = r.component || componentOf((r.pipeline || '') + ' ' + (r.label || '') + ' ' + (r.uri || ''));
    const x = byComp[c] || (byComp[c] = { component: c, records: 0, faults: 0, max_ms: 0 });
    x.records++;
    if (r.fault) x.faults++;
    if (r.ms != null) x.max_ms = Math.max(x.max_ms, Number(r.ms || 0));

    const st = storyOf(r);
    const y = byStory[st.key] || (byStory[st.key] = {
      key: st.key, label: st.label, value: st.value, records: 0, pipeline_records: 0,
      direct_hits: 0, ecid_hops: 0, faults: 0, max_ms: 0, examples: []
    });
    y.records++;
    if (r.pipeline) y.pipeline_records++;
    else if (r.qs_msisdn) y.direct_hits++;
    else y.ecid_hops++;
    if (r.fault) y.faults++;
    if (r.ms != null) y.max_ms = Math.max(y.max_ms, Number(r.ms || 0));
    const ex = r.uri || r.label || r.pipeline;
    if (ex && y.examples.length < 3 && !y.examples.includes(ex)) y.examples.push(ex);
  }
  const times = pipeline.concat(access).concat(qs).map(r => new Date(r.ts).getTime()).filter(Number.isFinite);
  const faults = pipeline.filter(r => r.fault);
  const matchBy = pipeline.length ? 'payload-identifier'
    : qs.length ? 'access-query-msisdn'
    : access.length ? 'ecid-from-payload'
    : 'none';
  return {
    key_used: key, pipeline_records: pipeline.length, backend_hops: access.length,
    direct_backend_hits: qs.length, faults: faults.length,
    fault_kinds: [...new Set(faults.map(r => r.fault_kind).filter(Boolean))],
    components: Object.values(byComp).sort((a, b) => b.records - a.records).slice(0, 8),
    journey_stories: Object.values(byStory).sort((a, b) => (b.faults - a.faults) || (b.records - a.records)).slice(0, 8),
    first_seen: times.length ? new Date(Math.min(...times)).toISOString() : null,
    last_seen: times.length ? new Date(Math.max(...times)).toISOString() : null,
    match: matchBy,
    confidence: pipeline.length || qs.length ? 'high-customer-match' : (access.length ? 'ecid-derived' : 'none'),
    correlation: {
      bss_customer_match: matchBy,
      osb_internal_join: access.length ? 'same-ECID access rows' : (pipeline.length ? 'pipeline payload only' : (qs.length ? 'direct access row only' : 'none')),
      digital_to_osb: 'not-exact-in-current-archive',
      limitation: 'OSB archives do not include the UIL transaction id or APIGW trace id, so Digital/APIGW to OSB is a customer+time correlation unless future logs add a shared request header.'
    },
    archive_window: archiveWindow || null
  };
}
async function customerSummary(msisdn, fromIso = null, toIso = null, limit = 120) {
  const win = await archiveWindow();
  const from = fromIso || win.lo || new Date(Date.now() - 30 * 864e5).toISOString();
  const to = toIso || new Date().toISOString();
  const ev = await eventsFor(msisdn, from, to, limit);
  return { from, to, archive_window: win, summary: summariseCustomerEvents(ev, win, msisdn), ...ev };
}
function timelineFromCustomer(ev) {
  const accByEcid = {};
  for (const a2 of (ev.access || [])) (accByEcid[a2.ecid] = accByEcid[a2.ecid] || []).push(a2);
  const out = [];
  for (const p2 of (ev.pipeline || [])) {
    const hops = p2.ecid ? (accByEcid[p2.ecid] || []) : [];
    const comp = p2.component || componentOf((p2.pipeline || '') + ' ' + (p2.label || ''));
    const story = storyOf(p2);
    out.push({ at: p2.ts, source: 'OSB · BSS bus', kind: `${p2.pipeline}${p2.stage ? ' · ' + p2.stage : ''}`,
      ok: !p2.fault,
      detail: `${story.label}: ${p2.label || p2.pipeline}${p2.direction ? ' (' + p2.direction + ')' : ''}`
        + (p2.fault ? ` · ✖ ${p2.fault_kind}` : '')
        + (hops.length ? ` · ${hops.map(h3 => `${h3.uri.split('/').filter(Boolean).slice(-1)[0] || h3.uri} ${h3.ms}ms`).join(' · ').slice(0, 120)}` : ''),
      endpoint: hops[0] ? hops[0].uri : null, request: null,
      response: { server: p2.server, component: comp, ecid: p2.ecid, msisdns: p2.msisdns,
        txn_ids: p2.txn_ids, identifiers: p2.identifiers, fault_kind: p2.fault_kind,
        story: { key: story.key, label: story.label, value: story.value },
        backend_hops: hops.map(h3 => ({ uri: h3.uri, component: h3.component, ms: h3.ms, status: h3.status })),
        payload: p2.payload, match: { by: 'payload-identifier', confidence: 'high-customer-match',
          digital_to_osb: 'not-exact-in-current-archive' } },
      ms: hops[0] ? hops[0].ms : null, status: p2.fault ? (p2.fault_kind || 'FAULT') : 'OK',
      rr: { req: null, res: 'OSB PIPELINE RECORD' } });
  }
  for (const a2 of (ev.access_by_msisdn || [])) {
    const story = storyOf(a2);
    out.push({ at: a2.ts, source: 'OSB · BSS bus', kind: 'backend call',
      ok: String(a2.status)[0] === '2',
      detail: `${story.label}: ${a2.method} ${a2.uri} · ${a2.ms}ms · HTTP ${a2.status}`,
      endpoint: a2.uri, request: null,
      response: { server: a2.server, component: a2.component, ecid: a2.ecid,
        story: { key: story.key, label: story.label, value: story.value },
        match: { by: 'query-string-msisdn', confidence: 'high-customer-match',
          digital_to_osb: 'not-exact-in-current-archive' } },
      ms: a2.ms, status: a2.status, rr: { req: null, res: 'OSB ACCESS ROW' } });
  }
  out.sort((a, z) => new Date(a.at) - new Date(z.at));
  return { events: out, summary: ev.summary, archive_window: ev.archive_window };
}
async function timelineEvents(msisdn, fromIso, toIso, limit = 120) {
  return timelineFromCustomer(await customerSummary(msisdn, fromIso, toIso, limit));
}

async function uriDetails({ uri, from = null, to = null, limit = 40 } = {}) {
  await ensure();
  const u = String(uri || '').slice(0, 200);
  if (!u) return { uri: u, rows: [], top_msisdns: [] };
  const lim = Math.max(1, Math.min(80, Number(limit) || 40));
  const w = from && to ? `AND ts >= $2::timestamptz AND ts < $3::timestamptz` : '';
  const params = from && to ? [u, from, to] : [u];
  const rows = (await db.console.query(
    `SELECT id, ts, server, c_ip, method, ecid, uri, qs_msisdn, status, ms, bytes, component, batch
       FROM osb_access_events
      WHERE uri = $1 ${w}
      ORDER BY ts DESC LIMIT ${lim}`, params)).rows;
  const ecids = [...new Set(rows.map(r => r.ecid).filter(x => x && x !== '-'))].slice(0, 80);
  let hops = [], pipe = [];
  if (ecids.length) {
    hops = (await db.console.query(
      `SELECT id, ts, server, c_ip, method, ecid, uri, qs_msisdn, status, ms, bytes, component, batch
         FROM osb_access_events WHERE ecid = ANY($1::text[]) ORDER BY ecid, ts LIMIT 500`, [ecids])).rows;
    pipe = (await db.console.query(
      `SELECT id, ts, server, pipeline, stage, direction, label, component, ecid, msisdns, txn_ids, identifiers,
              fault, fault_kind, left(payload, 1800) payload, batch
         FROM osb_pipeline_events WHERE ecid = ANY($1::text[]) ORDER BY ecid, ts LIMIT 500`, [ecids])).rows;
  }
  const byEcid = list => list.reduce((m, r) => { const k = r.ecid || ''; (m[k] = m[k] || []).push(r); return m; }, {});
  const hopMap = byEcid(hops), pipeMap = byEcid(pipe);
  const top_msisdns = (await db.console.query(
    `SELECT qs_msisdn, count(*)::bigint n
       FROM osb_access_events
      WHERE uri = $1 ${w} AND qs_msisdn IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, params)).rows;
  return {
    uri: u, from, to, sampled: rows.length, top_msisdns,
    story: (() => { const s = storyOf({ uri: u }); return { key: s.key, label: s.label, value: s.value }; })(),
    correlation: {
      osb_internal: 'same ECID joins access rows to pipeline payloads when both log types carry it',
      digital_to_osb: 'not exact in the current archive because UIL transaction id / APIGW trace id is not present'
    },
    transactions: rows.map(r => ({
      access: r,
      hops: r.ecid ? (hopMap[r.ecid] || []) : [],
      pipeline: r.ecid ? (pipeMap[r.ecid] || []) : []
    }))
  };
}

async function stories({ from = null, to = null } = {}) {
  await ensure();
  const st = await status();
  const W = from && to ? ` WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const WF = from && to ? ` AND ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const P = from && to ? [from, to] : [];
  const out = {};
  const rowFor = key => {
    const spec = storyByKey[key] || storyByKey.other;
    return out[key] || (out[key] = {
      key: spec.key, label: spec.label, value: spec.value,
      calls: 0, ms_sum: 0, avg_ms: null, max_ms: 0,
      pipeline_records: 0, faults: 0, fault_kinds: [],
      top_uris: [], top_pipeline: []
    });
  };

  const perUri = (await db.console.query(
    `SELECT uri, count(*)::bigint calls, sum(ms)::bigint ms_sum, max(ms) max_ms
       FROM osb_access_events${W} GROUP BY uri ORDER BY calls DESC`, P)).rows;
  for (const r of perUri) {
    const s = storyOf({ uri: r.uri });
    const x = rowFor(s.key);
    const calls = Number(r.calls || 0);
    x.calls += calls;
    x.ms_sum += Number(r.ms_sum || 0);
    x.max_ms = Math.max(x.max_ms, Number(r.max_ms || 0));
    if (x.top_uris.length < 5) x.top_uris.push({
      uri: r.uri, calls, avg_ms: calls ? Math.round(Number(r.ms_sum || 0) / calls) : null,
      max_ms: Number(r.max_ms || 0)
    });
  }

  const pExpr = "coalesce(pipeline,'') || ' ' || coalesce(stage,'') || ' ' || coalesce(label,'') || ' ' || left(coalesce(payload,''),1200)";
  const pAgg = (await db.console.query(
    `SELECT ${storySqlCase(pExpr)} AS story, count(*)::bigint n,
            count(*) FILTER (WHERE fault)::bigint faults
       FROM osb_pipeline_events WHERE true${WF} GROUP BY 1`, P)).rows;
  for (const r of pAgg) {
    const x = rowFor(r.story || 'other');
    x.pipeline_records += Number(r.n || 0);
    x.faults += Number(r.faults || 0);
  }

  const pKinds = (await db.console.query(
    `SELECT ${storySqlCase(pExpr)} AS story, fault_kind, count(*)::bigint n
       FROM osb_pipeline_events WHERE fault${WF} GROUP BY 1,2 ORDER BY 3 DESC`, P)).rows;
  for (const r of pKinds) {
    const x = rowFor(r.story || 'other');
    if (r.fault_kind && x.fault_kinds.length < 5) x.fault_kinds.push({ kind: r.fault_kind, n: Number(r.n || 0) });
  }

  const topPipe = (await db.console.query(
    `SELECT pipeline, stage, label, fault_kind, count(*)::bigint n, count(*) FILTER (WHERE fault)::bigint faults
       FROM osb_pipeline_events WHERE true${WF}
      GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 160`, P)).rows;
  for (const r of topPipe) {
    const s = storyOf(r);
    const x = rowFor(s.key);
    if (x.top_pipeline.length < 5) x.top_pipeline.push({
      pipeline: r.pipeline, stage: r.stage, label: r.label, fault_kind: r.fault_kind,
      records: Number(r.n || 0), faults: Number(r.faults || 0)
    });
  }

  const ordered = OSB_STORIES.map(s => out[s.key]).filter(Boolean).map(x => {
    x.avg_ms = x.calls ? Math.round(x.ms_sum / x.calls) : null;
    x.evidence = x.pipeline_records && x.calls ? 'access+payload'
      : x.pipeline_records ? 'payload-only'
      : x.calls ? 'access-only'
      : 'none';
    delete x.ms_sum;
    return x;
  });
  return {
    ok: true, filtered: !!(from && to), from, to, archive: st.archive,
    stories: ordered,
    correlation: {
      osb_internal: 'ECID can join OSB access rows to pipeline payload rows when both log types carry it.',
      digital_to_osb: 'The current OSB archive does not carry UIL transaction id or APIGW trace id; Digital/APIGW to OSB remains a customer + time-window correlation unless the logging headers are extended.'
    }
  };
}

const available = async () => {
  try {
    await ensure();
    const r = await db.console.query(`SELECT
      EXISTS(SELECT 1 FROM osb_pipeline_events LIMIT 1)
      OR EXISTS(SELECT 1 FROM osb_access_events LIMIT 1) AS ok`);
    return !!(r.rows[0] && r.rows[0].ok);
  } catch (e) { return false; }
};

/* ---- ORACLE STACK FLOW (dashboard POC, 3 Sep) ------------------------------------------------
 * Classify every OSB access row into the HLD's Oracle components by URI (order matters — the
 * Siebel→BRM bridges contain both names; ZATCA before BRM for the same reason), and count the
 * pipeline-only flows (ZATCA conversions, SADAD notifications) + faults per component. */
const STACK = OSB_STACK;
const sqlCase = col => 'CASE ' + STACK.map(s =>
  `WHEN ${col} ~* '${s.re.source.replace(/'/g, "''")}' THEN '${s.key}'`).join(' ') + ` ELSE 'other' END`;

async function stack({ from = null, to = null } = {}) {
  await ensure();
  const st = await status();
  /* PERF (3 Sep): grouping 6M rows by a regex CASE plus percentile sorts took tens of seconds
   * and froze the dashboard while the import was still writing. Instead: ONE hash-aggregate
   * GROUP BY uri (few dozen distinct URIs) and classify the small result in JS. No percentile
   * here — the dashboard shows avg/max; p95 stays in /api/osb/archive/topology on demand.
   * WINDOWED (3 Sep pm): from/to filter every count, so the dashboard date range drives the
   * section — POC on the archive today, unchanged when the watcher makes it a rolling feed. */
  const W = from && to ? ` WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const P = from && to ? [from, to] : [];
  const perUri = (await db.console.query(
    `SELECT uri, count(*)::bigint calls, sum(ms)::bigint ms_sum, max(ms) max_ms
       FROM osb_access_events${W} GROUP BY uri`, P)).rows;
  const compMap = {};
  for (const r of perUri) {
    let key = 'other';
    for (const s of STACK) if (s.re.test(r.uri)) { key = s.key; break; }
    const c = compMap[key] || (compMap[key] = { calls: 0, ms_sum: 0, max_ms: 0 });
    c.calls += Number(r.calls); c.ms_sum += Number(r.ms_sum); c.max_ms = Math.max(c.max_ms, Number(r.max_ms || 0));
  }
  const comps = Object.entries(compMap).map(([comp, c]) => ({ comp, calls: c.calls,
    avg_ms: c.calls ? Math.round(c.ms_sum / c.calls) : null, p95_ms: null, max_ms: c.max_ms }));
  const WF = from && to ? ` AND ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const pfaults = (await db.console.query(
    `SELECT ${sqlCase("coalesce(pipeline,'') || ' ' || coalesce(label,'') || ' ' || coalesce(stage,'')")} AS comp,
            count(*)::bigint n FROM osb_pipeline_events WHERE fault${WF} GROUP BY 1`, P)).rows;
  const pflows = (await db.console.query(
    `SELECT ${sqlCase("coalesce(pipeline,'') || ' ' || coalesce(label,'')")} AS comp, count(*)::bigint n
       FROM osb_pipeline_events WHERE true${WF} GROUP BY 1`, P)).rows;
  const sadad = (await db.console.query(
    `SELECT count(*)::bigint n FROM osb_pipeline_events WHERE payload ILIKE '%sadad%'${WF}`, P)).rows[0];
  const byKind = (await db.console.query(
    `SELECT fault_kind, count(*)::bigint n FROM osb_pipeline_events WHERE fault${WF} GROUP BY 1 ORDER BY 2 DESC`, P)).rows;
  const DW = from && to ? `WHERE ts >= $1::timestamptz AND ts < $2::timestamptz` : '';
  const daily = (await db.console.query(
    `SELECT d::date::text AS "day", sum(access)::bigint access, sum(pipeline)::bigint pipeline, sum(faults)::bigint faults FROM (
       SELECT date_trunc('day', ts) d, count(*) access, 0::bigint pipeline, 0::bigint faults FROM osb_access_events ${DW} GROUP BY 1
       UNION ALL
       SELECT date_trunc('day', ts) d, 0::bigint access, count(*) pipeline, count(*) FILTER (WHERE fault)::bigint faults FROM osb_pipeline_events ${DW} GROUP BY 1
     ) x GROUP BY d ORDER BY d`, P)).rows;
  const byKey = k => ({
    ...(comps.find(c => c.comp === k) || { calls: 0, avg_ms: null, p95_ms: null, max_ms: null }),
    faults: Number((pfaults.find(c => c.comp === k) || {}).n || 0),
    pipeline_records: Number((pflows.find(c => c.comp === k) || {}).n || 0)
  });
  const winCalls = comps.reduce((a, c) => a + c.calls, 0);
  const winFaults = pfaults.reduce((a, c) => a + Number(c.n), 0);
  return {
    ok: true, window: { lo: st.archive.lo, hi: st.archive.hi },        // full ARCHIVE span (the UI's honesty note)
    filtered: !!(from && to), from, to,
    totals: { access: winCalls, pipeline: pflows.reduce((a, c) => a + Number(c.n), 0), faults: winFaults },
    entry: byKey('proxy'),
    components: STACK.filter(s => s.key !== 'proxy').map(s => ({ key: s.key, label: s.label, ...byKey(s.key) })),
    other: byKey('other'),
    sadad_notifications: Number(sadad.n || 0),
    fault_kinds: byKind,
    daily,
    archive: st.archive,
    batches: (st.batches || []).slice(0, 5)
  };
}

/* ALERT WATCH — `osb:fault-surge` (P3, day-1-lag aware). Compares the LAST FULL DAY of data
 * against the prior-days baseline; a FRESHNESS GATE (newest row < 48h old) keeps a stale
 * archive silent and arms the rule automatically once the SFTP feed becomes daily. */
async function faultWatch() {
  await ensure();
  const fresh = (await db.console.query(`SELECT max(ts) hi FROM osb_pipeline_events`)).rows[0];
  const now = new Date().toISOString();
  const key = 'osb:fault-surge';
  const resolveOpen = async () => db.console.query(
    `UPDATE alerts SET status='resolved', resolved_at=$2 WHERE status='open' AND rule_key=$1`, [key, now]);
  if (!fresh.hi || Date.now() - new Date(fresh.hi).getTime() > 48 * 3600e3) { await resolveOpen(); return { stale: true }; }
  const days = (await db.console.query(
    `SELECT date_trunc('day', ts) d, count(*) FILTER (WHERE fault)::int faults FROM osb_pipeline_events
      GROUP BY 1 ORDER BY 1`)).rows;
  if (days.length < 2) { await resolveOpen(); return { days: days.length }; }
  const last = days[days.length - 1], base = days.slice(0, -1);
  const baseAvg = base.reduce((a, d) => a + d.faults, 0) / base.length;
  const trip = last.faults >= 100 && last.faults >= 1.5 * Math.max(1, baseAvg);
  if (!trip) { await resolveOpen(); return { last: last.faults, base: Math.round(baseAvg) }; }
  const cur = (await db.console.query(
    `SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  const msg = `OSB faults on ${String(last.d).slice(0, 10)}: ${last.faults} vs a ${Math.round(baseAvg)}/day baseline `
    + `(OSB-382000 / SOAP faults from the imported OSB logs — data arrives with up to a day's lag). `
    + `Drill: Monitoring → Gateway & API → OSB panel fault feed; correlate with the BSS 1500 watch.`;
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
       peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, last.faults, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,$2,'P3','Digital Ops','open',$3,'>=',$4,$5,$6,24,$7,$8,$9,$9,$5,1)`,
    [key, 'OSB fault surge (day-lag data)', 'osb_fault_surge', Math.round(1.5 * baseAvg), last.faults,
     JSON.stringify({ day: String(last.d).slice(0, 10), baseline: Math.round(baseAvg) }), 'osb', msg, now]);
  return { tripped: true, last: last.faults, base: Math.round(baseAvg) };
}

module.exports = { importDir, importArchive, importArchives, scanArchives, archiveWindow, status, topology, faults,
  eventsFor, customerSummary, timelineEvents, timelineFromCustomer, uriDetails, available, stack, faultWatch,
  stories, storyOf, parseAccessFile, parseOutFile, wlTs, extractMsisdns, extractEcid, extractTxnIds, summariseCustomerEvents };

/* ---------- CLI ---------- */
if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'import') {
      if (!arg || !fs.existsSync(arg)) { console.error('usage: node src/osbArchive.js import /tmp/osb'); process.exit(1); }
      const t0 = Date.now();
      const r = await importDir(arg);
      console.log(JSON.stringify(r, null, 2), `\n${Math.round((Date.now() - t0) / 1000)}s`);
    } else if (cmd === 'scan') {
      console.log(JSON.stringify(await scanArchives(arg ? [arg] : DEFAULT_UPLOAD_ROOTS), null, 2));
    } else if (cmd === 'import-archive') {
      if (!arg) { console.error('usage: node src/osbArchive.js import-archive /uploads/osb_server1_logs_YYYYMMDD_YYYYMMDD.tar.gz'); process.exit(1); }
      const t0 = Date.now();
      const r = await importArchive(arg);
      console.log(JSON.stringify(r, null, 2), `\n${Math.round((Date.now() - t0) / 1000)}s`);
    } else if (cmd === 'import-uploads') {
      const t0 = Date.now();
      const r = await importArchives(arg || null);
      console.log(JSON.stringify(r, null, 2), `\n${Math.round((Date.now() - t0) / 1000)}s`);
    } else if (cmd === 'status') console.log(JSON.stringify(await status(), null, 2));
    else console.error('commands: import <dir> | scan [uploads-dir] | import-archive <tar.gz> | import-uploads [uploads-dir] | status');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
