#!/usr/bin/env node
/* navmenu-check.cjs — after alpha.160 (header menus managed in Settings › Navigation): checks the shipped menu
 * module and reports the saved layout. READ-ONLY (one SELECT on console_settings). Prints no e-mail and no identifier.
 *   cd /apps/unified/server && set -a; . /apps/unified/.env; set +a; node scripts/navmenu-check.cjs */
'use strict';
const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'uiMenu'));
const db = require(path.join(__dirname, '..', 'src', 'db'));
(async () => {
  console.log('version', require(path.join(__dirname, '..', 'package.json')).version);
  const vp = M.validate([{ t: 'menu', key: 'vp', label: 'VP Operations', items: [{ t: 'page', key: 'v:vpcockpit', label: 'VP dashboard' },
    { t: 'link', label: 'Weekly Report', href: '#opsreports?tab=week', roles: ['ops_vp'] }] }]);
  console.log('accepts a menu with one submenu level:', vp.length === 1 && vp[0].items.length === 2);
  const refused = items => { try { M.validate(items); return false; } catch (e) { return e.status === 400; } };
  console.log('refuses a menu inside a menu:', refused([{ t: 'menu', key: 'a', label: 'A', items: [{ t: 'menu', key: 'b', label: 'B', items: [] }] }]));
  console.log('refuses a javascript: target:', refused([{ t: 'link', label: 'x', href: 'javascript:alert(1)' }]));
  const r = await db.console.query("SELECT value FROM console_settings WHERE key = 'ui_menu'");
  const v = r.rows[0] && r.rows[0].value;
  if (!v || !Array.isArray(v.items)) console.log('saved layout: none — everyone sees the default menus (index.html)');
  else console.log('saved layout:', JSON.stringify(M.stats(v.items)), 'saved at', v.updatedAt);
  process.exit(0);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
