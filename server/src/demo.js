/* demo.js — Demo mode: record-and-replay at the API boundary.
 *
 * WHY: a demo cannot depend on a cold cache, a lagging replica or a slow LLM. Every page of this
 * console is vanilla JS calling GET /api/…, so the cheapest way to make ALL of them instant is to
 * intercept at that boundary: while the presenter RECORDS, every JSON response the pages fetch is
 * stored (per named set) in the console DB; while they REPLAY, those bodies are served in ~1 ms —
 * no replica, no OPS pool, no SSH, no LLM — and anything not recorded falls through to live.
 *
 * SAFETY: per-user (demo_users keyed by session e-mail) — everyone else keeps live data. Prod tables
 * are never written: the only writes are demo_* tables. Mutating calls in replay never reach a
 * handler: a recorded response is returned, else a polite "demo mode — nothing was changed".
 *
 * FEELS LIVE: on replay, timestamps inside the body are shifted by (now − captured_at): ISO strings,
 * "YYYY-MM-DD HH:MM:SS", epoch-ms numbers; date-only "YYYY-MM-DD" by whole days so daily series keep
 * their shape. Keys are never touched.
 *
 * WARM-UP: the set flagged `warmup` is replayed against the server itself after boot (loopback auth,
 * X-Demo-Bypass so it hits the real handlers) — fills respCache so the first Home paint after a
 * deploy is fast for everyone, demo or not.
 */
'use strict';
const crypto = require('crypto');
const db = require('./db');
const C = () => db.console;

const OFF = { mode: 'off', set: null };
/* fixed/leads (9 Oct 2026): the OCU leads are never recorded nor replayed — a snapshot would keep confidential answers outside their gate */
const SKIP = /^\/api\/(demo|auth|session|stream|version|health|ready|cache-stats|me\/dashboard|fixed\/leads)(\/|$)/;
const VOLATILE = new Set(['_', 't', 'ts', 'nocache', 'token', 'cb']);
const stateCache = new Map();          // email → { mode, set }
let ready = null;

/* ---- schema (console DB only) ------------------------------------------------------------- */
function ensure() {
  if (ready) return ready;
  ready = (async () => {
    await C().query(`CREATE TABLE IF NOT EXISTS demo_sets (
      name text PRIMARY KEY, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
      note text, warmup boolean NOT NULL DEFAULT false)`);
    await C().query(`CREATE TABLE IF NOT EXISTS demo_snapshots (
      id bigserial PRIMARY KEY, set_name text NOT NULL REFERENCES demo_sets(name) ON DELETE CASCADE,
      method text NOT NULL, key text NOT NULL, path text NOT NULL, status int NOT NULL DEFAULT 200,
      body jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), hits int NOT NULL DEFAULT 0,
      UNIQUE (set_name, method, key))`);
    await C().query(`CREATE TABLE IF NOT EXISTS demo_users (
      email text PRIMARY KEY, mode text NOT NULL DEFAULT 'off', set_name text, updated_at timestamptz NOT NULL DEFAULT now())`);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

/* ---- per-user state ------------------------------------------------------------------------ */
async function getState(email) {
  if (!email) return OFF;
  if (stateCache.has(email)) return stateCache.get(email);
  await ensure();
  const r = await C().query(`SELECT mode, set_name FROM demo_users WHERE email=$1`, [email]);
  const s = r.rows[0] && r.rows[0].mode !== 'off' ? { mode: r.rows[0].mode, set: r.rows[0].set_name } : OFF;
  stateCache.set(email, s);
  return s;
}
async function setState(email, mode, set) {
  await ensure();
  if (!['off', 'record', 'replay'].includes(mode)) throw new Error('mode must be off | record | replay');
  if (mode !== 'off') {
    if (!set || !/^[\w .-]{1,60}$/.test(set)) throw new Error('set name: letters, digits, space, . _ - (max 60)');
    if (mode === 'record') await C().query(`INSERT INTO demo_sets (name, created_by) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [set, email]);
    else { const r = await C().query(`SELECT 1 FROM demo_sets WHERE name=$1`, [set]); if (!r.rowCount) throw new Error(`set "${set}" does not exist — record it first`); }
  }
  await C().query(`INSERT INTO demo_users (email, mode, set_name, updated_at) VALUES ($1,$2,$3,now())
    ON CONFLICT (email) DO UPDATE SET mode=EXCLUDED.mode, set_name=EXCLUDED.set_name, updated_at=now()`, [email, mode, mode === 'off' ? null : set]);
  const s = mode === 'off' ? OFF : { mode, set };
  stateCache.set(email, s);
  return s;
}

/* ---- request identity ----------------------------------------------------------------------- */
function keyOf(req) {
  const [path, qs = ''] = (req.originalUrl || req.url).split('?');
  const parts = qs.split('&').filter(Boolean).map(kv => { const i = kv.indexOf('='); return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]; })
    .filter(([k]) => !VOLATILE.has(k)).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k, v]) => k + '=' + v);
  let key = path + (parts.length ? '?' + parts.join('&') : '');
  if (req.method !== 'GET') {
    const b = req.body || {};
    const sig = path === '/api/assist/chat'
      ? String(b.message || '').toLowerCase().replace(/\s+/g, ' ').trim()
      : JSON.stringify(b);
    key += '#' + crypto.createHash('sha1').update(sig).digest('hex').slice(0, 16);
  }
  return { key, path };
}

/* ---- time shift ----------------------------------------------------------------------------- */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/;
const SQLTS = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
function shift(v, delta) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(x => shift(x, delta));
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = shift(v[k], delta); return o; }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v > 1.5e12 && v < 2.5e12) return v + delta;      // epoch ms
    return v;
  }
  if (typeof v !== 'string') return v;
  if (ISO.test(v)) return new Date(new Date(v).getTime() + delta).toISOString();
  const m = SQLTS.exec(v);
  if (m) { const d = new Date(new Date(m[1] + 'T' + m[2] + 'Z').getTime() + delta); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
  if (DAY.test(v)) { const days = Math.floor(delta / 864e5); if (!days) return v; const d = new Date(new Date(v + 'T00:00:00Z').getTime() + days * 864e5); return d.toISOString().slice(0, 10); }
  return v;
}

/* ---- middleware ----------------------------------------------------------------------------- */
function middleware(req, res, next) {
  const p = req.path;
  if (!p.startsWith('/api/') || SKIP.test(p) || !req.sessionEmail) return next();
  if (req.get('X-Demo-Bypass') && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return next();
  getState(req.sessionEmail).then(st => {
    if (st.mode === 'off') return next();
    const { key, path } = keyOf(req);
    const recordable = req.method === 'GET' || path === '/api/assist/chat';
    if (st.mode === 'record') {
      if (recordable) {
        const orig = res.json.bind(res);
        res.json = body => {
          if (res.statusCode === 200 && body && typeof body === 'object' && !body.error) save(st.set, req.method, key, path, body).catch(() => {});
          return orig(body);
        };
      }
      res.set('X-Demo', 'record');
      return next();
    }
    // replay
    C().query(`UPDATE demo_snapshots SET hits=hits+1 WHERE set_name=$1 AND method=$2 AND key=$3 RETURNING body, captured_at`, [st.set, req.method, key])
      .then(r => {
        res.set('X-Demo', 'replay');
        if (r.rowCount) { res.set('Cache-Control', 'no-store'); return res.json(shift(r.rows[0].body, Date.now() - new Date(r.rows[0].captured_at).getTime())); }
        if (recordable) return next();                                   // not recorded → live
        return res.json({ ok: true, demo: true, message: 'Demo mode — nothing was changed' });
      }).catch(() => next());
  }).catch(() => next());
}
async function save(set, method, key, path, body) {
  const s = JSON.stringify(body);
  if (s.length > 4 * 1024 * 1024) return;                              // never store a 4 MB+ body
  await C().query(`INSERT INTO demo_snapshots (set_name, method, key, path, body, captured_at) VALUES ($1,$2,$3,$4,$5::jsonb,now())
    ON CONFLICT (set_name, method, key) DO UPDATE SET body=EXCLUDED.body, captured_at=now()`, [set, method, key, path, s]);
}

/* ---- demo path checklist (coverage shown in Settings → Demo) ------------------------------- */
const CHECKLIST = [
  ['Home (global KPIs, anomalies, growth)', /^\/api\/(home|noc|anomalies|growth)/],
  ['Mobile dashboard', /^\/api\/(home\/|onboarding-flow|payments\/deep-dive|plans\/flow)/],
  ['Monitoring — gateway & API health', /^\/api\/(monitoring|apigw|login\/)/],
  ['Alerts (Mobile) & anomaly rules', /^\/api\/(alerts|rules|anomaly|incidents|metrics\/series)/],
  ['Fixed overview', /^\/api\/fixed\/(summary|b2c|attempts)/],
  ['Fixed › SDA map', /^\/api\/fixed\/map/],
  ['Fixed › Errors', /^\/api\/fixed\/errors/],
  ['Fixed › Alerts', /^\/api\/fixed\/alerts/],
  ['Customer 360 (Mobile)', /^\/api\/subscriber/],
  ['Customer 360 (Fixed)', /^\/api\/fixed\/customer/],
  ['Tickets', /^\/api\/tickets/],
  ['Yusr answers', /^\/api\/assist\/chat/],
];

/* ---- warm-up: replay the flagged set against ourselves to fill respCache -------------------- */
async function warmup({ set, port, user } = {}) {
  await ensure();
  const name = set || (await C().query(`SELECT name FROM demo_sets WHERE warmup ORDER BY created_at DESC LIMIT 1`)).rows.map(r => r.name)[0];
  if (!name) return { warmed: 0, set: null, reason: 'no set flagged for warm-up' };
  const keys = (await C().query(`SELECT key FROM demo_snapshots WHERE set_name=$1 AND method='GET' ORDER BY id`, [name])).rows.map(r => r.key);
  const base = `http://127.0.0.1:${port || process.env.PORT || 4600}`;
  const hdr = { 'X-Console-User': user || process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa', 'X-Demo-Bypass': '1' };
  let ok = 0, fail = 0; const t0 = Date.now();
  const queue = keys.slice();
  await Promise.all([1, 2, 3].map(async () => {
    while (queue.length) {
      const k = queue.shift();
      try { const r = await fetch(base + k, { headers: hdr, signal: AbortSignal.timeout(60000) }); r.ok ? ok++ : fail++; await r.arrayBuffer(); } catch (e) { fail++; }
    }
  }));
  const out = { set: name, warmed: ok, failed: fail, ms: Date.now() - t0 };
  console.log(`[DEMO] warm-up "${name}": ${ok} ok, ${fail} failed in ${out.ms} ms`);
  return out;
}
function startWarmup() {
  if (process.env.DEMO_WARMUP === '0') return;
  setTimeout(() => { warmup().catch(e => console.error('[DEMO] warm-up failed:', e.message)); }, 20000);
}

/* ---- routes --------------------------------------------------------------------------------- */
function mount(app, { requireCap, audit }) {
  const gate = requireCap ? requireCap('manageSync') : (req, res, next) => next();
  const sets = async () => (await C().query(
    `SELECT s.name, s.note, s.warmup, s.created_by, s.created_at, count(d.id)::int AS responses, max(d.captured_at) AS captured_at,
            coalesce(sum(d.hits),0)::int AS hits FROM demo_sets s LEFT JOIN demo_snapshots d ON d.set_name=s.name
      GROUP BY s.name ORDER BY s.created_at DESC`)).rows;
  const coverage = async name => {
    const paths = name ? (await C().query(`SELECT DISTINCT path, method FROM demo_snapshots WHERE set_name=$1`, [name])).rows : [];
    return CHECKLIST.map(([label, re]) => ({ label, recorded: paths.filter(p => re.test(p.path)).length }));
  };
  app.get('/api/demo/state', async (req, res) => {
    try { await ensure(); const st = await getState(req.sessionEmail);
      res.json({ ...st, sets: await sets(), coverage: await coverage(st.set || (req.query.set || null)), checklist: CHECKLIST.map(c => c[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/demo/state', gate, async (req, res) => {
    try { const { mode, set } = req.body || {}; const st = await setState(req.sessionEmail, mode, set);
      if (audit) audit(req, 'demo.mode', mode, { set: st.set || null });
      res.json({ ...st, sets: await sets(), coverage: await coverage(st.set) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/demo/coverage', gate, async (req, res) => { try { res.json({ set: req.query.set, coverage: await coverage(String(req.query.set || '')) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.patch('/api/demo/sets/:name', gate, async (req, res) => {
    try { const { note, warmup: w } = req.body || {};
      if (w === true) await C().query(`UPDATE demo_sets SET warmup=false`);
      await C().query(`UPDATE demo_sets SET note=coalesce($2,note), warmup=coalesce($3,warmup) WHERE name=$1`, [req.params.name, note ?? null, typeof w === 'boolean' ? w : null]);
      res.json({ ok: true, sets: await sets() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/demo/sets/:name', gate, async (req, res) => {
    try { await C().query(`UPDATE demo_users SET mode='off', set_name=NULL WHERE set_name=$1`, [req.params.name]); stateCache.clear();
      await C().query(`DELETE FROM demo_sets WHERE name=$1`, [req.params.name]);
      if (audit) audit(req, 'demo.set.delete', req.params.name, {});
      res.json({ ok: true, sets: await sets() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/demo/sets/:name/export', gate, async (req, res) => {
    try { const rows = (await C().query(`SELECT method, key, path, status, body, captured_at FROM demo_snapshots WHERE set_name=$1 ORDER BY id`, [req.params.name])).rows;
      res.setHeader('Content-Disposition', `attachment; filename="demo-${req.params.name.replace(/[^\w.-]/g, '_')}.json"`);
      res.setHeader('Content-Type', 'application/json'); res.send(JSON.stringify({ name: req.params.name, exported_at: new Date().toISOString(), rows }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/demo/sets/import', gate, async (req, res) => {
    try { const { name, rows } = req.body || {}; if (!name || !Array.isArray(rows)) throw new Error('body: { name, rows[] }');
      await C().query(`INSERT INTO demo_sets (name, created_by) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [name, req.sessionEmail]);
      let n = 0; for (const r of rows) { if (!r.key || !r.path || r.body == null) continue;
        await C().query(`INSERT INTO demo_snapshots (set_name, method, key, path, status, body, captured_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
          ON CONFLICT (set_name, method, key) DO UPDATE SET body=EXCLUDED.body, captured_at=EXCLUDED.captured_at`,
          [name, r.method || 'GET', r.key, r.path, r.status || 200, JSON.stringify(r.body), r.captured_at || new Date().toISOString()]); n++; }
      res.json({ ok: true, imported: n, sets: await sets() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/demo/warmup', gate, async (req, res) => {
    try { res.json(await warmup({ set: req.body && req.body.set, user: req.sessionEmail })); } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { middleware, mount, startWarmup, warmup, getState, setState, shift, keyOf, CHECKLIST, ensure };
