/* cst.js — CST section (Super Admin only, 16 Sep 2026): two pages backed by console-DB tables the operator
 * fills from exports today and from live connectors later.
 *
 *   #arqami            Arqami (CST number-ownership service) — the .NET 8 API Salam exposes to CST, replacing the
 *                      legacy .asmx. Read model: cst_arqami_minutes (one row per KSA minute: requests, success,
 *                      failed, avg_ms, max_ms) — the shape of the Oracle per-minute export (Data_YYYYMMDD.csv).
 *   #cst-escalations   CST complaint escalations (Salam ⇄ CST, Remedy on 172.30.1.14 / ARSystem). Read model:
 *                      cst_escalations (one row per escalated complaint from the RA export «تقرير الشكاوي المصعدة
 *                      الشامل»), classified exactly as the engagement runbook §8 prescribes: domain from
 *                      «نوع شكوي رئيسي», IT scope = BIL + PRV + MNP, outcome from the statement text.
 *
 * Routes (all requireSuper):
 *   GET  /api/cst/arqami/days                     days loaded + totals
 *   GET  /api/cst/arqami?day=YYYY-MM-DD           minutes + computed summary (regimes, gaps, timeout-cap minutes, hourly)
 *   POST /api/cst/arqami/import {day, csv}        upsert one day from the Oracle CSV (MINUTE_SLOT,REQUESTS,SUCCESS,FAILED,AVG_MS,MAX_MS)
 *   GET  /api/cst/arqami/daily?days=30            daily traffic — one row per day rolled up from the minutes (requests, success, latency, capped / slow / silent minutes, peak)
 *   GET  /api/cst/arqami/source                   live-connector status (Oracle EBPROD, see cstOracle.js) + a probe of the audit table when configured
 *   POST /api/cst/arqami/backfill {days, force}   read the last N days from Oracle into the minutes table (history)
 *   POST /api/cst/arqami/refresh {day}            re-read one day from Oracle · POST /api/cst/arqami/poll  run one poll now
 *   GET  /api/cst/arqami/api/spec[?probe=1]      the SALAM_TT_Webservice operation CST calls; probe = can this host reach it
 *   POST /api/cst/arqami/api/call {operation, fields}  run it for one national id — explicit operator action, audited, credentials from .env only
 *   GET  /api/cst/escalations/summary[?from&to]   aggregates from rows; when no rows: the runbook snapshot (flagged)
 *   GET  /api/cst/escalations/list?status=open    rows (masked: no names / phones are ever stored)
 *   POST /api/cst/escalations/import {rows,name}  rows = JSON objects keyed by the export's Arabic headers; mapping auto-detected
 *   GET  /api/cst/escalations/imports             import history
 *   GET  /api/cst/remedy/source[?probe=1&deep=1]  Remedy live-connector status; probe = server, objects, real column names
 *                                                 (deep adds row count, date range and the duplicate-SRID count)
 *   GET  /api/cst/remedy/sample?limit=3           a few rows exactly as ITC_CITC_MOH holds them — audited, never stored
 *   GET  /api/cst/remedy/search?q=&field=&contains=&unmask=   live identifier search (REQ · incident · customer no ·
 *                                                 service id · order no · national id) — one row per complaint, audited
 *   GET  /api/cst/remedy/kpis?days=90             the board's own KPIs on live data (one scan, cached 10 min)
 *   GET  /api/cst/remedy/findings?days=90         duplicate analysis, open ageing, concentration, unmapped CST codes
 *   GET  /api/cst/api/spec[?probe=1]             the five CST endpoints as the Swagger declares them; probe = can this host reach the gateway
 *   POST /api/cst/api/call {endpoint, fields}    run one of the five against https://itc-tt-view.itc.sa — explicit operator action, audited
 *   GET  /api/cst/config · PUT /api/cst/config    connector settings (secrets stay in .env — nothing here holds one)
 *
 * Arqami is fed live by cstOracle.js when CST_ORACLE_* is set in .env (per-minute aggregation of APPS.YY_REGISTER_NUMBER_AUDIT,
 * 60 s poll + history backfill); the CSV import stays as the fallback.
 * Escalations read Remedy live through cstRemedy.js when CST_REMEDY_* is set (SQL Server 172.30.1.14 / ARSystem /
 * ITC_CITC_MOH over a small JDBC bridge, read-only, READ UNCOMMITTED so a console query can never block Remedy).
 * Ticket rows are answered and dropped — no customer identifier is written to the console database; the RA export
 * import stays as the fallback and the runbook snapshot as the labelled default. */
'use strict';
const db = require('./db');
const settings = require('./settings');
const oracle = require('./cstOracle');
const remedy = require('./cstRemedy');
const cstApi = require('./cstApi');
const arqamiApi = require('./arqamiApi');

const C = () => db.console;
const n = v => Number(v) || 0;
const KSA = 3 * 3600e3;
const todayKsa = () => new Date(Date.now() + KSA).toISOString().slice(0, 10);

/* ---------------------------------------------------------------- schema */
async function ensure() {
  await C().query(`CREATE TABLE IF NOT EXISTS cst_arqami_minutes (
      day date NOT NULL, slot char(5) NOT NULL, requests int NOT NULL DEFAULT 0, success int NOT NULL DEFAULT 0, failed int NOT NULL DEFAULT 0,
      avg_ms int, max_ms int, imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (day, slot))`);
  await C().query(`ALTER TABLE cst_arqami_minutes ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'csv'`);   // 'csv' (import) | 'oracle' (live connector)
  await C().query(`CREATE TABLE IF NOT EXISTS cst_escalations (
      id bigserial PRIMARY KEY, req text UNIQUE, main_type text, sub_type text, domain text, domain_ar text, it_scope boolean NOT NULL DEFAULT false,
      status text, stage text, region text, city text, escalation_reason text, escalation_desc text, escalated_at timestamptz, closed_at timestamptz,
      closure_reason text, statement text, outcome text, statement_requests int, service text, subscription text, plan_type text,
      raw jsonb NOT NULL DEFAULT '{}', import_id bigint, imported_at timestamptz NOT NULL DEFAULT now())`);
  await C().query(`CREATE INDEX IF NOT EXISTS idx_cst_esc_escalated ON cst_escalations (escalated_at)`);
  await C().query(`CREATE TABLE IF NOT EXISTS cst_imports (
      id bigserial PRIMARY KEY, kind text NOT NULL, name text, rows int NOT NULL DEFAULT 0, inserted int NOT NULL DEFAULT 0, updated int NOT NULL DEFAULT 0,
      mapping jsonb NOT NULL DEFAULT '{}', warnings jsonb NOT NULL DEFAULT '[]', by_user text, at timestamptz NOT NULL DEFAULT now())`);
}

/* ---------------------------------------------------------------- Arqami: per-minute read model */
const SLOT_RX = /^\d{2}:\d{2}$/;
function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toUpperCase());
  const ix = k => head.indexOf(k);
  const iS = ix('MINUTE_SLOT'), iR = ix('REQUESTS'), iO = ix('SUCCESS'), iF = ix('FAILED'), iA = ix('AVG_MS'), iM = ix('MAX_MS');
  if (iS < 0 || iR < 0) throw Object.assign(new Error('CSV must carry MINUTE_SLOT and REQUESTS columns (Oracle per-minute export)'), { status: 400 });
  const out = [];
  for (const l of lines.slice(1)) {
    const c = l.split(',').map(x => x.replace(/"/g, '').trim());
    const slot = c[iS]; if (!SLOT_RX.test(slot)) continue;
    out.push({ slot, requests: n(c[iR]), success: iO < 0 ? n(c[iR]) : n(c[iO]), failed: iF < 0 ? 0 : n(c[iF]), avg_ms: iA < 0 ? null : n(c[iA]), max_ms: iM < 0 ? null : n(c[iM]) });
  }
  return out;
}
const mOf = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const TIMEOUT_CAP_MS = 2500;   // the service's hard ceiling seen in every export (max_ms 2 5xx) — a minute touching it had at least one timed-out call
function summarize(rows) {
  const sorted = rows.slice().sort((a, b) => mOf(a.slot) - mOf(b.slot));
  const requests = sorted.reduce((s, r) => s + r.requests, 0), success = sorted.reduce((s, r) => s + r.success, 0), failed = sorted.reduce((s, r) => s + r.failed, 0);
  const wAvg = requests ? Math.round(sorted.reduce((s, r) => s + n(r.avg_ms) * r.requests, 0) / requests) : null;
  const avgs = sorted.filter(r => r.avg_ms != null).map(r => r.avg_ms).sort((a, b) => a - b);
  const q = p => avgs.length ? avgs[Math.min(avgs.length - 1, Math.floor(p * avgs.length))] : null;
  const maxMs = sorted.reduce((s, r) => Math.max(s, n(r.max_ms)), 0);
  const capped = sorted.filter(r => n(r.max_ms) >= TIMEOUT_CAP_MS).length;
  const slow = sorted.filter(r => n(r.avg_ms) > 1000).map(r => r.slot);
  /* gaps: minutes with no row between the first and the last slot — no request reached the service (or the export lost them) */
  const gaps = []; for (let i = 1; i < sorted.length; i++) { const d = mOf(sorted[i].slot) - mOf(sorted[i - 1].slot); if (d > 1) gaps.push({ from: sorted[i - 1].slot, to: sorted[i].slot, minutes: d - 1 }); }
  /* regimes: contiguous windows of the same latency band — the exports show a "fast" band (< 150 ms) that opens
     every ~3 h at hh:27 for ~25 min, a "normal" band (~350 ms) and "slow" bands (> 1 s) — a cache / backend signature */
  const band = r => n(r.avg_ms) > 1000 ? 'slow' : n(r.avg_ms) < 150 ? 'fast' : 'normal';
  const regimes = []; let cur = null;
  for (const r of sorted) { const b = band(r); if (cur && cur.band === b && mOf(r.slot) - mOf(cur.toM) <= 2) { cur.to = r.slot; cur.toM = r.slot; cur.minutes++; cur.requests += r.requests; } else { if (cur) regimes.push(cur); cur = { band: b, from: r.slot, to: r.slot, toM: r.slot, minutes: 1, requests: r.requests }; } }
  if (cur) regimes.push(cur);
  regimes.forEach(x => delete x.toM);
  const hourly = {}; for (const r of sorted) { const h = r.slot.slice(0, 2); const x = hourly[h] || (hourly[h] = { hour: h, requests: 0, success: 0, failed: 0, wsum: 0, max_ms: 0, minutes: 0 }); x.requests += r.requests; x.success += r.success; x.failed += r.failed; x.wsum += n(r.avg_ms) * r.requests; x.max_ms = Math.max(x.max_ms, n(r.max_ms)); x.minutes++; }
  const hours = Object.values(hourly).sort((a, b) => a.hour < b.hour ? -1 : 1).map(x => ({ hour: x.hour, requests: x.requests, success: x.success, failed: x.failed, avg_ms: x.requests ? Math.round(x.wsum / x.requests) : null, max_ms: x.max_ms, minutes: x.minutes }));
  const peak = sorted.reduce((b, r) => (!b || r.requests > b.requests) ? r : b, null);
  return { minutes: sorted.length, requests, success, failed, successPct: requests ? Math.round(success / requests * 10000) / 100 : null, avg_ms: wAvg, p50_ms: q(0.5), p90_ms: q(0.9), max_ms: maxMs,
    timeoutCapMs: TIMEOUT_CAP_MS, cappedMinutes: capped, slowMinutes: slow.length, slowSlots: slow.slice(0, 40), gaps, gapMinutes: gaps.reduce((s, g) => s + g.minutes, 0),
    regimes: regimes.filter(x => x.minutes >= 3), fastWindows: regimes.filter(x => x.band === 'fast' && x.minutes >= 5).map(x => `${x.from}–${x.to}`), peak: peak ? { slot: peak.slot, requests: peak.requests } : null, hours,
    first: sorted[0] ? sorted[0].slot : null, last: sorted.length ? sorted[sorted.length - 1].slot : null };
}

/* ---------------------------------------------------------------- Escalations: classification (runbook §8, verbatim rules) */
const DOMAINS = [
  { code: 'NET', ar: 'الشبكة والعمليات الميدانية', en: 'Network & field operations', it: false, match: ['تدني مستوى خدمة', 'انقطاعها', 'انقطاع'] },
  { code: 'CC',  ar: 'مركز الاتصال والعمليات',    en: 'Contact centre & operations', it: false, match: ['إلغاء أو تعليق', 'الغاء أو تعليق', 'إلغاء', 'الغاء', 'تعليق'] },
  { code: 'BIL', ar: 'الفوترة والتحصيل',          en: 'Billing & collection',       it: true,  match: ['فواتير', 'التزامات مالية', 'فاتورة'] },
  { code: 'PRV', ar: 'التفعيل والتزويد',          en: 'Activation & provisioning',  it: true,  match: ['عدم تفعيل', 'تفعيل خدمة', 'تطبيق مزاياها'] },
  { code: 'SAL', ar: 'المبيعات والتأسيس',         en: 'Sales & onboarding',         it: false, match: ['تأسيس', 'دون طلب'] },
  { code: 'MNP', ar: 'نقل الأرقام',               en: 'Number portability',         it: true,  match: ['نقل رقم', 'نقل الرقم', 'من مشغل'] },
];
const norm = t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
function domainOf(mainType) {
  const t = norm(mainType);
  for (const d of DOMAINS) if (d.match.some(k => t.includes(k))) return d;
  return { code: 'OTH', ar: 'غير مصنف', en: 'Unclassified', it: false };
}
function outcomeOf(text) {
  const t = norm(text);
  const pend = t.includes('جاري') || t.includes('تمديد المهلة');
  const canc = ['تم الغاء', 'تم إلغاء', 'الخدمة ملغاة', 'تم الالغاء', 'الموافقة على إلغاء', 'بالغاء الخدمة', 'تم اغلاق'].some(k => t.includes(k));
  const comp = ['تسوية', 'تعويض', 'دون احتساب', 'اعفاء', 'إعفاء'].some(k => t.includes(k));
  if (pend && !canc) return 'قيد المعالجة / طلب تمديد المهلة';
  if (canc && comp) return 'أُلغيت الخدمة مع تسوية مالية';
  if (canc) return 'أُلغيت الخدمة بعد التصعيد';
  if (comp) return 'تسوية مالية دون تأكيد الإلغاء';
  return t ? 'غير محدد في الإفادة' : null;
}
/* header detection: the RA export has 31 Arabic columns; match by keyword, report what was found */
const FIELDS = [
  { key: 'req',                 rx: [/رقم الشكوى لدى مقدم الخدمة/, /رقم الشكوى/, /^REQ/i, /Service_?RequestID/i] },
  { key: 'main_type',           rx: [/نوع شكوي رئيسي/, /نوع الشكوى الرئيسي/, /نوع شكوى رئيسي/] },
  { key: 'sub_type',            rx: [/نوع شكوي فرعي/, /نوع الشكوى الفرعي/, /نوع شكوى فرعي/] },
  { key: 'status',              rx: [/حالة الشكوى/, /^الحالة$/, /حالة/] },
  { key: 'stage',               rx: [/المرحلة/] },
  { key: 'region',              rx: [/المنطقة/] },
  { key: 'city',                rx: [/المدينة/] },
  { key: 'escalation_reason',   rx: [/سبب التصعيد/] },
  { key: 'escalation_desc',     rx: [/وصف التصعيد/, /تفاصيل التصعيد/] },
  { key: 'escalated_at',        rx: [/تاريخ التصعيد/, /تاريخ الشكوى/, /تاريخ الإنشاء/, /تاريخ الانشاء/] },
  { key: 'closed_at',           rx: [/تاريخ الإغلاق/, /تاريخ الاغلاق/, /تاريخ الاقفال/] },
  { key: 'closure_reason',      rx: [/سبب الإغلاق/, /سبب الاغلاق/, /سبب الاقفال/] },
  { key: 'statement',           rx: [/الافادة الاساسية لمقدم الخدمة/, /الإفادة الأساسية/, /الافادة/, /الإفادة/] },
  { key: 'statement_requests',  rx: [/عدد طلبات الإفادة/, /عدد طلبات الافادة/] },
  { key: 'service',             rx: [/نوع الخدمة/] },
  { key: 'subscription',        rx: [/نوع الاشتراك/] },
  { key: 'plan_type',           rx: [/مسبق|آجل|الدفع/] },
];
const PII_RX = /الاسم|اسم العميل|رقم الهوية|هوية|الجوال|رقم التواصل|الهاتف|البريد|ايميل|email|phone|mobile|national/i;
function detectMap(headers) {
  const map = {}, used = new Set();
  for (const f of FIELDS) { const h = headers.find(x => !used.has(x) && f.rx.some(r => r.test(norm(x)))); if (h) { map[f.key] = h; used.add(h); } }
  const pii = headers.filter(h => PII_RX.test(h));
  return { map, pii, unmapped: headers.filter(h => !used.has(h) && !pii.includes(h)) };
}
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return isNaN(d) ? null : d.toISOString(); }   // Excel serial
  const s = String(v).trim(); let d = new Date(s);
  if (isNaN(d)) { const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s); if (m) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] - 3 : 0, m[5] ? +m[5] : 0)); }
  return isNaN(d) ? null : d.toISOString();
}
const isOpen = s => { const t = norm(s); return !!t && !/مغلق|مقفل|مغلقة|closed|resolved|تم الإغلاق|تم الاغلاق/i.test(t); };

/* ---------------------------------------------------------------- Escalations: aggregates */
const dayKey = iso => new Date(new Date(iso).getTime() + KSA).toISOString().slice(0, 10);
function aggregate(rows) {
  const dom = {}, reasons = {}, regions = {}, subs = {}, outcomes = {}, status = { open: 0, closed: 0 }, lag = { '0-5': 0, '6-15': 0, '16-30': 0, '31-60': 0, '>60': 0 }, lags = [], daily = {}, byDomStatus = {};
  let itScope = 0, withStatements = 0, services = {}, subscription = {}, openIt = 0;
  for (const r of rows) {
    const d = r.domain || 'OTH'; dom[d] = (dom[d] || 0) + 1; if (r.it_scope) itScope++;
    const open = isOpen(r.status); status[open ? 'open' : 'closed']++; if (open && r.it_scope) openIt++;
    const bd = byDomStatus[d] || (byDomStatus[d] = { open: 0, closed: 0 }); bd[open ? 'open' : 'closed']++;
    if (r.escalation_reason) { const k = norm(r.escalation_reason); reasons[k] = (reasons[k] || 0) + 1; }
    if (r.region) { const k = norm(r.region); regions[k] = (regions[k] || 0) + 1; }
    if (r.sub_type) { const k = norm(r.sub_type); subs[k] = (subs[k] || 0) + 1; }
    if (r.outcome) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    if (n(r.statement_requests) > 0) withStatements++;
    if (r.service) { const k = norm(r.service); services[k] = (services[k] || 0) + 1; }
    if (r.subscription) { const k = norm(r.subscription); subscription[k] = (subscription[k] || 0) + 1; }
    if (r.escalated_at) { const k = dayKey(r.escalated_at); const x = daily[k] || (daily[k] = { day: k, n: 0, it: 0 }); x.n++; if (r.it_scope) x.it++; }
    if (!open && r.escalated_at && r.closed_at) { const days = Math.round((new Date(r.closed_at) - new Date(r.escalated_at)) / 864e5); if (days >= 0) { lags.push(days); lag[days <= 5 ? '0-5' : days <= 15 ? '6-15' : days <= 30 ? '16-30' : days <= 60 ? '31-60' : '>60']++; } }
  }
  const top = (o, k = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([label, count]) => ({ label, count }));
  const sortedLags = lags.slice().sort((a, b) => a - b);
  const median = sortedLags.length ? sortedLags[Math.floor(sortedLags.length / 2)] : null, avg = sortedLags.length ? Math.round(sortedLags.reduce((a, b) => a + b, 0) / sortedLags.length * 10) / 10 : null;
  const dailyArr = Object.values(daily).sort((a, b) => a.day < b.day ? -1 : 1);
  const days = dailyArr.length ? Math.max(1, Math.round((new Date(dailyArr[dailyArr.length - 1].day) - new Date(dailyArr[0].day)) / 864e5) + 1) : 0;
  return { total: rows.length, itScope, itSharePct: rows.length ? Math.round(itScope / rows.length * 1000) / 10 : null, status, openIt,
    domains: DOMAINS.map(d => ({ code: d.code, ar: d.ar, en: d.en, it: d.it, count: dom[d.code] || 0, open: (byDomStatus[d.code] || {}).open || 0 })).concat(dom.OTH ? [{ code: 'OTH', ar: 'غير مصنف', en: 'Unclassified', it: false, count: dom.OTH, open: (byDomStatus.OTH || {}).open || 0 }] : []),
    reasons: top(reasons, 6), regions: top(regions, 8), subTypes: top(subs, 8), outcomes: top(outcomes, 6), services: top(services, 4), subscription: top(subscription, 4),
    withStatements, lag, lagAvgDays: avg, lagMedianDays: median, daily: dailyArr, days, perDay: days ? Math.round(rows.length / days * 10) / 10 : null };
}

/* the runbook snapshot (§10.2, 1 Jul → 8 Sep 2026) — shown ONLY while no rows are imported, and always labelled */
const SNAPSHOT = {
  snapshot: true, asAt: '2026-09-08', window: { from: '2026-07-01', to: '2026-09-08' }, source: 'CST-ESCALATIONS-RUNBOOK.md §10.2 — RA export «تقرير الشكاوي المصعدة الشامل»',
  total: 1631, itScope: 360, itSharePct: 22, status: { open: 345, closed: 1286 }, openIt: null,
  domains: [
    { code: 'NET', ar: 'الشبكة والعمليات الميدانية', en: 'Network & field operations', it: false, count: 948 }, { code: 'CC', ar: 'مركز الاتصال والعمليات', en: 'Contact centre & operations', it: false, count: 272 },
    { code: 'BIL', ar: 'الفوترة والتحصيل', en: 'Billing & collection', it: true, count: 208 }, { code: 'PRV', ar: 'التفعيل والتزويد', en: 'Activation & provisioning', it: true, count: 145 },
    { code: 'SAL', ar: 'المبيعات والتأسيس', en: 'Sales & onboarding', it: false, count: 51 }, { code: 'MNP', ar: 'نقل الأرقام', en: 'Number portability', it: true, count: 7 }],
  reasons: [{ label: 'تجاوز مهلة الخمسة أيام', count: 872 }, { label: 'عدم الرضا عن نتيجة المعالجة', count: 759 }],
  regions: [{ label: 'الرياض', count: 715 }, { label: 'الشرقية', count: 366 }, { label: 'مكة المكرمة', count: 277 }],
  subTypes: [{ label: 'انقطاع الخدمة', count: 493 }, { label: 'تدني مستوى الخدمة', count: 455 }, { label: 'عدم تنفيذ طلب الإلغاء', count: 247 }, { label: 'خطأ في احتساب الفاتورة', count: 128 }, { label: 'عدم تفعيل خدمة', count: 99 }],
  outcomes: [], services: [{ label: 'ثابت', count: 1604 }, { label: 'متنقل', count: 26 }], subscription: [{ label: 'آجل الدفع', count: 1428 }, { label: 'مسبق الدفع', count: 203 }],
  withStatements: 675, lag: { '0-5': 512, '6-15': 598, '16-30': 148, '31-60': 28, '>60': 0 }, lagAvgDays: 9.0, lagMedianDays: 7, daily: [], days: 70, perDay: 23.3,
  sample235: { total: 235, tracedPct: 100, noRecord: 0, workOrders: 98, woComplaints: 70, net: 182, it: 53, unreachableIt: 25, unreachableNet: 1, contradictions: 18, lagAfterDay5Pct: 79 },
};

/* engagement board — the runbook's workstreams and open items, editable from the page (settings key) */
const BOARD_DEFAULT = {
  workstreams: [
    { id: 'A', title: 'Java replacement cutover on server 98', state: 'prepared', note: 'Gated behind PREFLIGHT-CHECKS.ps1; the 3 a.m. IIS canary was never executed.' },
    { id: 'B', title: 'HTTP 500 on GetSPComplaintsData', state: 'fixed', note: 'SQL Msg 512 — duplicated tier-triples in CITC_SDM_CODE_MAPPING; ROW_NUMBER() de-dupe in ITC_CITC_MOH_NEW (DBA team). Verify the swap ran (sys.objects).' },
    { id: 'C', title: 'REQ ⇄ INC mapping ownership', state: 'closed', note: 'Remedy owns it through SRID; no mapping in CST or the .NET service.' },
    { id: 'D', title: 'WO vs INC escalation (GR0000486042)', state: 'closed', note: 'Scenario 2 chosen: INC stays the single escalation object; "Not a Complaint" gate is application-level.' },
    { id: 'E', title: 'Complaint analytics & reporting', state: 'ongoing', note: '235 sample fully correlated (100 % traced); 1 631 list classified; correlation of the full list pending (§9).' },
    { id: 'F', title: 'Remedy correlation SQL (map-1631)', state: 'pending', note: 'Run on 172.30.1.14 / ARSystem with Alt+X in DBeaver; fold queries 1, 3, 5, 7 into the report.' },
  ],
  openItems: [
    { id: 1, text: 'Run map-1631-CST-to-remedy.sql and fold the output into the full-list report', done: false },
    { id: 2, text: 'Email the findings to Atif and the IT team once #1 lands', done: false },
    { id: 3, text: 'IIS canary cutover on server 98 (prepared, gated)', done: false },
    { id: 4, text: 'Java: 5-day rule inverted — confirmed bug, unfixed', done: false },
    { id: 5, text: 'Java: multi-row REQ last-row/first-row parity bug — confirmed, unfixed', done: false },
    { id: 6, text: 'Clarify the 34 Cancelled network tickets before they are shown to CST', done: false },
    { id: 7, text: 'Map each observation of the 6 Sep minutes to an evidence item', done: false },
  ],
};
const CONFIG_DEFAULT = {
  arqami: { source: 'oracle', oracle: { note: 'connector settings come from CST_ORACLE_* in /apps/unified/.env — see /api/cst/arqami/source' }, timeoutCapMs: TIMEOUT_CAP_MS },
  escalations: { source: 'export', remedy: { host: '172.30.1.14', port: 1433, database: 'ARSystem', view: 'ITC_CITC_MOH', user: '', note: 'read-only; join key REQ = SRID = Service_RequestID' } },
};

/* ---------------------------------------------------------------- routes */
function mount(app, { requireSuper, audit }) {
  ensure().then(() => oracle.start()).catch(e => console.error('[cst] schema:', e.message));
  const gate = requireSuper;
  /* identifiers reach the audit log masked to their last four digits — the runbook rule, applied everywhere */
  const mask4 = v => { const t = String(v == null ? '' : v).trim(); return !t ? '' : t.length <= 4 ? '\u2022\u2022\u2022\u2022' : '\u2022'.repeat(Math.min(6, t.length - 4)) + t.slice(-4); };

  app.get('/api/cst/arqami/days', gate, async (req, res) => {
    try { const r = await C().query(`SELECT day::text AS day, count(*)::int AS minutes, sum(requests)::int AS requests, sum(failed)::int AS failed, max(imported_at) AS imported_at, bool_or(source = 'oracle') AS live FROM cst_arqami_minutes GROUP BY 1 ORDER BY 1 DESC LIMIT 400`); res.json({ days: r.rows, today: todayKsa() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/cst/arqami', gate, async (req, res) => {
    try {
      let day = String(req.query.day || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { const l = await C().query(`SELECT max(day)::text AS d FROM cst_arqami_minutes`); day = l.rows[0].d; }
      if (!day) return res.json({ day: null, minutes: [], summary: null, empty: true });
      const r = await C().query(`SELECT slot, requests, success, failed, avg_ms, max_ms FROM cst_arqami_minutes WHERE day = $1 ORDER BY slot`, [day]);
      const prevDay = new Date(new Date(day).getTime() - 864e5).toISOString().slice(0, 10);
      const p = await C().query(`SELECT slot, requests, success, failed, avg_ms, max_ms FROM cst_arqami_minutes WHERE day = $1`, [prevDay]);
      res.json({ day, minutes: r.rows, summary: summarize(r.rows), prev: p.rows.length ? { day: prevDay, summary: summarize(p.rows) } : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* daily traffic — rolled up from the minute rows (history comes from the Oracle backfill, or from CSV days) */
  app.get('/api/cst/arqami/daily', gate, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, n(req.query.days) || 30)); const today = todayKsa();
      const r = await C().query(`SELECT day::text AS day, count(*)::int AS minutes, sum(requests)::int AS requests, sum(success)::int AS success, sum(failed)::int AS failed,
          CASE WHEN sum(requests) > 0 THEN round(sum(coalesce(avg_ms,0)::numeric * requests) / sum(requests))::int END AS avg_ms,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY avg_ms)::int AS p90_ms, max(max_ms)::int AS max_ms,
          count(*) FILTER (WHERE max_ms >= ${TIMEOUT_CAP_MS})::int AS capped_minutes, count(*) FILTER (WHERE avg_ms > 1000)::int AS slow_minutes,
          max(requests)::int AS peak, min(slot) AS first, max(slot) AS last, bool_or(source = 'oracle') AS live
        FROM cst_arqami_minutes WHERE day >= ($1::date - $2::int) AND day <= $1::date GROUP BY day ORDER BY day`, [today, days]);
      const rows = r.rows.map(x => { const full = x.day < today; const span = full ? 1440 : (x.first && x.last ? mOf(x.last) - mOf(x.first) + 1 : x.minutes);
        return { ...x, successPct: x.requests ? Math.round(x.success / x.requests * 10000) / 100 : null, silent_minutes: Math.max(0, span - x.minutes), complete: full, peakSlot: null }; });
      const tot = rows.reduce((a, x) => { a.requests += x.requests; a.failed += x.failed; a.capped += x.capped_minutes; a.slow += x.slow_minutes; a.silent += x.silent_minutes; a.wsum += n(x.avg_ms) * x.requests; return a; }, { requests: 0, failed: 0, capped: 0, slow: 0, silent: 0, wsum: 0 });
      const past = rows.filter(x => x.complete);
      res.json({ days, today, rows, totals: { days: rows.length, requests: tot.requests, failed: tot.failed, avg_ms: tot.requests ? Math.round(tot.wsum / tot.requests) : null, capped_minutes: tot.capped, slow_minutes: tot.slow, silent_minutes: tot.silent,
        perDay: past.length ? Math.round(past.reduce((s, x) => s + x.requests, 0) / past.length) : null, busiest: rows.reduce((b, x) => (!b || x.requests > b.requests) ? x : b, null), slowest: rows.reduce((b, x) => (!b || n(x.avg_ms) > n(b.avg_ms)) ? x : b, null) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/cst/arqami/source', gate, async (req, res) => {
    const st = oracle.status();
    if (st.configured && req.query.probe === '1') { try { st.probe = await oracle.probe(); } catch (e) { st.probeError = e.message; } }
    res.json(st);
  });
  app.post('/api/cst/arqami/backfill', gate, async (req, res) => {
    try { if (!oracle.configured()) return res.status(400).json({ error: 'Oracle connector not configured (CST_ORACLE_* in .env)' });
      const b = req.body || {}; const job = await oracle.backfill(b.days, { force: !!b.force });
      if (audit) audit(req, 'CST_ARQAMI_BACKFILL', String(b.days || ''), { force: !!b.force, days: job.days }).catch(() => {});
      res.json({ ok: true, job }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/arqami/refresh', gate, async (req, res) => {
    try { if (!oracle.configured()) return res.status(400).json({ error: 'Oracle connector not configured (CST_ORACLE_* in .env)' });
      const day = String((req.body || {}).day || todayKsa()); const r = await oracle.refreshDay(day);
      if (audit) audit(req, 'CST_ARQAMI_REFRESH', day, { minutes: r.minutes, requests: r.requests }).catch(() => {});
      res.json({ ok: true, ...r }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/arqami/poll', gate, async (req, res) => {
    try { if (!oracle.configured()) return res.status(400).json({ error: 'Oracle connector not configured (CST_ORACLE_* in .env)' });
      const r = await oracle.poll(); res.json({ ok: !!r, result: r, status: oracle.status() }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/arqami/import', gate, async (req, res) => {
    try {
      const { day, csv, name } = req.body || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return res.status(400).json({ error: 'day must be YYYY-MM-DD (the export file is Data_YYYYMMDD.csv)' });
      const rows = parseCsv(csv); if (!rows.length) return res.status(400).json({ error: 'no minute rows found in the CSV' });
      let ins = 0, upd = 0;
      const c = await C().connect();
      try {
        await c.query('BEGIN');
        for (const r of rows) {
          const x = await c.query(`INSERT INTO cst_arqami_minutes (day, slot, requests, success, failed, avg_ms, max_ms, source) VALUES ($1,$2,$3,$4,$5,$6,$7,'csv')
            ON CONFLICT (day, slot) DO UPDATE SET requests = EXCLUDED.requests, success = EXCLUDED.success, failed = EXCLUDED.failed, avg_ms = EXCLUDED.avg_ms, max_ms = EXCLUDED.max_ms, source = 'csv', imported_at = now()
            RETURNING (xmax = 0) AS inserted`, [day, r.slot, r.requests, r.success, r.failed, r.avg_ms, r.max_ms]);
          if (x.rows[0].inserted) ins++; else upd++;
        }
        await c.query(`INSERT INTO cst_imports (kind, name, rows, inserted, updated, by_user) VALUES ('arqami', $1, $2, $3, $4, $5)`, [name || `Data_${day.replace(/-/g, '')}.csv`, rows.length, ins, upd, req.userEmail || req.email || null]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      if (audit) audit(req, 'CST_ARQAMI_IMPORT', day, { rows: rows.length, inserted: ins, updated: upd }).catch(() => {});
      res.json({ ok: true, day, rows: rows.length, inserted: ins, updated: upd, summary: summarize(rows) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/cst/escalations/summary', gate, async (req, res) => {
    try {
      const w = [], p = [];
      if (req.query.from) { p.push(req.query.from); w.push(`escalated_at >= $${p.length}::timestamptz`); }
      if (req.query.to) { p.push(req.query.to); w.push(`escalated_at < $${p.length}::timestamptz`); }
      const r = await C().query(`SELECT domain, it_scope, status, region, sub_type, escalation_reason, outcome, statement_requests, service, subscription, escalated_at, closed_at FROM cst_escalations ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p);
      const imports = (await C().query(`SELECT id, name, rows, inserted, updated, at, by_user FROM cst_imports WHERE kind = 'escalations' ORDER BY id DESC LIMIT 5`)).rows;
      if (!r.rows.length) return res.json({ ...SNAPSHOT, imports, rows: 0 });
      const bounds = (await C().query(`SELECT min(escalated_at) AS a, max(escalated_at) AS b, max(imported_at) AS i FROM cst_escalations`)).rows[0];
      res.json({ snapshot: false, ...aggregate(r.rows), window: { from: bounds.a, to: bounds.b }, importedAt: bounds.i, imports, rows: r.rows.length, sample235: SNAPSHOT.sample235 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/cst/escalations/list', gate, async (req, res) => {
    try {
      const w = [], p = [];
      if (req.query.status === 'open') w.push(`NOT (status ~* 'مغلق|مقفل|مغلقة|closed|resolved')`);
      if (req.query.domain) { p.push(req.query.domain); w.push(`domain = $${p.length}`); }
      if (req.query.it === '1') w.push(`it_scope`);
      p.push(Math.min(500, n(req.query.limit) || 100));
      const r = await C().query(`SELECT id, req, main_type, sub_type, domain, domain_ar, it_scope, status, stage, region, city, escalation_reason, escalated_at, closed_at, closure_reason, outcome, statement_requests, left(statement, 240) AS statement
        FROM cst_escalations ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY escalated_at DESC NULLS LAST LIMIT $${p.length}`, p);
      res.json({ rows: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/escalations/import', gate, async (req, res) => {
    try {
      const { rows, name } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows[] required — the export parsed to JSON objects keyed by its header row' });
      const headers = Object.keys(rows[0]);
      const { map, pii, unmapped } = detectMap(headers);
      const warnings = [];
      if (!map.req) return res.status(400).json({ error: 'could not find the complaint number column (رقم الشكوى لدى مقدم الخدمة)', headers });
      if (!map.main_type) warnings.push('main complaint type column not found — every row will be Unclassified');
      if (pii.length) warnings.push(`PII columns ignored, never stored: ${pii.join(' · ')}`);
      let ins = 0, upd = 0, skipped = 0;
      const c = await C().connect();
      try {
        await c.query('BEGIN');
        const imp = await c.query(`INSERT INTO cst_imports (kind, name, rows, mapping, warnings, by_user) VALUES ('escalations', $1, $2, $3, $4, $5) RETURNING id`, [name || 'export', rows.length, JSON.stringify(map), JSON.stringify(warnings), req.userEmail || req.email || null]);
        const importId = imp.rows[0].id;
        for (const row of rows) {
          const g = k => map[k] ? row[map[k]] : null;
          const reqId = norm(g('req')); if (!reqId) { skipped++; continue; }
          const dom = domainOf(g('main_type'));
          const raw = {}; for (const h of headers) if (!pii.includes(h)) raw[h] = row[h];   // PII columns never reach the database
          const x = await c.query(`INSERT INTO cst_escalations (req, main_type, sub_type, domain, domain_ar, it_scope, status, stage, region, city, escalation_reason, escalation_desc, escalated_at, closed_at, closure_reason, statement, outcome, statement_requests, service, subscription, plan_type, raw, import_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
            ON CONFLICT (req) DO UPDATE SET main_type = EXCLUDED.main_type, sub_type = EXCLUDED.sub_type, domain = EXCLUDED.domain, domain_ar = EXCLUDED.domain_ar, it_scope = EXCLUDED.it_scope, status = EXCLUDED.status, stage = EXCLUDED.stage,
              region = EXCLUDED.region, city = EXCLUDED.city, escalation_reason = EXCLUDED.escalation_reason, escalation_desc = EXCLUDED.escalation_desc, escalated_at = COALESCE(EXCLUDED.escalated_at, cst_escalations.escalated_at), closed_at = EXCLUDED.closed_at,
              closure_reason = EXCLUDED.closure_reason, statement = EXCLUDED.statement, outcome = EXCLUDED.outcome, statement_requests = EXCLUDED.statement_requests, service = EXCLUDED.service, subscription = EXCLUDED.subscription, plan_type = EXCLUDED.plan_type, raw = EXCLUDED.raw, import_id = EXCLUDED.import_id, imported_at = now()
            RETURNING (xmax = 0) AS inserted`,
            [reqId, norm(g('main_type')) || null, norm(g('sub_type')) || null, dom.code, dom.ar, dom.it, norm(g('status')) || null, norm(g('stage')) || null, norm(g('region')) || null, norm(g('city')) || null,
             norm(g('escalation_reason')) || null, norm(g('escalation_desc')) || null, parseDate(g('escalated_at')), parseDate(g('closed_at')), norm(g('closure_reason')) || null, norm(g('statement')) || null, outcomeOf(g('statement')),
             g('statement_requests') == null ? null : n(g('statement_requests')), norm(g('service')) || null, norm(g('subscription')) || null, norm(g('plan_type')) || null, JSON.stringify(raw), importId]);
          if (x.rows[0].inserted) ins++; else upd++;
        }
        await c.query(`UPDATE cst_imports SET inserted = $2, updated = $3 WHERE id = $1`, [importId, ins, upd]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      if (audit) audit(req, 'CST_ESCALATIONS_IMPORT', name || 'export', { rows: rows.length, inserted: ins, updated: upd, skipped }).catch(() => {});
      res.json({ ok: true, rows: rows.length, inserted: ins, updated: upd, skipped, mapping: map, unmapped, pii, warnings });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/cst/escalations/imports', gate, async (req, res) => {
    try { res.json({ imports: (await C().query(`SELECT id, kind, name, rows, inserted, updated, mapping, warnings, by_user, at FROM cst_imports ORDER BY id DESC LIMIT 30`)).rows }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Arqami as CST calls it (SALAM_TT_Webservice.asmx) ----
   * The minutes above say how the service behaved; this says what it answered. The service account and password
   * are read from /apps/unified/.env inside arqamiApi.js and are never accepted from the request, so a browser
   * cannot send credentials of its own; the echoed request masks the password. The national id is an operator
   * action: audited with the id masked to its last four digits, answered, and stored nowhere. */
  app.get('/api/cst/arqami/api/spec', gate, async (req, res) => {
    try {
      const out = arqamiApi.spec();
      if (req.query.probe === '1') { try { out.tcp = await arqamiApi.reachable(); } catch (e) { out.tcp = { ok: false, error: e.message }; } }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/arqami/api/call', gate, async (req, res) => {
    try {
      const b = req.body || {};
      const op = arqamiApi.byKey(String(b.operation || ''));
      if (!op) return res.status(400).json({ error: 'unknown operation: ' + String(b.operation || '').slice(0, 40) });
      const fields = (b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields)) ? b.fields : {};
      if (audit) audit(req, 'ARQAMI_API_CALL', op.op + ' ' + mask4(fields.User_ID_Number), { operation: op.key }).catch(() => {});
      res.json(await arqamiApi.call(op.key, fields));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Remedy: the live source behind CST Escalations (read-only, super admin, explicit action only) ---- */
  app.get('/api/cst/remedy/source', gate, async (req, res) => {
    const st = remedy.status();
    if (st.configured && req.query.probe === '1') {
      try { st.probe = await remedy.probe({ deep: req.query.deep === '1' }); } catch (e) { st.probeError = e.message; }
    }
    res.json(st);
  });
  /* the view's real shape, read once so the mapping is written against ARSystem instead of guessed. These rows
     carry customer identifiers: the call is audited, the rows are returned to the operator and stored nowhere. */
  app.get('/api/cst/remedy/sample', gate, async (req, res) => {
    try {
      if (!remedy.configured()) return res.status(400).json({ error: 'Remedy connector not configured (CST_REMEDY_* in .env)' });
      if (audit) audit(req, 'CST_REMEDY_SAMPLE', String(n(req.query.limit) || 3), { view: remedy.cfg().view }).catch(() => {});
      res.json({ view: remedy.cfg().view, rows: await remedy.sample(req.query.limit) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* LIVE FROM REMEDY — search, KPIs and findings straight off ITC_CITC_MOH.
   * Nothing from these calls is written to the console database: rows are read, answered and dropped. Identifier
   * searches are an operator action and are audited with the term; the two PII columns (Customer_Name, ID_Number)
   * come back masked unless the caller holds unmaskPII, and that unmasking is audited separately. */
  app.get('/api/cst/remedy/search', gate, async (req, res) => {
    try {
      if (!remedy.configured()) return res.status(400).json({ error: 'Remedy connector not configured (CST_REMEDY_* in .env)' });
      const q = String(req.query.q || '').trim();
      const unmask = req.query.unmask === '1' && !!(req.caps && req.caps.unmaskPII);
      if (audit) audit(req, unmask ? 'pii.unmask' : 'CST_REMEDY_SEARCH', 'cst-remedy ' + q.slice(0, 40), { field: req.query.field || 'any', contains: req.query.contains === '1' }).catch(() => {});
      const out = await remedy.search(q, { field: req.query.field || null, contains: req.query.contains === '1', limit: req.query.limit, unmask });
      res.json({ ...out, unmaskAvailable: !!(req.caps && req.caps.unmaskPII) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* A window costs one scan of the view — 3.9 s for 90 days, proportionally more beyond that — so the answer is
   * cached for as long as it stays useful: a short window is cheap and wants to be fresh, a year is expensive and
   * barely moves between page loads. Findings hold twice as long again; nobody watches an ageing histogram tick. */
  const ttlFor = days => days <= 7 ? 5 * 60000 : days <= 90 ? 15 * 60000 : days <= 180 ? 60 * 60000 : 3 * 3600000;
  app.get('/api/cst/remedy/kpis', gate, async (req, res) => {
    try {
      if (!remedy.configured()) return res.status(400).json({ error: 'Remedy connector not configured (CST_REMEDY_* in .env)' });
      const days = Math.min(3650, Math.max(1, n(req.query.days) || 90));
      res.json(await remedy.cached('kpis:' + days, ttlFor(days), () => remedy.kpis({ days })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/cst/remedy/findings', gate, async (req, res) => {
    try {
      if (!remedy.configured()) return res.status(400).json({ error: 'Remedy connector not configured (CST_REMEDY_* in .env)' });
      const days = Math.min(3650, Math.max(1, n(req.query.days) || 90));
      res.json(await remedy.cached('findings:' + days, 2 * ttlFor(days), () => remedy.findings({ days })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- The five CST endpoints (spec CITC006001 v6.2), run from the console exactly as the Swagger runs them ----
   * Remedy above answers what we hold; these answer what the regulator receives. The call is made server-side so
   * the api key never reaches a browser, the endpoint is chosen by key from a fixed table so nothing else can be
   * posted to, and every run is audited with a masked identifier. Nothing is stored and nothing is scheduled. */
  app.get('/api/cst/api/spec', gate, async (req, res) => {
    try {
      const out = cstApi.spec();
      if (req.query.probe === '1') { try { out.tcp = await cstApi.reachable(); } catch (e) { out.tcp = { ok: false, error: e.message }; } }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/cst/api/call', gate, async (req, res) => {
    try {
      const b = req.body || {};
      const ep = cstApi.byKey(String(b.endpoint || ''));
      if (!ep) return res.status(400).json({ error: 'unknown endpoint: ' + String(b.endpoint || '').slice(0, 40) });
      const fields = (b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields)) ? b.fields : {};
      const idish = fields.SpTicketNumber || fields.ServiceNumber || fields.IdentificationNumber || '';
      if (audit) audit(req, 'CST_API_CALL', ep.path + ' ' + mask4(idish), { endpoint: ep.key }).catch(() => {});
      /* the transport result IS the answer — an HTTP 500 from CST is a finding, not a console failure, so it
         comes back as 200 with the gateway's own status inside and the page renders it. */
      res.json(await cstApi.call(ep.key, fields));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/cst/board', gate, async (req, res) => { try { res.json(Object.assign({}, BOARD_DEFAULT, (await settings.getSetting('cst_board')) || {})); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/cst/board', gate, async (req, res) => {
    try { const b = req.body || {}; const v = { workstreams: Array.isArray(b.workstreams) ? b.workstreams.slice(0, 20) : BOARD_DEFAULT.workstreams, openItems: Array.isArray(b.openItems) ? b.openItems.slice(0, 50) : BOARD_DEFAULT.openItems };
      await settings.setSetting('cst_board', v); if (audit) audit(req, 'CST_BOARD_UPDATE', 'cst_board', {}).catch(() => {}); res.json({ ok: true, ...v }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/cst/config', gate, async (req, res) => { try { res.json(Object.assign({}, CONFIG_DEFAULT, (await settings.getSetting('cst_config')) || {})); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/cst/config', gate, async (req, res) => {
    try { const b = req.body || {}; const v = { arqami: Object.assign({}, CONFIG_DEFAULT.arqami, b.arqami || {}), escalations: Object.assign({}, CONFIG_DEFAULT.escalations, b.escalations || {}) };
      for (const k of ['arqami', 'escalations']) { const o = v[k].oracle || v[k].remedy; if (o && 'password' in o) delete o.password; }   // secrets never live in console_settings — .env only
      await settings.setSetting('cst_config', v); if (audit) audit(req, 'CST_CONFIG_UPDATE', 'cst_config', {}).catch(() => {}); res.json({ ok: true, ...v }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, ensure, parseCsv, summarize, domainOf, outcomeOf, detectMap, aggregate, SNAPSHOT, DOMAINS };
