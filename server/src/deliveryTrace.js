/* DELIVERY-PARTNER WIRE TRACE — the REAL request/response exchanged with the courier.
 *
 * WHY: every courier client in the app (Delivery::Oto/Smsa/Barq/Imile/Manarat/Saleor/Stcc/Tam
 * — app/services/delivery/<vendor>/client.rb) sets HTTParty `debug_output $stdout`, so the complete
 * wire conversation — request headers, JSON body, response status and body — is printed into
 * sidekiq.log on the API hosts. That log is the ONLY place the true courier exchange exists:
 * the delivery_requests row stores a distilled summary, which is what confused the team.
 *
 * JOIN KEYS (from Delivery::Oto::Request/Response):
 *   orderId  in the request body  = delivery_requests.internal_reference_id  (e.g. kwlx2gc3)
 *   otoId    in the response/callback = delivery_requests.external_reference_id (e.g. 35908007)
 *   ref1     in the request body  = the customer's NATIONALITY ID (not a shipment ref!)
 *
 * Transport: exact-string grep (-F) with trailing context (-A) over the newest tail of the log,
 * over the existing console_ro SSH channel (API_LOG_HOSTS/USER/KEY). Read-only.
 * SECURITY: the request headers carry the courier Bearer token — ALWAYS redacted here, before
 * masking, before anything leaves this module. */
'use strict';

const { execFile } = require('child_process');
const MB = 1024 * 1024;

const CFG = () => ({
  hosts: String(process.env.API_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.API_LOG_USER || '',
  key: process.env.API_LOG_KEY || '',
  path: process.env.SIDEKIQ_LOG_PATH || '/www/app/salam_api/shared/log/sidekiq.log',
  tailBytes: Math.max(10, Number(process.env.SIDEKIQ_TAIL_MB) || 300) * MB
});
const configured = () => CFG().hosts.length > 0;

const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
function sshExec(host, remoteCmd) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.key) args.push('-i', c.key);
  args.push(c.user ? `${c.user}@${host}` : host, remoteCmd);
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: 4 * MB, timeout: 45000 },
      (err, stdout, stderr) => {
        // grep exits 1 on "no match" — that's a valid empty result, not an error
        if (err && err.code === 1 && !String(stderr || '').trim()) return resolve('');
        if (err) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 300)));
        resolve(stdout);
      });
  });
}

/* HTTParty debug lines are Ruby string literals: <- "..." (sent) / -> "..." (received). */
const unescapeWire = s => String(s)
  .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const redactAuth = s => String(s)
  .replace(/Authorization:\s*Bearer\s+[^\s"']+/gi, 'Authorization: Bearer [REDACTED]')
  .replace(/"(access_token|refresh_token)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"');

function parseChunk(raw) {
  const entries = [];
  const push = e => { if (entries.length < 40) entries.push(e); };
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t || t === '--') continue;
    const m = /^(?:\d+[:-])?(<-|->) "(.*)"$/.exec(t);
    if (m) {
      const dir = m[1], content = redactAuth(unescapeWire(m[2]));
      if (/^(POST|GET|PUT|PATCH) /.test(content)) {
        const first = content.split('\n')[0];
        const host = (content.match(/Host:\s*([^\s]+)/i) || [])[1] || null;
        push({ kind: 'request', line: first, host });
      } else if (content.startsWith('{')) {
        let body = null; try { body = JSON.parse(content); } catch (e) {}
        push({ kind: dir === '<-' ? 'request_body' : 'response_body',
          body, text: body ? undefined : content.slice(0, 1500) });
      } else if (/^HTTP\//.test(content)) {
        push({ kind: 'response_status', line: content.split('\n')[0] });
      }
      // other wire fragments (chunk sizes, header-only reads) are noise — skipped
      continue;
    }
    // sidekiq worker events referencing the shipment (SMS notify, retries, errors)
    if (/=>|Worker|Delivery|ERROR|WARN/.test(t) && t.length > 20)
      push({ kind: 'worker_event', text: redactAuth(t).slice(0, 600) });
  }
  return entries;
}

/* distill(all, refs) — the grep context drags in NOISE: the courier token-refresh exchange
 * (a huge JWT response body), unrelated worker lines from adjacent context windows, repeated
 * matches. What the team needs is THE ONE createOrder exchange for this shipment. Rule:
 * find the request_body whose body.orderId is one of our refs → keep its request line, the
 * body, and the response status/body that immediately follow. Worker events kept only when
 * they literally mention one of the refs (SMS notify, retries). Everything else is counted
 * and hidden — visible via raw fallback only when no exchange could be isolated. */
function distill(all, refs) {
  let ex = [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.kind === 'request_body' && e.body && refs.includes(String(e.body.orderId || ''))) {
      const reqLine = all.slice(Math.max(0, i - 3), i).reverse().find(x => x.kind === 'request');
      ex = [reqLine, e].filter(Boolean);
      for (let j = i + 1; j < Math.min(all.length, i + 8); j++) {
        if (all[j].kind === 'request') break;                       // next exchange started
        if (all[j].kind === 'response_status') ex.push(all[j]);
        if (all[j].kind === 'response_body') { ex.push(all[j]); break; }
      }
      break;                                                        // one exchange is the goal
    }
  }
  const workers = all.filter(e => e.kind === 'worker_event' && refs.some(r => e.text && e.text.includes(r))).slice(0, 4);
  if (ex.length) return { entries: [...ex, ...workers], exchange_found: true,
    hidden: Math.max(0, all.length - ex.length - workers.length) };
  return { entries: all.slice(0, 12), exchange_found: false, hidden: Math.max(0, all.length - 12) };
}

/* trace(refs) — grep the newest tail of sidekiq.log for any of the reference ids, with enough
 * trailing context (-A 24) that the response following a matched request is captured even when
 * the response itself does not contain the id. First host with matches wins. */
async function trace(refs) {
  const c = CFG();
  if (!c.hosts.length) return { configured: false };
  const clean = [...new Set(refs.map(r => String(r || '').trim()).filter(r => /^[\w.-]{4,64}$/.test(r)))];
  if (!clean.length) return { configured: true, ok: false, error: 'no valid reference ids' };
  const pats = clean.map(r => `-e ${shq(r)}`).join(' ');
  const errors = [];
  for (const host of c.hosts) {
    try {
      const out = await sshExec(host,
        `tail -c ${c.tailBytes} ${shq(c.path)} | grep -F -A 24 ${pats} | tail -c 600000`);
      const all = parseChunk(out);
      if (all.length) {
        const d = distill(all, clean);
        return { configured: true, ok: true, host, refs: clean, entries: d.entries,
          exchange_found: d.exchange_found, hidden: d.hidden,
          source: `${c.path} (newest ~${Math.round(c.tailBytes / MB)}MB) via SSH — HTTParty debug_output wire log` };
      }
    } catch (e) { errors.push(`${host}: ${String(e.message || e).slice(0, 120)}`); }
  }
  return { configured: true, ok: true, refs: clean, entries: [],
    note: `no wire lines found in the newest ~${Math.round(c.tailBytes / MB)}MB of sidekiq.log on any host — ` +
          `the exchange may be older than the log window (rotated), or this vendor's traffic runs from another host` +
          (errors.length ? ` · ${errors.join(' · ')}` : '') };
}

/* Delivery state buckets — copied VERBATIM from app/models/delivery_request.rb (the single
 * source of truth for how the app itself classifies courier states). Keep in sync with model. */
const STATES = {
  NEW: ['new','200','SubmitOrder','missingData','paymentConfirmed','waitingAddressConfirmation','waitingAssignment','addressConfirmed','addressVerified','needConfirmation','waitingApproval','smsSentToReceiver','paymentTypeConfirmed','codOrderConfirmed','orderConfirmed','pickupFromStore','interDepotTransfer'],
  COMPLETED: ['complete','completed','DELIVERED','DL','DEX09','POD','Delivered','delivered'],
  CANCELLED: ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled'],
  REFUSED: ['REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'],
  UNDELIVERED: ['DE','DEX03','DEX08','DEX14','DEX8X','BA','CA','FD','NH','MS','TN','DEX03-1','DEX03-2','DEX03-3','DEX03-4','DEX03-7','DEX03-8','DEX03-9','DEX03-13','DEX03-14','DEX03-16','PUX03-1','PUX3','cs_schedule_failed_no_answer','shipmentError','failedAttempt','undeliveredAttempt','pickupAttemted','reversePickupAttempted','reverseUndeliveredAttempt','notAvailableBR','notAvailableWH','lostOrDamaged','destroyed','rejected','returnReverseComment']
};

module.exports = { configured, trace, STATES };
