/* fixedDocs.js — Fixed › Playbook (SLA / OLA / action plans) + Diagrams for the unified console.
 *
 * Port of salam-dealer-ops packages/api/src/routers/alerts.ts (listDocs · getDoc · saveDoc) over the prod
 * ops_docs table (db.ops = sda_ops.public, READ-ONLY from here). Edits are stored in the console's OWN DB
 * (db.console) in fixed_playbook_overrides and merged over the sda_ops rows on read — an override wins, so the
 * prod console keeps its copy untouched and the unified console shows the edited version. Stage-1 compromise;
 * once the two consoles share one ops DB (plan §5) the overrides fold back into ops_docs.
 * Routes (view 'fixed'):
 *   GET  /api/fixed/playbook/list           → { docs:[{slug,kind,title,related_rule_key,updated_at,updated_by,builtin,overridden}] }
 *   GET  /api/fixed/playbook/doc?slug=      → the doc incl. body (markdown)
 *   POST /api/fixed/playbook/doc            → { slug?, kind, title, body, relatedRuleKey? } (cap editRules) — upsert override
 *   GET  /api/fixed/diagrams/list           → the 4 static diagram pages served from /fixed-diagrams/ */
const KINDS = ['SLA', 'OLA', 'ACTION_PLAN', 'PLAYBOOK', 'DIAGRAM'];
const DIAGRAMS = [
  { slug: 'diagram-payments-topology', order: 1, title: 'Payments Topology (System Map)', tagline: 'The system map',
    blurb: 'Every channel, API, payment rail and BSS/OSS system on one interactive map — click any node to see its role, endpoints and connected flows.',
    url: 'fixed-diagrams/salam-payments-topology.html' },
  { slug: 'diagram-payments-journey', order: 2, title: 'Payments Journey Player', tagline: 'One journey, step by step',
    blurb: 'Press Play and watch a real payment travel through the stack — pick a journey (card paid, SADAD, refund…) and step hop by hop.',
    url: 'fixed-diagrams/salam-payments-journey.html' },
  { slug: 'diagram-payments-flows', order: 3, title: 'Payments Flow Analysis', tagline: 'Deep flow & failure analysis',
    blurb: 'All flow types side by side with their failure modes, retries and SPOFs — where orders stall and why.',
    url: 'fixed-diagrams/salam-payments-flows.html' },
  { slug: 'diagram-journeys-explorer', order: 4, title: 'Journeys Explorer (all dealer & QR journeys)', tagline: 'Every journey, end to end',
    blurb: 'All dealer (FTTH/FTTB/5G/Lead) and QR (e-Purchase) journeys — step through each one, success or failure, with the exact API calls and what stops the order at every step.',
    url: 'fixed-diagrams/salam-journeys-explorer.html' },
  /* The Digital/BSS HLD atlas (11 Sep 2026) — the same interactive atlas the MVNO side has, for Fixed:
   * channels -> digital edge -> 3Scale/OSB -> Oracle BSS -> OSS, network and partners. Light and dark. */
  { slug: 'diagram-fixed-bss-hld', order: 5, title: 'Digital / BSS Topology (HLD)', tagline: 'The whole estate, one map',
    blurb: 'IMPACT B2C Release 5 and 6 view: every channel, the digital edge, the 3Scale/OSB integration hub, the Oracle BSS core and every OSS, network and external partner - click a node to see its role, servers and flows.',
    url: 'fixed-diagrams/salam-fixed-digital-bss-hld.html' },
];

function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

let ensured = null;
function ensureTable(consoleDb) {
  if (!ensured) ensured = consoleDb.query(`CREATE TABLE IF NOT EXISTS fixed_playbook_overrides (
      slug text PRIMARY KEY, title text NOT NULL, kind text NOT NULL, body text NOT NULL DEFAULT '',
      related_rule_key text, updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`).catch(e => { ensured = null; throw e; });
  return ensured;
}

async function overrides(consoleDb, slug) {
  await ensureTable(consoleDb);
  const r = slug
    ? await consoleDb.query(`SELECT slug, title, kind, body, related_rule_key, updated_by, updated_at FROM fixed_playbook_overrides WHERE slug = $1`, [slug])
    : await consoleDb.query(`SELECT slug, title, kind, body, related_rule_key, updated_by, updated_at FROM fixed_playbook_overrides ORDER BY kind, title LIMIT 500`);
  return r.rows;
}

async function list(db) {
  if (!db.ops) throw notConfigured();
  const [base, ov] = await Promise.all([
    db.ops.query(`SELECT slug, kind, title, related_rule_key, updated_at, updated_by, builtin FROM ops_docs WHERE kind <> 'DIAGRAM' ORDER BY kind, title LIMIT 500`),
    overrides(db.console).catch(() => []),
  ]);
  const map = new Map(base.rows.map(r => [r.slug, { ...r, builtin: !!r.builtin, overridden: false }]));
  for (const o of ov) {
    if (o.kind === 'DIAGRAM') continue;
    const prev = map.get(o.slug);
    map.set(o.slug, { slug: o.slug, kind: o.kind, title: o.title, related_rule_key: o.related_rule_key, updated_at: o.updated_at, updated_by: o.updated_by,
      builtin: prev ? prev.builtin : false, overridden: true });
  }
  const order = k => KINDS.indexOf(k) < 0 ? 99 : KINDS.indexOf(k);
  return { docs: [...map.values()].sort((a, b) => order(a.kind) - order(b.kind) || String(a.title).localeCompare(String(b.title))) };
}

async function getDoc(db, slug) {
  if (!db.ops) throw notConfigured();
  slug = String(slug || '').slice(0, 120);
  if (!slug) throw bad('slug required');
  const ov = await overrides(db.console, slug).catch(() => []);
  const base = await db.ops.query(`SELECT slug, kind, title, body, related_rule_key, updated_at, updated_by, builtin, created_at FROM ops_docs WHERE slug = $1`, [slug]);
  const b = base.rows[0];
  if (ov[0]) return { ...ov[0], builtin: b ? !!b.builtin : false, overridden: true, source: 'console' };
  if (!b) { const e = new Error('document not found'); e.status = 404; throw e; }
  return { ...b, builtin: !!b.builtin, overridden: false, source: 'sda_ops' };
}

async function saveDoc(db, body, actor) {
  const kind = String(body.kind || '').toUpperCase();
  if (!KINDS.includes(kind) || kind === 'DIAGRAM') throw bad('kind must be SLA | OLA | ACTION_PLAN | PLAYBOOK');
  const title = String(body.title || '').trim();
  if (title.length < 2 || title.length > 140) throw bad('title must be 2–140 characters');
  const md = String(body.body || '');
  if (md.length > 60000) throw bad('body too large (60k max)');
  const rel = body.relatedRuleKey ? String(body.relatedRuleKey).slice(0, 80) : null;
  const slug = body.slug ? String(body.slug).slice(0, 120) : `${kind.toLowerCase()}-${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
  await ensureTable(db.console);
  await db.console.query(`INSERT INTO fixed_playbook_overrides (slug, title, kind, body, related_rule_key, updated_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, kind=EXCLUDED.kind, body=EXCLUDED.body, related_rule_key=EXCLUDED.related_rule_key,
        updated_by=EXCLUDED.updated_by, updated_at=now()`, [slug, title, kind, md, rel, actor || null]);
  return getDoc(db, slug);
}

function mount(app, deps) {
  const { gate, wrap, audit, db } = deps;
  app.get('/api/fixed/playbook/list', gate, wrap(() => list(db)));
  app.get('/api/fixed/playbook/doc',  gate, wrap(q => getDoc(db, q.slug)));
  app.post('/api/fixed/playbook/doc', gate, async (req, res) => {
    if (!(req.caps && req.caps.editRules)) return res.status(403).json({ error: `role ${req.roleName} lacks editRules` });
    try {
      const doc = await saveDoc(db, req.body || {}, req.actor || req.get('X-Console-User'));
      if (audit) audit(req, 'fixed.playbook.save', doc.slug, { kind: doc.kind, title: doc.title, bytes: String(doc.body || '').length });
      res.json(doc);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/fixed/diagrams/list', gate, (req, res) => res.json({ diagrams: DIAGRAMS }));
}

module.exports = { mount, list, getDoc, saveDoc, DIAGRAMS };
