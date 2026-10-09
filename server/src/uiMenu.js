/* uiMenu.js — the console's header menus, managed in Settings › Navigation (alpha.160, 9 Oct 2026).
 *
 * One shared layout for everyone (console_settings key `ui_menu`); each person still sees only the pages their role
 * and business allow — the frontend hides an entry whose page the session lacks, and the router denies a deep link
 * regardless. No stored layout = the default, which is the markup in index.html.
 *
 * Shape — one submenu level, never deeper:
 *   { v: 1, items: [ entry … ], updatedAt, updatedBy }
 *   entry (top level)   { t:'page', key, label? }          a console page (key from the catalogue: v:<view> · fx:<tab> · if:<tab>)
 *                       { t:'link', label, href }          a console address (#…) or an external link (https://…)
 *                       { t:'menu', key, label, items:[…] } a dropdown — its items are pages, links and labels
 *   entry (in a menu)   page · link · { t:'head', label }  a plain label (divider) — never at the top level
 *   known: [pageKey…]  every console page that existed when the layout was saved — a page added by a later release is
 *                      not in it, so the header places it where the default markup puts it instead of hiding it
 *   page · link · menu may carry roles:[roleKey…] — the entry (a whole menu) shows only to those roles; none = every role
 *   that can open the page. It is presentation: who may OPEN a page is still the role's permissions (router + API gates).
 * A page appears once; a menu cannot hold a menu. */
'use strict';

const LABEL_MAX = 48;
const MAX_TOP = 40, MAX_CHILDREN = 60;
const PAGE_KEY = /^(v|fx|if):[A-Za-z0-9_.:@-]{1,80}$/;
const MENU_KEY = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const HASH = /^#[A-Za-z0-9_\-/?=&.%:+,~@!*'()]{0,300}$/;

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
function cleanLabel(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
}
/* a console address (#route?query) or an http(s) link; anything else (javascript:, data:, //host, spaces) is refused */
function cleanHref(h) {
  const s = String(h == null ? '' : h).trim();
  if (HASH.test(s)) return s;
  if (/^https?:\/\/\S{3,500}$/i.test(s) && !/["'<>`\\]/.test(s)) {
    try { const u = new URL(s); if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) return u.toString(); } catch (_) { /* refused below */ }
  }
  return null;
}

const ROLE_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/* roles: a list of known role keys (dedupe, order kept); unknown keys are refused rather than dropped, so a typo never
 * silently widens who sees an entry */
function cleanRoles(list, label, known) {
  if (list == null) return null;
  if (!Array.isArray(list)) throw bad(`"${label}": roles must be a list`);
  const out = [];
  for (const r of list) {
    const k = String(r || '');
    if (!ROLE_KEY.test(k) || (known && !known.has(k))) throw bad(`"${label}": unknown role "${k.slice(0, 40)}"`);
    if (!out.includes(k)) out.push(k);
  }
  if (out.length > 60) throw bad(`"${label}": too many roles`);
  return out.length ? out : null;
}
function validate(items, knownRoles) {
  if (!Array.isArray(items)) throw bad('items must be a list');
  const known = knownRoles ? new Set(knownRoles) : null;
  const withRoles = (o, x, label) => { const r = cleanRoles(x.roles, label, known); if (r) o.roles = r; return o; };
  if (items.length > MAX_TOP) throw bad(`at most ${MAX_TOP} entries at the top level`);
  const pages = new Set(), menus = new Set();
  const entry = (x, depth) => {
    if (!x || typeof x !== 'object') throw bad('an entry is not an object');
    const label = cleanLabel(x.label);
    switch (x.t) {
      case 'page': {
        const key = String(x.key || '');
        if (!PAGE_KEY.test(key)) throw bad(`unknown page "${key.slice(0, 40)}"`);
        if (pages.has(key)) throw bad(`the page "${label || key}" is in the menus twice — add a link instead`);
        pages.add(key);
        return withRoles(label ? { t: 'page', key, label } : { t: 'page', key }, x, label || key);
      }
      case 'link': {
        if (!label) throw bad('a link needs a label');
        const href = cleanHref(x.href);
        if (!href) throw bad(`"${label}": the target must be a console address (#…) or an https:// link`);
        return withRoles({ t: 'link', label, href }, x, label);
      }
      case 'head': {
        if (depth === 0) throw bad(`"${label || 'label'}": a label can only sit inside a menu`);
        if (!label) throw bad('a label needs a text');
        return { t: 'head', label };
      }
      case 'menu': {
        if (depth > 0) throw bad(`"${label || 'menu'}": a menu cannot sit inside another menu — one submenu level only`);
        if (!label) throw bad('a menu needs a label');
        const key = String(x.key || '');
        if (!MENU_KEY.test(key)) throw bad(`"${label}": bad menu key`);
        if (menus.has(key)) throw bad(`"${label}": the menu is there twice`);
        menus.add(key);
        const kids = Array.isArray(x.items) ? x.items : [];
        if (kids.length > MAX_CHILDREN) throw bad(`"${label}": at most ${MAX_CHILDREN} entries in a menu`);
        return withRoles({ t: 'menu', key, label, items: kids.map(k => entry(k, 1)) }, x, label);
      }
      default: throw bad(`unknown entry type "${String(x.t).slice(0, 20)}"`);
    }
  };
  return items.map(x => entry(x, 0));
}

function stats(items) {
  let menus = 0, pages = 0, links = 0, heads = 0, restricted = 0;
  const count = x => { if (x.roles) restricted++; if (x.t === 'menu') { menus++; x.items.forEach(count); } else if (x.t === 'page') pages++; else if (x.t === 'link') links++; else if (x.t === 'head') heads++; };
  items.forEach(count);
  return { top: items.length, menus, pages, links, labels: heads, restricted };
}

function mount(app, { settings, audit, requireSuper, roleKeys }) {
  app.get('/api/ui-nav/menu', async (req, res) => {
    try { res.json({ menu: (await settings.getSetting('ui_menu')) || null }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/ui-nav/menu', requireSuper, async (req, res) => {
    try {
      const body = req.body || {};
      const items = validate(body.items, roleKeys ? roleKeys() : null);
      const known = Array.isArray(body.known) ? [...new Set(body.known.map(String).filter(k => PAGE_KEY.test(k)))].slice(0, 500) : null;
      const menu = { v: 1, items, known, updatedAt: new Date().toISOString(), updatedBy: req.actor || null };
      await settings.setSetting('ui_menu', menu);
      await audit(req, 'uinav.menu', null, stats(items));
      res.json({ menu });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/ui-nav/menu', requireSuper, async (req, res) => {
    try {
      await settings.setSetting('ui_menu', null);
      await audit(req, 'uinav.menu', null, { reset: true });
      res.json({ menu: null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { validate, cleanHref, cleanLabel, cleanRoles, stats, mount, LABEL_MAX };
