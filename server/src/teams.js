/* teams.js — RESPONDER TEAMS (24 Sep 2026).
 *
 * One registry of the teams that can own an incident: business (mobile | fixed | both) × domain (digital, bss, oss,
 * infra, adm, network, soc, payments, rafm, sales) × level (L1 | L2 | L3), each optionally bound to the vendor and the
 * contract that carries its obligations (vendorContracts.js) — so an incident that lands on "Oracle BSS L3" shows the
 * signed response / restoration / RCA clocks of SAL-OD-14253496 next to the ack SLA, and the vendor measurement can
 * later be computed per team.
 *
 *   console_teams                 the registry (seeded below, editable in Settings › Teams; a seed row that an admin
 *                                 edited is left alone — merge by key only adds what is missing)
 *   console_user_teams            who is in which team and what they may do there (ack · resolve · reassign)
 *   alert_rule_team_suggestions   Agent 2's proposed rule → team mapping (deterministic first, model for the
 *                                 ambiguous ones) waiting for a human to approve — never applied on its own
 *
 * Rights on an incident (canActOn): admins (manageSync) → always · a member of the incident's team → yes · the
 * per-business ACK holders (console_users.ack_mobile / ack_fixed, the on-call fallback) → yes · an incident with no
 * team → any ackErrors user. The legacy free-text rule teams ("Digital Ops", "BSS Ops"…) resolve through `aliases`,
 * so nothing has to be migrated for the mapping to work. */
'use strict';
const db = require('./db');
const C = () => db.console;

const DOMAINS = {
  digital: 'Digital channels', bss: 'BSS', oss: 'OSS', infra: 'Infrastructure & DC', adm: 'ADM · fixes & enhancements',
  network: 'Network', soc: 'Security', payments: 'Payments', rafm: 'Revenue assurance & fraud', sales: 'Sales & dealers', other: 'Other',
};
const LEVELS = ['L1', 'L2', 'L3'];
const BUSINESSES = ['mobile', 'fixed', 'both'];

/* seed taxonomy — business × domain × level, bound to the contract that carries the obligation */
const SEED = [
  { key: 'digital-l1', name: 'Salam Digital Ops · L1', business: 'both', domain: 'digital', level: 'L1', sort: 10,
    description: 'Console operators — first ack, triage, customer comms, routing to L2/L3.', aliases: ['Digital Ops', 'Salam Ops', 'Call Center', 'IDENTITY'],
    keywords: ['login', 'otp', 'onboarding', 'app', 'web', 'journey', 'nafath', 'absher', 'kyc', 'session'] },
  { key: 'mobile-digital-l2', name: 'TCS · Mobile Digital & BSS L2', business: 'mobile', domain: 'digital', level: 'L2', vendor_id: 'tcs', contract_id: 'tcs-2026-mvno-itops', sort: 20,
    description: 'WP1 MVNO IT operations — digital apps, web portal, Kong API gateway, DMS, payment gateway, MNP, BSS DB.', aliases: ['TCS Mobile L2'],
    keywords: ['apigw', 'kong', 'dms', 'mnp', 'sim', 'activation', 'recharge', 'plan', 'esim', 'startappz', 'portal', 'billing', 'invoice', 'bill', 'brm', 'siebel', 'crm', 'order', 'charging', 'mrc', 'mediation', 'balance', 'provision'] },
  { key: 'fixed-apps-l2', name: 'Sigma · Fixed Applications L2', business: 'fixed', domain: 'digital', level: 'L2', vendor_id: 'sigma', contract_id: 'sigma-2024', sort: 21,
    description: 'Fixed digital services — Salam Home app, SDA, ePurchase, nexus/146 back end, Remedy hand-offs.', aliases: ['Sigma Fixed L2', 'Fixed Ops'],
    keywords: ['ftth', 'home', 'sda', 'epurchase', 'nexus', 'yakeen', 'remedy', 'fixed'] },
  { key: 'bss-l2', name: 'BSS Operations · L2 (Fixed)', business: 'fixed', domain: 'bss', level: 'L2', vendor_id: 'sigma', contract_id: 'sigma-2024', sort: 30,
    description: 'Fixed billing, charging, CRM and order management operations (Siebel · BRM · OSM) under the Sigma contract — first line before Oracle. Mobile BSS L2 is TCS (mobile-digital-l2).', aliases: ['BSS Ops', 'BSS', 'Data Ops'],
    keywords: ['billing', 'invoice', 'bill', 'brm', 'siebel', 'osm', 'crm', 'order', 'charging', 'mrc', 'mediation', 'balance'] },
  { key: 'bss-l3', name: 'Oracle · BSS L3', business: 'both', domain: 'bss', level: 'L3', vendor_id: 'oracle', contract_id: 'oracle-ms-od-14253496', sort: 31,
    description: 'Oracle managed services — product bugs and L3 fixes on Siebel, BRM, OSM, UIM, OSB (SAL-OD-14253496).', aliases: [],
    keywords: ['oracle', 'osb', 'uim', 'asap', 'ipsa'] },
  { key: 'oss-l2', name: 'OSS Operations · L2 (Fixed)', business: 'fixed', domain: 'oss', level: 'L2', vendor_id: 'sigma', contract_id: 'sigma-2024', sort: 40,
    description: 'Provisioning, activation and inventory operations — OSS/ITSM per the Sigma contract.', aliases: ['OSS Ops', 'OSS'],
    keywords: ['provision', 'provisioning', 'inventory', 'workorder', 'work order', 'fulfil', 'install', 'appointment', 'field'] },
  { key: 'oss-l3', name: 'Oracle · OSS L3', business: 'both', domain: 'oss', level: 'L3', vendor_id: 'oracle', contract_id: 'oracle-ms-od-14253496', sort: 41,
    description: 'Oracle L3 for OSM / UIM / ASAP product defects.', aliases: [], keywords: [] },
  { key: 'infra-l2', name: 'Infrastructure & DC · L2 (Fixed)', business: 'fixed', domain: 'infra', level: 'L2', vendor_id: 'sigma', contract_id: 'sigma-2024', sort: 50,
    description: 'Servers, storage, backups, DR, patching, capacity (Rimal DC) — Sigma infra reporting obligations.', aliases: ['Infra Ops', 'PLATFORM', 'Enterprise IT'],
    keywords: ['disk', 'cpu', 'memory', 'backup', 'host', 'server', 'vm', 'pod', 'node', 'database', 'db ', 'replica', 'lag', 'sync', 'capacity', 'certificate', 'cert'] },
  { key: 'adm-mobile-l3', name: 'ADM Mobile · L3 fixes & enhancements', business: 'mobile', domain: 'adm', level: 'L3', vendor_id: 'tcs', contract_id: 'tcs-2026-mvno-itops', sort: 60,
    description: 'Code fixes, enhancements and releases on the Mobile digital stack (Rails 17/18, StartAppz apps).', aliases: [], keywords: ['bug', 'defect', 'release', 'deploy', 'regression'] },
  { key: 'adm-fixed-l3', name: 'ADM Fixed · L3 fixes & enhancements', business: 'fixed', domain: 'adm', level: 'L3', vendor_id: 'sigma', contract_id: 'sigma-2024', sort: 61,
    description: 'Code fixes, enhancements and releases on the Fixed digital stack (Node nexus/146, Salam Home, SDA).', aliases: [], keywords: ['bug', 'defect', 'release', 'deploy', 'regression'] },
  { key: 'dms-l3', name: 'Evamp & Saanga · DMS / UIL L3', business: 'mobile', domain: 'adm', level: 'L3', vendor_id: 'evamp', contract_id: 'evamp-tec-dmp-l3', sort: 62,
    description: 'TeC DMP / UIL software maintenance — dealer management and the integration layer.', aliases: [], keywords: ['uil', 'dealer', 'commission', 'dms'] },
  { key: 'payments', name: 'Payments & Gateways', business: 'both', domain: 'payments', level: 'L2', sort: 70,
    description: 'Tap, UPG, HyperPay, Sadad — gateway health, declines, reconciliation.', aliases: ['Payments/Tap'],
    keywords: ['payment', 'tap', 'upg', 'hyperpay', 'sadad', 'gateway', 'decline', 'refund', 'checkout', 'reconcil'] },
  { key: 'rafm', name: 'Subex · Revenue assurance & fraud', business: 'both', domain: 'rafm', level: 'L2', vendor_id: 'subex', contract_id: 'subex-138-2022', sort: 71,
    description: 'HyperSense fraud management and revenue-assurance controls (SALAM-CONT-138-2022).', aliases: [], keywords: ['fraud', 'revenue', 'leak', 'assurance', 'anomaly'] },
  { key: 'network-noc', name: 'Network NOC', business: 'both', domain: 'network', level: 'L2', sort: 80,
    description: 'Core, access and transport — MVNO link, FTTH access, DNS, firewall, load balancers.', aliases: ['Network'],
    keywords: ['network', 'link', 'latency', 'timeout', 'dns', 'firewall', 'fw', 'lb', 'vpn', 'packet', 'mvno link', 'olt', 'ont'] },
  { key: 'soc', name: 'Security Operations (SOC)', business: 'both', domain: 'soc', level: 'L2', sort: 81,
    description: 'Security incidents, suspicious access, credential and certificate events, WAF.', aliases: ['SOC'],
    keywords: ['security', 'attack', 'brute', 'suspicious', 'waf', 'ddos', 'unauthori', 'breach', 'token'] },
  { key: 'sales-ops', name: 'Sales Operations', business: 'both', domain: 'sales', level: 'L1', sort: 90,
    description: 'Dealers, POSA, partner channels, campaigns and promotions.', aliases: ['Sales Ops'],
    keywords: ['dealer', 'posa', 'partner', 'campaign', 'promo', 'voucher', 'sales'] },
  { key: 'otp-vendor', name: 'OTP / SMS vendor (Unifonic)', business: 'both', domain: 'other', level: 'L2', sort: 91,
    description: 'SMS / OTP delivery vendor escalation.', aliases: ['Vendor-OTP'], keywords: ['sms', 'otp', 'unifonic', 'delivery'] },
];

async function ensureSchema() {
  const q = C();
  await q.query(`CREATE TABLE IF NOT EXISTS console_teams (
      key text PRIMARY KEY, name text NOT NULL, business text NOT NULL DEFAULT 'both', domain text NOT NULL DEFAULT 'other', level text NOT NULL DEFAULT 'L2',
      vendor_id text, contract_id text, description text, mail_dl text, channel text,
      aliases jsonb NOT NULL DEFAULT '[]', keywords jsonb NOT NULL DEFAULT '[]',
      active boolean NOT NULL DEFAULT true, seeded boolean NOT NULL DEFAULT false, sort integer NOT NULL DEFAULT 100,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by text)`);
  await q.query(`CREATE TABLE IF NOT EXISTS console_user_teams (
      email text NOT NULL, team_key text NOT NULL REFERENCES console_teams(key) ON DELETE CASCADE,
      can_ack boolean NOT NULL DEFAULT true, can_resolve boolean NOT NULL DEFAULT true, can_reassign boolean NOT NULL DEFAULT true,
      added_at timestamptz NOT NULL DEFAULT now(), added_by text, PRIMARY KEY (email, team_key))`);
  await q.query(`CREATE TABLE IF NOT EXISTS alert_rule_team_suggestions (
      id bigserial PRIMARY KEY, rule_key text UNIQUE NOT NULL, segment text NOT NULL DEFAULT 'mvno', current_team text, suggested_team text NOT NULL,
      confidence real, method text NOT NULL DEFAULT 'rule', reason text, alternatives jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'proposed', decided_by text, decided_at timestamptz, rule_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  for (const s of [`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rule'`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_by text`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS reassign_count integer NOT NULL DEFAULT 0`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS reassigned_at timestamptz`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS first_ack_at timestamptz`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS priority_note text`]) await q.query(s).catch(() => {});
  /* merge the seed by key: adds what is missing; a seeded row nobody edited (updated_by IS NULL) follows the seed —
   * e.g. 24 Sep 2026: Sigma does not cover Mobile, so bss-l2 / oss-l2 / infra-l2 became Fixed-only and TCS took the
   * Mobile BSS keywords. A row an admin saved in Settings › Teams is never touched. */
  for (const t of SEED) {
    await q.query(`INSERT INTO console_teams (key, name, business, domain, level, vendor_id, contract_id, description, aliases, keywords, seeded, sort)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
        ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, business=EXCLUDED.business, domain=EXCLUDED.domain, level=EXCLUDED.level, vendor_id=EXCLUDED.vendor_id, contract_id=EXCLUDED.contract_id,
          description=EXCLUDED.description, aliases=EXCLUDED.aliases, keywords=EXCLUDED.keywords, sort=EXCLUDED.sort, updated_at=now()
        WHERE console_teams.seeded AND console_teams.updated_by IS NULL`,
      [t.key, t.name, t.business, t.domain, t.level, t.vendor_id || null, t.contract_id || null, t.description || null, JSON.stringify(t.aliases || []), JSON.stringify(t.keywords || []), t.sort || 100]);
  }
}

/* ---- registry ---- */
let _cache = { at: 0, rows: [] };
async function list({ all = false } = {}) {
  if (all || Date.now() - _cache.at > 15000) {
    const rows = (await C().query(`SELECT t.*, (SELECT count(*)::int FROM console_user_teams m WHERE m.team_key=t.key) AS members FROM console_teams t ORDER BY sort, name`)).rows;
    if (!all) _cache = { at: Date.now(), rows: rows.filter(r => r.active) };
    return all ? rows : _cache.rows;
  }
  return _cache.rows;
}
function invalidate() { _cache.at = 0; }
/* a team from a key, a legacy label or a name (case-insensitive) — null when nothing matches */
async function resolve(label) {
  if (!label) return null; const s = String(label).trim().toLowerCase(); if (!s) return null;
  const rows = await list();
  return rows.find(t => t.key === s) || rows.find(t => String(t.name).toLowerCase() === s) || rows.find(t => (t.aliases || []).some(a => String(a).toLowerCase() === s)) || null;
}
async function get(key) { return (await C().query(`SELECT * FROM console_teams WHERE key=$1`, [key])).rows[0] || null; }
async function upsert(key, b, actor) {
  const k = String(key || b.key || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!k) throw new Error('team key required');
  const business = BUSINESSES.includes(b.business) ? b.business : 'both';
  const domain = DOMAINS[b.domain] ? b.domain : 'other';
  const level = LEVELS.includes(b.level) ? b.level : 'L2';
  const arr = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : (typeof v === 'string' ? v.split(/[,\n]/).map(x => x.trim()).filter(Boolean) : []);
  const cur = await get(k);
  const row = {
    name: String(b.name || (cur && cur.name) || k).slice(0, 120), business, domain, level,
    vendor_id: b.vendor_id === undefined ? (cur && cur.vendor_id) : (b.vendor_id || null), contract_id: b.contract_id === undefined ? (cur && cur.contract_id) : (b.contract_id || null),
    description: b.description === undefined ? (cur && cur.description) : String(b.description || '').slice(0, 600), mail_dl: b.mail_dl === undefined ? (cur && cur.mail_dl) : String(b.mail_dl || '').slice(0, 300),
    channel: b.channel === undefined ? (cur && cur.channel) : String(b.channel || '').slice(0, 120),
    aliases: b.aliases === undefined ? (cur ? cur.aliases : []) : arr(b.aliases), keywords: b.keywords === undefined ? (cur ? cur.keywords : []) : arr(b.keywords),
    active: b.active === undefined ? (cur ? cur.active : true) : !!b.active, sort: b.sort === undefined ? (cur ? cur.sort : 100) : (Number(b.sort) || 100),
  };
  await C().query(`INSERT INTO console_teams (key, name, business, domain, level, vendor_id, contract_id, description, mail_dl, channel, aliases, keywords, active, sort, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, business=EXCLUDED.business, domain=EXCLUDED.domain, level=EXCLUDED.level, vendor_id=EXCLUDED.vendor_id, contract_id=EXCLUDED.contract_id,
        description=EXCLUDED.description, mail_dl=EXCLUDED.mail_dl, channel=EXCLUDED.channel, aliases=EXCLUDED.aliases, keywords=EXCLUDED.keywords, active=EXCLUDED.active, sort=EXCLUDED.sort, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [k, row.name, row.business, row.domain, row.level, row.vendor_id || null, row.contract_id || null, row.description || null, row.mail_dl || null, row.channel || null, JSON.stringify(row.aliases), JSON.stringify(row.keywords), row.active, row.sort, actor || null]);
  invalidate();
  return get(k);
}

/* ---- membership ---- */
async function membersOf(key) {
  return (await C().query(`SELECT m.email, m.can_ack, m.can_resolve, m.can_reassign, m.added_at, u.name, u.business, u.enabled, u.ack_mobile, u.ack_fixed
      FROM console_user_teams m LEFT JOIN console_users u ON lower(u.email)=lower(m.email) WHERE m.team_key=$1 ORDER BY coalesce(u.name, m.email)`, [key])).rows;
}
async function teamsOf(email) {
  if (!email) return [];
  return (await C().query(`SELECT m.team_key AS key, t.name, t.business, t.domain, t.level, t.vendor_id, t.contract_id, m.can_ack, m.can_resolve, m.can_reassign
      FROM console_user_teams m JOIN console_teams t ON t.key=m.team_key WHERE lower(m.email)=lower($1) AND t.active ORDER BY t.sort`, [email])).rows;
}
async function allMemberships() {
  const out = {};
  for (const r of (await C().query(`SELECT email, team_key, can_ack, can_resolve, can_reassign FROM console_user_teams`)).rows) (out[r.email.toLowerCase()] = out[r.email.toLowerCase()] || []).push({ key: r.team_key, can_ack: r.can_ack, can_resolve: r.can_resolve, can_reassign: r.can_reassign });
  return out;
}
/* replace the member set of ONE team, or the team set of ONE user — both go through here */
async function setMembers(teamKey, members, actor) {
  const q = C(); const t = await get(teamKey); if (!t) throw new Error('no such team');
  await q.query(`DELETE FROM console_user_teams WHERE team_key=$1`, [teamKey]);
  for (const m of (members || [])) {
    const email = String(m.email || m).trim().toLowerCase(); if (!email) continue;
    await q.query(`INSERT INTO console_user_teams (email, team_key, can_ack, can_resolve, can_reassign, added_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [email, teamKey, m.can_ack !== false, m.can_resolve !== false, m.can_reassign !== false, actor || null]);
  }
  invalidate();
  return membersOf(teamKey);
}
async function setUserTeams(email, teams, actor) {
  const q = C(); const e = String(email || '').trim().toLowerCase(); if (!e) throw new Error('email required');
  await q.query(`DELETE FROM console_user_teams WHERE lower(email)=$1`, [e]);
  for (const t of (teams || [])) {
    const key = String(t.key || t).trim(); if (!key) continue;
    await q.query(`INSERT INTO console_user_teams (email, team_key, can_ack, can_resolve, can_reassign, added_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [e, key, t.can_ack !== false, t.can_resolve !== false, t.can_reassign !== false, actor || null]).catch(() => {});
  }
  invalidate();
  return teamsOf(e);
}

/* ---- rights on an incident ---- */
async function canActOn(req, alert, what /* ack | resolve | reassign */) {
  const caps = req.caps || {};
  if (!caps.ackErrors) return { ok: false, why: `role ${req.roleName} lacks ackErrors` };
  if (caps.manageSync || caps.manageUsers) return { ok: true, via: 'admin' };
  const actor = String(req.actor || '').toLowerCase();
  if (actor && (String(alert.ack_by || '').toLowerCase() === actor || String(alert.created_by || '').toLowerCase() === actor)) return { ok: true, via: 'holder' };   // the ack holder / the person who opened the ticket
  const team = await resolve(alert.team);
  if (team) {
    const m = (await C().query(`SELECT can_ack, can_resolve, can_reassign FROM console_user_teams WHERE lower(email)=$1 AND team_key=$2`, [actor, team.key])).rows[0];
    if (m && (what === 'ack' ? m.can_ack : what === 'resolve' ? m.can_resolve : what === 'reassign' ? m.can_reassign : true)) return { ok: true, via: 'team', team: team.key };
    if (m) return { ok: false, why: `You are a member of ${team.name} without the right to ${what} its incidents — an admin can grant it in Settings › Teams.`, team: team.key };
  }
  const seg = require('./segment').segOf(alert);
  const u = (await C().query(`SELECT ack_mobile, ack_fixed FROM console_users WHERE lower(email)=$1`, [actor])).rows[0];
  if (u && (seg === 'fixed' ? u.ack_fixed : u.ack_mobile)) return { ok: true, via: 'oncall' };
  if (!team) return { ok: true, via: 'unassigned' };          // nobody owns it yet — anyone who may ack can take it
  return { ok: false, why: `This incident belongs to ${team.name} — you are not a member and not an ACK holder for ${seg === 'fixed' ? 'Fixed' : 'Mobile'}. Ask a member to take it, or an admin to add you in Settings › Teams.`, team: team.key };
}
/* who should hear about an incident of this team: members (enabled) + the team mail DL */
async function audienceOf(teamKey) {
  const t = await get(teamKey); if (!t) return { team: null, people: [], dl: null };
  const people = (await membersOf(teamKey)).filter(m => m.enabled !== false).map(m => ({ email: m.email, name: m.name }));
  return { team: t, people, dl: t.mail_dl || null };
}

/* ---- contract obligations that apply to a team (vendor → contract → response/restoration/rca clocks) ---- */
async function obligationsFor(team) {
  if (!team || !team.vendor_id) return null;
  let cfg; try { cfg = await require('./vendorContracts').getConfig(); } catch (e) { return null; }
  const vendor = (cfg.vendors || []).find(v => v.id === team.vendor_id) || null;
  const contract = (cfg.contracts || []).find(c => c.id === (team.contract_id || '')) || (cfg.contracts || []).find(c => c.vendorId === team.vendor_id) || null;
  const obligations = (cfg.obligations || []).filter(o => o.vendorId === team.vendor_id && (!contract || !o.contractId || o.contractId === contract.id));
  const flow = (cfg.escalationFlows || []).find(f => f.vendorId === team.vendor_id && (!contract || f.contractId === contract.id)) || null;
  const pick = cat => obligations.find(o => o.category === cat) || null;
  const clock = o => o ? { id: o.id, title: o.title, target: o.target || {}, weight: o.weight || null, attainmentTarget: o.attainmentTarget || null } : null;
  return {
    vendor: vendor ? { id: vendor.id, name: vendor.name } : { id: team.vendor_id, name: team.vendor_id },
    contract: contract ? { id: contract.id, title: contract.title, status: contract.status || null, effectiveTo: contract.effectiveTo || null, penaltyCap: contract.penaltyCap || null, monthlyPenaltyCapPercent: contract.monthlyPenaltyCapPercent || null } : null,
    response: clock(pick('incident_response')), restoration: clock(pick('restoration')), resolution: clock(pick('resolution')), rca: clock(pick('rca')),
    availability: clock(pick('availability')), others: obligations.filter(o => !['incident_response', 'restoration', 'resolution', 'rca', 'availability'].includes(o.category)).map(o => ({ id: o.id, category: o.category, title: o.title })),
    escalation: flow ? { id: flow.id, title: flow.title, ownerGroup: flow.ownerGroup || null, enabled: flow.enabled !== false } : null,
  };
}
/* the block the incident drawer shows: team + the contractual clocks for THIS severity */
async function incidentContract(alert) {
  const team = await resolve(alert.team); if (!team) return { team: null };
  const ob = await obligationsFor(team);
  const sev = alert.severity || 'P3';
  const at = c => c && c.target ? (c.target[sev] || c.target[sev.toLowerCase()] || null) : null;
  return { team: { key: team.key, name: team.name, business: team.business, domain: team.domain, level: team.level, vendor_id: team.vendor_id, contract_id: team.contract_id, mail_dl: team.mail_dl },
    contract: ob ? { ...ob, forSeverity: { response: at(ob.response), restoration: at(ob.restoration), resolution: at(ob.resolution), rca: at(ob.rca) } } : null };
}

/* ---- deterministic rule → team scoring (Agent 2 calls this first; the model only sees the ambiguous ones) ---- */
function scoreRule(rule, teams) {
  const seg = (rule.segment === 'fixed' || /^fixed_/.test(rule.key || '')) ? 'fixed' : 'mvno';
  const biz = seg === 'fixed' ? 'fixed' : 'mobile';
  const hay = [rule.key, rule.name, rule.metric_key, rule.description, rule.alert_class, rule.trigger_codes].map(x => String(x || '').toLowerCase()).join(' ');
  const scored = teams.filter(t => t.active !== false && (t.business === 'both' || t.business === biz)).map(t => {
    let s = 0; const hits = [];
    for (const k of (t.keywords || [])) { const kk = String(k).toLowerCase(); if (kk && hay.includes(kk)) { s += kk.length > 4 ? 2 : 1; hits.push(kk); } }
    if (t.business === biz) s += 0.5;                                     // the side-specific team edges the generic one
    if (t.level === 'L1' && s > 0) s -= 0.25;                             // L1 keeps the incident only when nothing more specific matches
    return { key: t.key, name: t.name, score: s, hits };
  }).sort((a, b) => b.score - a.score);
  const hit = scored.filter(x => x.hits.length);                 // a team with no keyword hit is never a candidate (the side bonus alone means nothing)
  const top = hit[0], second = hit[1];
  const confident = !!(top && top.score >= 2 && (!second || top.score - second.score >= 1.5));
  return { seg, top: top || null, second: second || null, confident, ranked: hit.slice(0, 5) };
}

module.exports = { DOMAINS, LEVELS, BUSINESSES, SEED, ensureSchema, list, invalidate, resolve, get, upsert, membersOf, teamsOf, allMemberships, setMembers, setUserTeams, canActOn, audienceOf, obligationsFor, incidentContract, scoreRule };
