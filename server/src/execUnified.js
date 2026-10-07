/* execUnified.js — Home › Executive and Home › Operations: both businesses on one page.
 *
 *   GET /api/exec?range=7d|30d      any signed-in user; each half is included only if the caller holds
 *                                   that business's view (dashboard → Mobile, fixed → Fixed) and business.
 * Returns { mobile, fixed, status, summary, generatedAt } — the halves are the execContract shapes the
 * single-business endpoints return, untouched; the page renders them side by side with a business badge.
 * status = the worse of the two; summary = each business's first line, prefixed. */
const fixedExec = require('./fixedExec');
const mvnoExec = require('./mvnoExec');
const respCache = require('./respCache');
const RANK = { CRITICAL: 3, WARNING: 2, HEALTHY: 1 };

function mount(app, deps) {
  app.get('/api/exec', async (req, res) => {
    try {
      const views = req.views || [], biz = req.business || 'both';
      const wantM = views.includes('dashboard') && biz !== 'fixed', wantF = views.includes('fixed') && biz !== 'mobile';
      /* measured 7.3 s on 152 (7 Oct 2026): 30-day aggregates over the replica + the Fixed read models, asked on every Home
       * open. Cached like /api/home (stale-while-revalidate, keep-warm). The answer depends on which halves the caller may
       * see, so the cache key carries that scope — a Fixed-only user never receives the Mobile half from the cache. */
      const u = req.originalUrl || req.url || '/api/exec';
      const scoped = { originalUrl: u + (u.includes('?') ? '&' : '?') + '_scope=' + (wantM ? 'm' : '') + (wantF ? 'f' : ''), get: h => req.get(h) };
      return res.json(await respCache.wrap(scoped, () => execBody(req.query, wantM, wantF, deps)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
async function execBody(query, wantM, wantF, deps) {
  const [mobile, fixed] = await Promise.all([
    wantM ? mvnoExec.exec(query, deps).catch(e => { console.error('[exec] mobile half failed:', e.message); return { configured: false, biz: 'mobile', label: 'Mobile', reason: e.message }; }) : null,
    wantF ? fixedExec.exec(query).catch(e => { console.error('[exec] fixed half failed:', e.message); return { configured: false, biz: 'fixed', label: 'Fixed', reason: e.message }; }) : null,
  ]);
  const halves = [mobile, fixed].filter(h => h && h.configured);
  const status = halves.reduce((w, h) => RANK[h.status] > RANK[w] ? h.status : w, 'HEALTHY');
  const summary = halves.flatMap(h => [`${h.label}: ${h.summary[0]}`, `${h.label}: ${h.summary[1]}`]);
  // a half the caller SHOULD see but that failed is reported, not hidden - a one-business page that
  // silently looks complete is worse than a page that says which half is missing and why
  const missing = [mobile, fixed].filter(h => h && !h.configured).map(h => ({ biz: h.biz, label: h.label, reason: h.reason }));
  return { generatedAt: new Date().toISOString(), range: (halves[0] || {}).range || 'auto',
    status: halves.length ? status : 'HEALTHY', summary, missing, mobile, fixed };
}
module.exports = { mount };
