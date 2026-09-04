/* IP UNBLOCK — BULK. Releases EVERY IP currently held by the app's IpRetrial limiter, from 152.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/ipUnblockBulk.js                  # DRY RUN — counts and samples, deletes nothing
 *   node src/ipUnblockBulk.js --yes            # actually delete
 *
 * WHY THIS EXISTS RATHER THAN `rails runner Rails.cache.delete_matched(...)`
 * That command only runs where Rails is deployed (the API hosts, 172.31.43.17/.18) — 152 is the
 * Node console and has neither Rails nor a bundler. It is also blunt: delete_matched walks the
 * WHOLE Rails cache, which on this deployment is millions of keys serving the live app.
 *
 * WHY IT IS A SEPARATE FILE FROM ipUnblock.js
 * ipUnblock.js is deliberately narrow: it can only ever address five exact key names for one
 * validated IP, and that narrowness is its security posture. Teaching it to SCAN would widen the
 * surface of a super_admin HTTP endpoint. This is a CLI-only script instead — no route, no
 * endpoint, nothing reachable from the browser — and it repeats the RESP plumbing rather than
 * loosening the module the endpoint depends on.
 *
 * WHAT IT CAN TOUCH
 * PREFIX is a const in this file and is NOT settable from the command line. The MATCH pattern and
 * every DEL are built from it, so the worst a mistyped invocation can do is delete limiter keys.
 * There is no code path here that reads or deletes anything else in the cache.
 *
 * HOW IT AVOIDS HURTING THE APP
 *   · SCAN, never KEYS — KEYS blocks single-threaded Redis for the whole sweep
 *   · COUNT 500 per cursor step, and a short sleep between steps, so the sweep yields constantly
 *   · DEL in batches of 200 rather than one huge argument list
 *   · one persistent connection for the whole run, not one per command
 *   · a full pass over a multi-million-key cache takes minutes — that is the point, not a fault
 *
 * NOTE ON THE UNDERLYING DEFECT — deleting keys is a RELEASE, not a fix. Blocks come back unless
 * Setting.ip_elapse_time is lowered (it is the key TTL; at 999999s a counter survives ~11.6 days
 * and any IP idle longer than ip_session_time is blocked on its next visit). Flush AFTER changing
 * the setting, otherwise live traffic recreates the keys with the old long TTL immediately.
 *
 * Env: IPRL_REDIS_URL — same variable ipUnblock.js uses. Unset = this script refuses to run.
 */
'use strict';

const net = require('net');
const tls = require('tls');

/* HARD-CODED. Not an argument, not an env var. See "WHAT IT CAN TOUCH" above. */
const PREFIX = 'ip_address_retries_';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = f => process.argv.includes(f);

const APPLY = has('--yes');
const COUNT = Math.max(50, Math.min(2000, Number(arg('--count', 500))));
const PAUSE = Math.max(0, Number(arg('--pause', 15)));        // ms between cursor steps
const DELBATCH = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- RESP2 parse (same shape as ipUnblock.js) ---------------------------------------------- */
function parse(buf, pos = 0) {
  const nl = buf.indexOf('\r\n', pos); if (nl < 0) return null;
  const head = buf.slice(pos, nl).toString(); const t = head[0]; const rest = head.slice(1);
  const after = nl + 2;
  if (t === '+') return [rest, after];
  if (t === '-') return [new Error(rest), after];
  if (t === ':') return [Number(rest), after];
  if (t === '$') {
    const n = Number(rest); if (n === -1) return [null, after];
    if (buf.length < after + n + 2) return null;
    return [buf.slice(after, after + n).toString(), after + n + 2];
  }
  if (t === '*') {
    const n = Number(rest); if (n === -1) return [null, after];
    const out = []; let p = after;
    for (let i = 0; i < n; i++) { const r = parse(buf, p); if (!r) return null; out.push(r[0]); p = r[1]; }
    return [out, p];
  }
  return [new Error('bad RESP type ' + t), after];
}
const enc = args => `*${args.length}\r\n` + args.map(a => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('');

/* ---- a PERSISTENT client -------------------------------------------------------------------
 * ipUnblock.js opens a socket, fires a fixed list of commands and closes. A cursored SCAN cannot
 * work that way: each request depends on the cursor the previous reply returned. So this client
 * keeps one socket and a FIFO of pending resolvers — send a command, resolve it when its reply
 * arrives, in order. */
function connect() {
  const u = new URL(process.env.IPRL_REDIS_URL);
  const pending = [];
  let buf = Buffer.alloc(0), dead = null;

  const mk = u.protocol === 'rediss:' ? tls.connect : net.connect;
  const sock = mk({ host: u.hostname, port: Number(u.port) || 6379 });
  sock.setTimeout(30000, () => fail(new Error('redis timeout')));
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('redis connection closed')));
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    let p = 0;
    for (;;) {
      const r = parse(buf, p); if (!r) break;
      p = r[1];
      const w = pending.shift();
      if (w) (r[0] instanceof Error ? w.reject(r[0]) : w.resolve(r[0]));
    }
    buf = buf.slice(p);
  });

  function fail(e) {
    if (dead) return; dead = e;
    while (pending.length) pending.shift().reject(e);
    try { sock.destroy(); } catch (_) {}
  }

  const send = (...cmd) => new Promise((resolve, reject) => {
    if (dead) return reject(dead);
    pending.push({ resolve, reject });
    sock.write(enc(cmd));
  });

  const ready = (async () => {
    await new Promise((res, rej) => { sock.once('connect', res); sock.once('secureConnect', res); sock.once('error', rej); });
    if (u.password) {
      if (u.username && u.username !== 'default') await send('AUTH', u.username, u.password);
      else await send('AUTH', u.password);
    }
    const db = (u.pathname || '').replace('/', '');
    if (db) await send('SELECT', db);
  })();

  return { send, ready, close: () => { dead = new Error('closed'); try { sock.destroy(); } catch (_) {} } };
}

/* ---- main ----------------------------------------------------------------------------------- */
(async () => {
  if (!process.env.IPRL_REDIS_URL) {
    console.error('IPRL_REDIS_URL is not set — did you source the env?');
    console.error('  cd /apps/console/server && set -a; . ../.env; set +a');
    process.exit(1);
  }

  console.log(APPLY
    ? `IP-limiter BULK FLUSH — DELETING keys matching ${PREFIX}*`
    : `IP-limiter bulk flush — DRY RUN (nothing will be deleted). Add --yes to apply.`);
  console.log(`  scan COUNT=${COUNT}  pause=${PAUSE}ms  delete batch=${DELBATCH}\n`);

  const c = connect();
  await c.ready;

  const t0 = Date.now();
  let cursor = '0', steps = 0, scanned = 0, matched = 0, deleted = 0;
  const byAction = new Map();
  const sample = [];
  let batch = [];

  const flushBatch = async () => {
    if (!batch.length) return;
    if (APPLY) deleted += Number(await c.send('DEL', ...batch)) || 0;
    batch = [];
  };

  do {
    const [next, keys] = await c.send('SCAN', cursor, 'MATCH', PREFIX + '*', 'COUNT', String(COUNT));
    cursor = next; steps++; scanned += COUNT;

    for (const k of keys || []) {
      /* belt and braces: SCAN's MATCH already filters, but a DEL is irreversible — re-check the
       * prefix on the key we are actually about to delete. */
      if (!k.startsWith(PREFIX)) continue;
      matched++;
      const rest = k.slice(PREFIX.length);
      const action = ['validate_details_with_account', 'validate_details', 'voucher', 'create', 'confirm']
        .find(a => rest.startsWith(a + '_')) || '(other)';
      byAction.set(action, (byAction.get(action) || 0) + 1);
      if (sample.length < 8) sample.push(k);
      batch.push(k);
      if (batch.length >= DELBATCH) await flushBatch();
    }

    if (steps % 200 === 0) {
      process.stdout.write(`  …${steps} scan steps, ${matched} limiter keys found` +
        (APPLY ? `, ${deleted} deleted` : '') + `  (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    }
    if (PAUSE) await sleep(PAUSE);
  } while (cursor !== '0');

  await flushBatch();
  c.close();

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== RESULT (${secs}s, ${steps} scan steps) ===`);
  console.log(`  limiter keys found : ${matched}`);
  console.log(`  keys deleted       : ${APPLY ? deleted : 0}${APPLY ? '' : '   (dry run)'}`);
  if (byAction.size) {
    console.log('  by guarded action  :');
    [...byAction.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([a, n]) => console.log(`    ${a.padEnd(30)} ${n}`));
  }
  if (sample.length) { console.log('  sample keys        :'); sample.forEach(k => console.log('    ' + k)); }

  if (!APPLY && matched) console.log('\n  Re-run with --yes to delete these.');
  if (APPLY) {
    console.log('\n  Keys are released. They WILL come back unless Setting.ip_elapse_time is lowered —');
    console.log('  it is the TTL written on every allowed request. Change the setting first, flush second.');
  }
  process.exit(0);
})().catch(e => { console.error('BULK UNBLOCK FAILED:', e.message); process.exit(1); });
