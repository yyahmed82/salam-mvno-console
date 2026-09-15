'use strict';

const vendorContracts = require('./vendorContracts');
const notify = require('./notify');

const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];
const STEP_ORDER = ['r1', 'r2', 'r3', 'repeat', 'management'];
const STEP_META = {
  r1: { label: 'Reminder 1', pill: 'R1 NOTICE', color: '#d97706', field: 'reminder1Min' },
  r2: { label: 'Reminder 2', pill: 'R2 WARNING', color: '#ea580c', field: 'reminder2Min' },
  r3: { label: 'Reminder 3', pill: 'R3 ESCALATION', color: '#dc2626', field: 'reminder3Min' },
  repeat: { label: 'Repeat R3', pill: 'R3 REPEAT', color: '#991b1b', field: 'repeat3Min' },
  management: { label: 'Management notice', pill: 'MANAGEMENT FYI', color: '#7f1d1d', field: 'reminder3Min' }
};

const esc = notify.esc;
const arr = v => Array.isArray(v) ? v : [];
const oneLine = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const validEmail = v => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(String(v || '').trim());
const salamEmail = v => /@(salam\.sa|salammobile\.sa)$/i.test(String(v || '').trim());
const fmtList = list => arr(list).length ? arr(list).join(', ') : 'not configured';
const fmtObj = v => {
  if (v == null || v === '') return '-';
  if (typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(' | ');
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
};
const mins = n => {
  n = Number(n || 0);
  if (!n) return 'off';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function findById(list, id) {
  return arr(list).find(x => x && x.id === id) || null;
}

function stepsForPolicy(policy, stepFilter) {
  const wanted = stepFilter && stepFilter !== 'all'
    ? new Set(String(stepFilter).split(',').map(x => x.trim().toLowerCase()).filter(Boolean))
    : null;
  return STEP_ORDER.filter(step => {
    if (wanted && !wanted.has(step)) return false;
    if (step === 'management') return !!policy.informManagement;
    const meta = STEP_META[step];
    return meta && Number(policy[meta.field] || 0) > 0;
  });
}

function matrixForFlow(cfg, flow, opts = {}) {
  const vendor = findById(cfg.vendors, flow.vendorId) || { id: flow.vendorId, name: flow.vendorId };
  const contract = findById(cfg.contracts, flow.contractId) || { id: flow.contractId, title: flow.contractId };
  const obligations = Object.fromEntries(arr(cfg.obligations).map(o => [o.id, o]));
  const severities = opts.matrix || opts.allPriorities
    ? SEVERITIES
    : [String(opts.severity || 'P1').toUpperCase()].filter(x => SEVERITIES.includes(x));
  const rawItems = arr(flow.items).filter(item => opts.includeDisabled || item.enabled !== false);
  const items = opts.allItems ? rawItems : rawItems.slice(0, 1);
  const cases = [];
  for (const item of items) {
    const obligation = obligations[item.obligationId] || { id: item.obligationId, title: item.obligationId, target: {}, evidencePlan: [] };
    for (const severity of severities) {
      const policy = (item.severityPolicy || {})[severity] || (flow.defaultPolicy || {})[severity] || {};
      for (const step of stepsForPolicy(policy, opts.step || 'all')) {
        cases.push({ vendor, contract, flow, item, obligation, severity, policy, step });
      }
    }
  }
  return cases;
}

async function loadConfig(opts = {}) {
  if (opts.defaults) return vendorContracts.normalizeConfig(vendorContracts.DEFAULT_CONFIG);
  return vendorContracts.getConfig();
}

function buildMail(c, to, seq, total) {
  const meta = STEP_META[c.step];
  const policy = c.policy || {};
  const stepMin = c.step === 'management' ? policy.reminder3Min : policy[meta.field];
  const subject = `[TEST ONLY][Salam Ops - Vendor SLA] ${meta.label} - ${c.severity} - ${c.vendor.name} - ${c.obligation.title}`;
  const link = `${notify.CONSOLE_URL || 'https://salam.sa/unified-console/'}#vendor-contracts`;
  const channels = c.flow.channels || {};
  const target = fmtObj((c.obligation.target || {})[c.severity] || c.obligation.target);
  const now = new Date();
  const fired = new Date(now.getTime() - Math.max(1, Number(stepMin || 1)) * 60000).toISOString();
  const kv = [
    ['Test recipient', esc(to)],
    ['Vendor', esc(`${c.vendor.name} (${c.vendor.id})`)],
    ['Contract', esc(`${c.contract.title || c.contract.id}`)],
    ['SLA item', esc(`${c.obligation.title} (${c.obligation.id})`)],
    ['Priority / step', `<b>${esc(c.severity)}</b> - <b>${esc(meta.label)}</b> - configured at ${esc(mins(stepMin))}`],
    ['Target', esc(target)],
    ['Attainment target', esc(c.obligation.attainmentTarget || '-')],
    ['Weight', esc(fmtObj(c.obligation.weight))],
    ['Owner group', esc(c.flow.ownerGroup || '-')],
    ['Management list configured', esc(fmtList(c.flow.managementRecipients))],
    ['Channels configured', esc(Object.entries(channels).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none')],
    ['Evidence plan', esc(arr(c.obligation.evidencePlan).join(' | ') || '-')],
    ['Simulated opened at', esc(fired)]
  ].map(([k, v]) => `<tr><td style="padding:7px 12px 7px 0;color:#64748b;font-size:12px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:7px 0;color:#20302a;font-size:13px">${v}</td></tr>`).join('');
  const ladderRows = SEVERITIES.map(sev => {
    const p = (c.item.severityPolicy || {})[sev] || {};
    const active = sev === c.severity;
    return `<tr style="${active ? 'background:#fff7ed' : ''}">
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:800;color:${sev === 'P1' ? '#dc2626' : sev === 'P2' ? '#d97706' : '#475569'}">${esc(sev)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(mins(p.reminder1Min))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(mins(p.reminder2Min))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(mins(p.reminder3Min))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(mins(p.repeat3Min))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${p.informManagement ? 'yes' : 'no'}</td>
    </tr>`;
  }).join('');
  const body = `
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-left:5px solid #10b981;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-weight:800;color:#064e3b;font-size:14px;margin-bottom:4px">TEST ONLY - this message was sent only to ${esc(to)}.</div>
      <div style="font-size:12.5px;color:#334155">Configured owner, team and management recipients were not used. This is only a format preview for the vendor contract SLA escalation mail.</div>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-left:5px solid ${meta.color};border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-weight:800;color:#7f1d1d;font-size:14px;margin-bottom:4px">${esc(meta.label)} - ${esc(c.severity)} - ${esc(c.obligation.title)}</div>
      <div style="font-size:12.5px;color:#334155">${esc(c.item.message || (c.obligation.operatorMessages || {}).breached || 'SLA is at risk or breached.')}</div>
    </div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:14px">${kv}</table>
    <div style="font-weight:800;font-size:12px;letter-spacing:.06em;color:#334155;margin:10px 0 6px">ESCALATION LADDER FOR THIS SLA ITEM</div>
    <table style="border-collapse:collapse;width:100%;font-size:12.5px;border:1px solid #e5e7eb;margin-bottom:14px">
      <tr>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">Priority</th>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">R1</th>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">R2</th>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">R3</th>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">Repeat R3</th>
        <th style="padding:7px 8px;text-align:left;background:#eef4f0;color:#334155">Inform management</th>
      </tr>
      ${ladderRows}
    </table>
    <div style="margin:6px 0 12px"><a href="${link}" style="display:inline-block;background:#0b7a4b;color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:8px;font-size:13px">Open Vendors & Contracts</a>
      <span style="font-size:11.5px;color:#64748b;margin-left:10px">sample ${seq}/${total} - no production escalation was triggered</span></div>
    <div style="color:#94a3b8;font-size:12px;margin-top:16px">Salam Operations Console - vendor contract SLA preview - generated from CLI test command.</div>`;
  const html = notify.shell({ title: `Vendor SLA test - ${c.vendor.name} - ${c.obligation.title}`, badge: 'OPERATIONS CONSOLE - VENDOR SLA TEST', pill: meta.pill, pillColor: meta.color, bodyHtml: body });
  const text = [
    'TEST ONLY - sent only to ' + to,
    subject,
    `${c.vendor.name} / ${c.contract.title || c.contract.id}`,
    `${c.severity} ${meta.label} at ${mins(stepMin)}`,
    c.item.message || ''
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}

async function sendTestMails(opts = {}) {
  const to = String(opts.to || '').trim().toLowerCase();
  if (!validEmail(to)) throw new Error('Pass exactly one valid email using --to name@salam.sa');
  if (!salamEmail(to) && process.env.ALLOW_VENDOR_SLA_TEST_EXTERNAL !== 'true') {
    throw new Error('For safety, vendor SLA test mail only allows salam.sa / salammobile.sa addresses unless ALLOW_VENDOR_SLA_TEST_EXTERNAL=true');
  }
  const cfg = await loadConfig(opts);
  let flows = arr(cfg.escalationFlows);
  if (opts.vendor) flows = flows.filter(f => f.vendorId === opts.vendor);
  if (opts.contract) flows = flows.filter(f => f.contractId === opts.contract || f.id === opts.contract);
  if (!opts.includeDisabled) flows = flows.filter(f => f.enabled !== false);
  if (!flows.length) throw new Error('No matching vendor escalation flow found.');
  let cases = flows.flatMap(flow => matrixForFlow(cfg, flow, opts));
  if (opts.limit) cases = cases.slice(0, Math.max(0, Number(opts.limit) || 0));
  if (!cases.length) throw new Error('No matching vendor SLA mail cases found.');
  const planned = cases.map((c, i) => {
    const meta = STEP_META[c.step];
    return {
      n: i + 1,
      vendor: c.vendor.id,
      contract: c.contract.id,
      obligation: c.obligation.id,
      severity: c.severity,
      step: c.step,
      label: meta.label,
      to
    };
  });
  if (opts.dryRun) return { dryRun: true, to, planned, total: planned.length };
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const mail = buildMail(cases[i], to, i + 1, cases.length);
    const out = await notify.sendHtml([{ email: to }], mail.subject, mail.html, [], mail.text);
    results.push({ ...planned[i], subject: mail.subject, sent: !!out.sent, dev: !!out.dev, error: out.error || null, reason: out.reason || null, recipients: out.recipients || [] });
  }
  return {
    dryRun: false,
    to,
    total: results.length,
    sent: results.filter(x => x.sent).length,
    dev: results.filter(x => x.dev).length,
    failed: results.filter(x => x.error || x.reason).length,
    results
  };
}

async function cli(args) {
  const flags = parseArgs(args);
  const out = await sendTestMails({
    to: flags.to || flags.email || flags._[0],
    vendor: flags.vendor,
    contract: flags.contract,
    severity: flags.severity,
    step: flags.step,
    matrix: !!(flags.matrix || flags['all-priorities']),
    allPriorities: !!flags['all-priorities'],
    allItems: !!flags['all-items'],
    includeDisabled: !!flags['include-disabled'],
    defaults: !!flags.defaults,
    dryRun: !!flags['dry-run'],
    limit: flags.limit
  });
  console.log(JSON.stringify(out, null, 2));
}

module.exports = { sendTestMails, cli, parseArgs, matrixForFlow };
