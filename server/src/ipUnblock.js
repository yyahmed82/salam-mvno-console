/* IP UNBLOCK — releases an IP from the app's IpRetrial rate-limiter, from the console.
 *
 * The limiter (selfcare-backend concerns/ip_retrial.rb) tracks each IP in the app's Redis cache
 * under keys `ip_address_retries_<action>_<ip>` for actions: voucher, validate_details,
 * validate_details_with_account, create, confirm. Known defect: an idle gap > ip_session_time
 * BLOCKS instead of resetting, and blocks persist ip_elapse_time after the last ALLOWED request
 * (with elapse=999999s that is ~11.6 days). Unblock = DELETE those keys. Nothing else.
 *
 * TALKS TO REDIS DIRECTLY over a minimal RESP2 client (net socket — 152 has no internet, so no
 * npm redis dependency is possible; the protocol is 40 lines). Rails' redis_cache_store here has
 * NO namespace (production.rb), so key names are raw.
 *
 * Security posture — deliberately narrow:
 *   • can only EXISTS/TTL/DEL the five exact ip_address_retries_<action>_<ip> key names
 *   • IP argument is strictly validated (IPv4/IPv6 literal) before touching the socket
 *   • endpoint is super_admin-only and audited (who unblocked which IP, when)
 *   • unset IPRL_REDIS_URL = feature absent; console runs exactly as before
 *
 * Env: IPRL_REDIS_URL=redis://:password@host:6379/0
 *      (URL from the app's encrypted credentials — Rails.application.credentials[env][:redis][:url];
 *       firewall 152 → redis host:port may need a SOC rule.) */
'use strict';

const net = require('net');
const tls = require('tls');

const URLRE = () => { try { return process.env.IPRL_REDIS_URL ? new URL(process.env.IPRL_REDIS_URL) : null; } catch (e) { return null; } };
const configured = () => !!URLRE();

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;
const validIp = ip => IPV4.test(ip) || (ip.includes(':') && IPV6.test(ip));

/* ---- minimal RESP2 ------------------------------------------------------------------------ */
const enc = args => `*${args.length}\r\n` + args.map(a => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('');

function parse(buf, pos = 0) {                       // returns [value, nextPos] or null if incomplete
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

/* one connection, run a list of commands sequentially, close. 5s hard timeout on everything. */
function session(cmds) {
  const u = URLRE();
  if (!u) return Promise.reject(new Error('IPRL_REDIS_URL not set'));
  return new Promise((resolve, reject) => {
    const results = [];
    let buf = Buffer.alloc(0), idx = 0, done = false;
    const finish = err => { if (done) return; done = true; try { sock.destroy(); } catch (e) {}
      err ? reject(err) : resolve(results); };
    const mk = u.protocol === 'rediss:' ? tls.connect : net.connect;
    const sock = mk({ host: u.hostname, port: Number(u.port) || 6379 }, () => {
      const all = [];
      if (u.password) all.push(u.username && u.username !== 'default' ? ['AUTH', u.username, u.password] : ['AUTH', u.password]);
      const db = (u.pathname || '').replace('/', '');
      if (db) all.push(['SELECT', db]);
      all.push(...cmds);
      cmds = all;
      sock.write(cmds.map(enc).join(''));
    });
    sock.setTimeout(5000, () => finish(new Error('redis timeout')));
    sock.on('error', e => finish(e));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      let p = 0;
      for (;;) {
        const r = parse(buf, p); if (!r) break;
        results.push(r[0]); p = r[1]; idx++;
        if (idx >= cmds.length) { buf = null; return finish(null); }
      }
      buf = buf.slice(p);
    });
  });
}

/* The key names are fully deterministic (5 known actions), so we address them DIRECTLY —
 * no SCAN. Lesson learned in testing: this Redis is the app's ENTIRE Rails cache (millions of
 * keys); a bounded SCAN gave up before reaching the limiter keys. EXISTS/TTL/DEL on exact
 * names is O(1) per key and cannot miss. */
const ACTIONS = ['validate_details', 'voucher', 'validate_details_with_account', 'create', 'confirm'];
const exactKeys = ip => ACTIONS.map(a => `ip_address_retries_${a}_${ip}`);
async function findKeys(ip) {
  const keys = exactKeys(ip);
  const res = await session(keys.map(k => ['EXISTS', k]));
  const ex = res.slice(-keys.length);
  return keys.filter((k, i) => Number(ex[i]) === 1);
}

/* ---- public API --------------------------------------------------------------------------- */
async function status(ip) {
  if (!configured()) return { configured: false };
  if (!validIp(ip)) return { configured: true, error: 'invalid IP address' };
  const keys = await findKeys(ip);
  if (!keys.length) return { configured: true, ip, tracked: false, keys: [] };
  const res = await session(keys.map(k => ['TTL', k]));
  const ttls = res.slice(-keys.length);
  return { configured: true, ip, tracked: true,
    keys: keys.map((k, i) => ({
      key: k, action: k.replace(/^ip_address_retries_/, '').replace(new RegExp(`_${ip.replace(/[.:]/g, '\\$&')}$`), ''),
      ttl_seconds: typeof ttls[i] === 'number' ? ttls[i] : null,
      expires_human: typeof ttls[i] === 'number' && ttls[i] > 0
        ? new Date(Date.now() + ttls[i] * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : null
    })) };
}

async function unblock(ip) {
  if (!configured()) return { configured: false };
  if (!validIp(ip)) return { configured: true, error: 'invalid IP address' };
  const keys = await findKeys(ip);
  if (!keys.length) return { configured: true, ip, deleted: 0, keys: [] };
  const res = await session([['DEL', ...keys]]);
  const del = res[res.length - 1];
  if (del instanceof Error) throw del;
  return { configured: true, ip, deleted: Number(del) || 0, keys };
}

async function ping() {
  if (!configured()) return { ok: false, configured: false };
  const t0 = Date.now();
  try { const r = await session([['PING']]);
    return { ok: r[r.length - 1] === 'PONG', configured: true, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, configured: true, ms: Date.now() - t0, error: e.message }; }
}

/* Raw GET for other modules — the app's Rails.cache runs on THIS Redis with no namespace, so
 * anything it caches is readable here. smsTrace uses it for `<otp_id>_otp_type`, the only place
 * an OTP's message type exists (Otp#cache_message_details, 10-minute TTL).
 * Values are Marshal-dumped by redis_cache_store; callers get the raw string and decide. */
async function getRaw(key) {
  if (!configured() || !key) return null;
  try { const r = await session([['GET', String(key)]]); return r[r.length - 1]; }
  catch (e) { return null; }
}

module.exports = { configured, validIp, status, unblock, ping, getRaw };
