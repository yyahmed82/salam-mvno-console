#!/usr/bin/env node
/* PRE-CACHE Customer 360 for a list of customers, so a demo never waits on a cold lookup.
 *
 *   node src/warmup.js 2635308931 966511600080 0512345678
 *   node src/warmup.js --file /root/demo-ids.txt        (one id per line, # comments allowed)
 *   node src/warmup.js --clear 2635308931               (forget these customers — both halves)
 *   node src/warmup.js --clear-all                      (forget everyone)
 *
 * CLEARING matters more than it sounds: a stale cached profile in front of an executive is worse
 * than a slow fresh one. --clear drops the in-memory profile AND the persisted nexus row, which is
 * addressed by hash, so only the server can find it — the identifier was deliberately never stored.
 *
 * WHY THIS TALKS TO THE SERVER OVER LOOPBACK INSTEAD OF DOING THE WORK ITSELF:
 * the profile cache lives in the RUNNING server's memory — lookupCache.js writes nothing to disk,
 * deliberately, because a subscriber profile is PII. A standalone CLI would warm its own memory and
 * then exit, having achieved nothing. So this asks the server exactly as a browser would, and the
 * server caches the answer where it is actually used.
 *
 * WHAT EACH ID WARMS:
 *   /api/subscriber                → the mobile profile, into the server's in-memory cache
 *                                    (lost on restart — re-run this after one, or use DEMO_WARM_KEYS)
 *   /api/fixed/customer?warm=1     → the nexus link, into nexus_link_cache, which IS persisted and
 *                                    survives restarts. warm=1 gives that scan a long budget
 *                                    instead of the short one the interactive path allows, so the
 *                                    slow query is paid here, once, and never on screen.
 *
 * The ids are arguments only. This script writes them nowhere, and masks them to the last four
 * digits in everything it prints. */
'use strict';
const fs = require('fs'), path = require('path');

function loadEnv() {
  const cands = [process.env.ENV_FILE, path.join(__dirname, '..', '..', '.env'),
                 '/apps/unified/.env', '/apps/console/.env', path.join(process.cwd(), '.env')].filter(Boolean);
  for (const f of cands) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('='); if (i <= 0) continue;
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(t.slice(0, i) in process.env)) process.env[t.slice(0, i)] = v;
      }
      return f;
    } catch (_) {}
  }
  return null;
}
const envFile = loadEnv();

const args = process.argv.slice(2);
const CLEAR = args.includes('--clear'), CLEAR_ALL = args.includes('--clear-all');
let ids = [];
const fi = args.indexOf('--file');
if (fi >= 0 && args[fi + 1]) {
  ids = fs.readFileSync(args[fi + 1], 'utf8').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean);
  args.splice(fi, 2);
}
ids = ids.concat(args.filter(a => !a.startsWith('--')));
if (!ids.length && !CLEAR_ALL) {
  console.error('usage: node src/warmup.js <id> [<id> ...]        warm these customers');
  console.error('       node src/warmup.js --file ids.txt         warm a list, one id per line');
  console.error('       node src/warmup.js --clear <id> [<id>]    forget these customers');
  console.error('       node src/warmup.js --clear-all            forget everyone');
  console.error('       ids are MSISDNs (9665…, 05…) or National IDs — whatever you type into Customer 360.');
  process.exit(2);
}

const PORT = Number(process.env.PORT) || 4701;
const BASE = `http://127.0.0.1:${PORT}`;
const USER = process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa';
const HDR  = { 'X-Console-User': USER, 'X-Demo-Bypass': '1', 'X-Cache-Warm': '1' };
const mask = k => String(k).length > 4 ? '***' + String(k).slice(-4) : '***';
const pad  = (s, n) => String(s).padEnd(n).slice(0, n);

async function post(p, body) {
  try {
    const r = await fetch(BASE + p, { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, body: {}, error: e.message }; }
}

async function get(p) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + p, { headers: HDR });
    const body = await r.json().catch(() => ({}));
    return { ms: Date.now() - t0, status: r.status, body };
  } catch (e) { return { ms: Date.now() - t0, status: 0, body: {}, error: e.message }; }
}

(async () => {
  if (CLEAR || CLEAR_ALL) {
    const r = await post('/api/cache/lookup/drop', CLEAR_ALL ? { all: true } : { keys: ids });
    if (r.status !== 200) {
      console.error(`clear failed: HTTP ${r.status} ${r.body.error || r.error || ''}`);
      console.error('the drop endpoint is super-admin only — set CONSOLE_ADMIN_USER in .env to a super admin, or pass it in the environment.');
      process.exit(1);
    }
    console.log(CLEAR_ALL
      ? `cleared EVERYTHING — ${r.body.memory} profile(s) from memory, ${r.body.nexusLinks} nexus link row(s).`
      : `cleared ${ids.length} customer(s) — ${r.body.memory} profile(s) from memory, ${r.body.nexusLinks} nexus link row(s).`);
    console.log('the next lookup of those customers pays full price again. Re-warm them if that matters.');
    process.exit(0);
  }
  console.log(`warming ${ids.length} customer(s) against ${BASE}${envFile ? `  ·  env ${envFile}` : ''}`);
  console.log(`${pad('customer', 12)} ${pad('profile', 10)} ${pad('orders', 7)} ${pad('fixed', 10)} ${pad('links', 6)} note`);
  console.log('-'.repeat(78));
  let bad = 0;
  for (const id of ids) {
    const a = await get('/api/subscriber?key=' + encodeURIComponent(id));
    const b = await get('/api/fixed/customer?warm=1&key=' + encodeURIComponent(id));
    const lines = (a.body && a.body.lines || []).length;
    const link = (b.body && b.body.link) || {};
    const nIds = (link.ids || []).length;
    const notes = [];
    if (a.status !== 200) { notes.push(`profile HTTP ${a.status}${a.error ? ' ' + a.error : ''}`); bad++; }
    else if (!a.body.found) notes.push('no mobile customer found');
    if (b.status !== 200) { notes.push(`fixed HTTP ${b.status}${b.error ? ' ' + b.error : ''}`); bad++; }
    else if (b.body.found) notes.push('fixed service found');     // a direct hit carries no link block
    else if (link.reason) notes.push(String(link.reason).slice(0, 60));
    if (a.body && a.body.contactCollision) notes.push(`⚠ ${a.body.contactCollision.count} order(s) under another national ID`);
    /* the per-phase breakdown, so a slow customer says WHICH part was slow instead of just "slow" */
    const t = b.body && b.body.timings;
    if (t) notes.push(Object.entries(t).filter(([k]) => k !== 'total').sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k} ${v}ms`).join(' '));
    console.log(`${pad(mask(id), 12)} ${pad(a.ms + ' ms', 10)} ${pad(lines, 7)} ${pad(b.ms + ' ms', 10)} ${pad(nIds, 6)} ${notes.join(' · ') || 'ok'}`);
  }
  console.log('-'.repeat(78));
  console.log(bad ? `${bad} call(s) did not return 200 — see the notes above.`
                  : 'all warm. Re-run this after any restart: the mobile half lives in memory and is lost, the nexus half is persisted and is not.');
  process.exit(bad ? 1 : 0);
})();
