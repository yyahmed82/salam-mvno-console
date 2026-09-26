/* affiliation.js — WHO IS WHO on the console (26 Sep 2026, Yosri): every console user is either SALAM TEAM or a
 * CONTRACT resource of a vendor, derived from the e-mail address — Salam's address format carries the employer as a
 * suffix of the local part (a.shaik.sig@salam.sa = Sigma, dev.tcs@salammobile.sa = TCS, y.yahmed.sns@salam.sa = SNS,
 * a.rasool.dxc@salam.sa = DXC) and a plain first.last@salam.sa is an employee.
 *
 *   salam     the Salam team — employees, and the SNS / DXC resources who work as Salam staff (Yosri's rule)
 *   contract  a vendor's resource under a Salam contract — TCS, Sigma, Oracle, IBM, Evamp & Saanga, Subex … linked
 *             to the vendor of the contract registry (vendorContracts.js) when it exists there
 *   unclassified  matched no rule (an external mailbox, a suffix nobody declared) — shown on the users page until a
 *             super admin assigns it by hand or adds the rule
 *
 * Rules: settings key `user_affiliation_rules` (Teams management › User management › Affiliation rules),
 * else DEFAULT_RULES; first match wins, tested on the lower-cased e-mail, so the vendor suffixes come before the plain
 * Salam domains. Stored on console_users (affiliation · affiliation_org · affiliation_vendor · affiliation_rule ·
 * affiliation_manual): rules never touch a row a super admin set by hand. Re-applied at boot, on every rule change,
 * and on demand; a new user is classified when created. Read by the users page, the user drawer, the responder-team
 * member picker, the refund desks and the users CSV. */
'use strict';
const db = require('./db');
const C = () => db.console;

const KINDS = ['salam', 'contract'];
const DEFAULT_RULES = [
  { id: 'sns', match: '.sns@', kind: 'salam', org: 'Salam (SNS)', note: 'SNS resources work as Salam team' },
  { id: 'dxc', match: '.dxc@', kind: 'salam', org: 'Salam (DXC)', note: 'DXC resources work as Salam team' },
  { id: 'dxc-domain', match: '@dxc.', kind: 'salam', org: 'Salam (DXC)' },
  { id: 'tcs', match: '.tcs@', kind: 'contract', org: 'TCS', vendor: 'tcs' },
  { id: 'tcs-domain', match: '@tcs.com', kind: 'contract', org: 'TCS', vendor: 'tcs' },
  { id: 'sig', match: '.sig@', kind: 'contract', org: 'Sigma', vendor: 'sigma' },
  { id: 'sigma', match: '.sigma@', kind: 'contract', org: 'Sigma', vendor: 'sigma' },
  { id: 'orc', match: '.orc@', kind: 'contract', org: 'Oracle', vendor: 'oracle' },
  { id: 'oracle', match: '.oracle@', kind: 'contract', org: 'Oracle', vendor: 'oracle' },
  { id: 'oracle-domain', match: '@oracle.com', kind: 'contract', org: 'Oracle', vendor: 'oracle' },
  { id: 'ibm', match: '.ibm@', kind: 'contract', org: 'IBM', vendor: null },
  { id: 'ibm-domain', match: '@ibm.com', kind: 'contract', org: 'IBM', vendor: null },
  { id: 'evamp', match: '.evamp@', kind: 'contract', org: 'Evamp & Saanga', vendor: 'evamp' },
  { id: 'es', match: '.es@', kind: 'contract', org: 'Evamp & Saanga', vendor: 'evamp' },
  { id: 'evamp-domain', match: '@evampsaanga.com', kind: 'contract', org: 'Evamp & Saanga', vendor: 'evamp' },
  { id: 'subex', match: '.subex@', kind: 'contract', org: 'Subex', vendor: 'subex' },
  { id: 'subex-domain', match: '@subex.com', kind: 'contract', org: 'Subex', vendor: 'subex' },
  { id: 'infosys', match: '.infosys@', kind: 'contract', org: 'Infosys', vendor: 'infosys' },
  { id: 'infosys-domain', match: '@infosys.com', kind: 'contract', org: 'Infosys', vendor: 'infosys' },
  { id: 'comviva', match: '.comviva@', kind: 'contract', org: 'Comviva', vendor: 'comviva' },
  { id: 'comviva-domain', match: '@comviva.com', kind: 'contract', org: 'Comviva', vendor: 'comviva' },
  { id: 'salam', match: '@salam.sa', kind: 'salam', org: 'Salam', note: 'a plain address with no vendor suffix' },
  { id: 'salammobile', match: '@salammobile.sa', kind: 'salam', org: 'Salam' },
];
const ORG_COLOR = { 'Salam': '#0e9f5a', 'Salam (SNS)': '#0e9f5a', 'Salam (DXC)': '#0e9f5a', 'TCS': '#2563eb', 'Sigma': '#7c3aed', 'Oracle': '#dc2626', 'IBM': '#0891b2', 'Evamp & Saanga': '#d97706', 'Subex': '#9333ea', 'Infosys': '#0d9488', 'Comviva': '#ca8a04' };

/* ---- rules ---- */
function normRule(r, i) {
  const match = String((r && r.match) || '').trim().toLowerCase(); if (!match) return null;
  const kind = KINDS.includes(r.kind) ? r.kind : 'contract';
  const org = String(r.org || (kind === 'salam' ? 'Salam' : match.replace(/[.@]/g, ''))).trim().slice(0, 60);
  return { id: String(r.id || match.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'r' + i).slice(0, 40), match, kind, org, vendor: kind === 'contract' && r.vendor ? String(r.vendor).trim().toLowerCase().slice(0, 40) : null, note: String(r.note || '').slice(0, 160) };
}
async function getRules() {
  let s = null; try { s = await require('./settings').getSetting('user_affiliation_rules'); } catch (_) {}
  const list = Array.isArray(s) ? s : (s && Array.isArray(s.rules) ? s.rules : null);
  const rules = (list || DEFAULT_RULES).map(normRule).filter(Boolean);
  return { rules: rules.length ? rules : DEFAULT_RULES.map(normRule), custom: !!list };
}
async function setRules(list, actor) {
  const rules = (Array.isArray(list) ? list : []).map(normRule).filter(Boolean);
  if (!rules.length) throw new Error('at least one rule is needed — or reset to the defaults');
  const seen = new Set(); for (const r of rules) { if (seen.has(r.match)) throw new Error(`"${r.match}" appears twice`); seen.add(r.match); }
  await require('./settings').setSetting('user_affiliation_rules', { rules, updated_at: new Date().toISOString(), updated_by: actor || null });
  return getRules();
}
async function resetRules() { try { await require('./settings').setSetting('user_affiliation_rules', null); } catch (_) {} return getRules(); }

/* ---- classification ---- */
function classify(email, rules) {
  const e = String(email || '').trim().toLowerCase();
  for (const r of rules) if (e.includes(r.match)) return { kind: r.kind, org: r.org, vendor: r.vendor || null, rule: r.id };
  return { kind: 'unclassified', org: null, vendor: null, rule: null };
}
async function vendorNames() {
  try { const cfg = await require('./vendorContracts').getConfig(); return Object.fromEntries((cfg.vendors || []).map(v => [v.id, v.name])); } catch (_) { return {}; }
}

/* ---- storage ---- */
async function ensureSchema() {
  for (const col of ['affiliation text', 'affiliation_org text', 'affiliation_vendor text', 'affiliation_rule text', 'affiliation_manual boolean NOT NULL DEFAULT false', 'affiliation_at timestamptz'])
    await C().query(`ALTER TABLE console_users ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
}
/* (re)classify every user the rules own (manual rows are left alone); `onlyMissing` = the cheap boot / page-load pass */
async function apply({ onlyMissing = false } = {}) {
  await ensureSchema();
  const { rules } = await getRules();
  const rows = (await C().query(`SELECT id, email, affiliation, affiliation_org, affiliation_vendor, affiliation_rule FROM console_users WHERE affiliation_manual = false${onlyMissing ? ' AND affiliation IS NULL' : ''}`)).rows;
  let changed = 0; const by = {};
  for (const u of rows) {
    const c = classify(u.email, rules); by[c.kind] = (by[c.kind] || 0) + 1;
    if (u.affiliation !== c.kind || (u.affiliation_org || null) !== c.org || (u.affiliation_vendor || null) !== c.vendor || (u.affiliation_rule || null) !== c.rule) {
      await C().query(`UPDATE console_users SET affiliation = $2, affiliation_org = $3, affiliation_vendor = $4, affiliation_rule = $5, affiliation_at = now() WHERE id = $1`, [u.id, c.kind, c.org, c.vendor, c.rule]);
      changed++;
    }
  }
  return { checked: rows.length, changed, by };
}
/* one user, right after creation */
async function classifyUser(email) {
  await ensureSchema(); const { rules } = await getRules(); const c = classify(email, rules);
  await C().query(`UPDATE console_users SET affiliation = $2, affiliation_org = $3, affiliation_vendor = $4, affiliation_rule = $5, affiliation_at = now() WHERE lower(email) = lower($1) AND affiliation_manual = false`, [email, c.kind, c.org, c.vendor, c.rule]).catch(() => {});
  return c;
}
/* a super admin's decision for one user: 'auto' hands the row back to the rules; 'salam'; 'contract:<vendor or org>' */
async function setUser(id, value, actor) {
  await ensureSchema(); const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'auto' || v === 'rule') {
    await C().query(`UPDATE console_users SET affiliation_manual = false, affiliation = NULL WHERE id = $1`, [id]);
    const u = (await C().query(`SELECT email FROM console_users WHERE id = $1`, [id])).rows[0]; if (!u) throw new Error('no such user');
    return { manual: false, ...(await classifyUser(u.email)) };
  }
  let kind, org, vendor = null;
  if (v === 'salam') { kind = 'salam'; org = 'Salam'; }
  else if (v.startsWith('salam:')) { kind = 'salam'; org = `Salam (${v.slice(6).toUpperCase().slice(0, 20)})`; }
  else if (v.startsWith('contract:')) {
    kind = 'contract'; const who = v.slice(9).trim(); if (!who) throw new Error('name the vendor — contract:tcs, contract:sigma …');
    const names = await vendorNames(); const { rules } = await getRules();
    const r = rules.find(x => x.kind === 'contract' && (x.vendor === who || x.org.toLowerCase() === who));
    vendor = names[who] ? who : (r && r.vendor) || null; org = names[vendor] || (r && r.org) || who.replace(/\b\w/g, ch => ch.toUpperCase()).slice(0, 60);
  } else throw new Error('affiliation must be auto, salam, salam:<label> or contract:<vendor>');
  await C().query(`UPDATE console_users SET affiliation = $2, affiliation_org = $3, affiliation_vendor = $4, affiliation_rule = 'manual', affiliation_manual = true, affiliation_at = now() WHERE id = $1`, [id, kind, org, vendor]);
  return { manual: true, kind, org, vendor, rule: 'manual', by: actor || null };
}

/* ---- the picture for the users page ---- */
async function summary() {
  await ensureSchema();
  const rows = (await C().query(`SELECT coalesce(affiliation,'unclassified') AS kind, affiliation_org AS org, affiliation_vendor AS vendor, count(*)::int AS n, count(*) FILTER (WHERE enabled)::int AS active, count(*) FILTER (WHERE affiliation_manual)::int AS manual
      FROM console_users GROUP BY 1,2,3 ORDER BY 1,2`)).rows;
  const uncl = (await C().query(`SELECT id, email, name, enabled FROM console_users WHERE coalesce(affiliation,'unclassified') = 'unclassified' ORDER BY email LIMIT 100`)).rows;
  const tot = { salam: 0, contract: 0, unclassified: 0 }; for (const r of rows) tot[r.kind] = (tot[r.kind] || 0) + r.n;
  const orgs = rows.filter(r => r.org).map(r => ({ kind: r.kind, org: r.org, vendor: r.vendor, n: r.n, active: r.active, manual: r.manual, color: ORG_COLOR[r.org] || (r.kind === 'salam' ? '#0e9f5a' : '#64748b') }));
  const { rules, custom } = await getRules();
  return { totals: tot, orgs, unclassified: uncl, rules, custom_rules: custom, defaults: DEFAULT_RULES, vendors: await vendorNames(), colors: ORG_COLOR };
}

/* ---- routes (super admin) ---- */
function mount(app, { requireSuper, audit }) {
  app.get('/api/users/affiliation', requireSuper, async (req, res) => { try { res.json(await summary()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/users/affiliation/rules', requireSuper, async (req, res) => { try {
      const b = req.body || {}; const out = b.reset ? await resetRules() : await setRules(b.rules, req.actor);
      const applied = await apply(); await audit(req, 'users.affiliation.rules', null, { rules: out.rules.length, reset: !!b.reset, ...applied });
      res.json({ ok: true, ...out, applied, summary: await summary() });
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/users/affiliation/apply', requireSuper, async (req, res) => { try {
      const applied = await apply(); await audit(req, 'users.affiliation.apply', null, applied); res.json({ ok: true, applied, summary: await summary() });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/users/affiliation/preview', requireSuper, async (req, res) => { try {
      const b = req.body || {}; const rules = (Array.isArray(b.rules) ? b.rules : (await getRules()).rules).map(normRule).filter(Boolean);
      const emails = Array.isArray(b.emails) && b.emails.length ? b.emails : (await C().query(`SELECT email FROM console_users ORDER BY email`)).rows.map(x => x.email);
      res.json({ results: emails.map(e => ({ email: e, ...classify(e, rules) })) });
    } catch (e) { res.status(400).json({ error: e.message }); } });
}
module.exports = { KINDS, DEFAULT_RULES, ORG_COLOR, classify, getRules, setRules, resetRules, ensureSchema, apply, classifyUser, setUser, summary, mount };
