/* arqamiApi.js — the Arqami service as CST calls it, run from the console (18 Sep 2026).
 *
 * WHAT THIS IS. The Arqami page above measures the number-ownership service from the inside: one row per request in
 * APPS.YY_REGISTER_NUMBER_AUDIT on EBPROD, rolled up per minute. That answers "how did it behave". It cannot answer
 * "what did CST actually get back", because the audit row holds a duration and a success flag, not a payload.
 * This section closes that gap: it calls the same endpoint CST calls, with the same credentials, and shows the
 * request and the response exactly as the regulator sees them.
 *
 * THE CONTRACT. Classic ASMX (SALAM_TT_Webservice.asmx on itc-tt-status.itc.sa). Get_Registered_Numbers_JSON takes
 * User_ID_Number (the national / iqama id), User_Name and Password, and answers with the customer's mobile and
 * fixed services. The HTTP POST binding is what the .asmx test page itself uses:
 *
 *     POST /SALAM_TT_Webservice.asmx/Get_Registered_Numbers_JSON
 *     Content-Type: application/x-www-form-urlencoded
 *     User_ID_Number=…&User_Name=…&Password=…
 *
 * and the answer comes back as JSON. Some ASMX deployments wrap it in <string>…</string> instead; both are handled.
 * SOAP 1.1 is available as a fallback (ARQAMI_API_SOAP=1) because the .asmx documents it.
 *
 * SAFETY.
 *  · THE CREDENTIALS NEVER REACH THE BROWSER, and the browser can never send them. User_Name and Password are marked
 *    `secret`: they are read from /apps/unified/.env at call time and whatever the caller puts in those fields is
 *    discarded. The request echoed back to the page carries the password masked.
 *  · EXPLICIT ACTION ONLY — a person types a national id and presses Run. Nothing is polled, scheduled or retried.
 *  · Every call is audited with the operation and a masked id. The answer is rendered and dropped: no customer
 *    number, msisdn, account number or bill amount is written to unified_console.
 *  · POST only to the operations in this table, chosen by key — the console cannot be pointed anywhere else.
 *
 * Env: ARQAMI_API_BASE (https://itc-tt-status.itc.sa) · ARQAMI_API_PATH (/SALAM_TT_Webservice.asmx) ·
 *      ARQAMI_API_USER · ARQAMI_API_PASSWORD · ARQAMI_API_TIMEOUT_MS (30000) · ARQAMI_API_INSECURE=1 ·
 *      ARQAMI_API_SOAP=1 to use the SOAP 1.1 binding instead of HTTP POST · ARQAMI_API=0 disables the section. */
'use strict';
const http = require('http'), https = require('https'), net = require('net'), { URL } = require('url');

const E = process.env;
const cfg = () => ({
  base: (E.ARQAMI_API_BASE || 'https://itc-tt-status.itc.sa').replace(/\/+$/, ''),
  svc: '/' + String(E.ARQAMI_API_PATH || '/SALAM_TT_Webservice.asmx').replace(/^\/+/, ''),
  user: E.ARQAMI_API_USER || '', password: E.ARQAMI_API_PASSWORD || '',
  soap: /^(1|true|yes)$/i.test(E.ARQAMI_API_SOAP || ''),
  ns: E.ARQAMI_API_NS || 'http://tempuri.org/',
  timeoutMs: Math.max(2000, Number(E.ARQAMI_API_TIMEOUT_MS) || 30000),
  insecure: /^(1|true|yes)$/i.test(E.ARQAMI_API_INSECURE || ''),
  enabled: E.ARQAMI_API !== '0'
});
const configured = () => { const c = cfg(); return c.enabled && !!c.base; };
const credsSet = () => { const c = cfg(); return !!(c.user && c.password); };

/* Operations. `secret: true` means the value comes from .env and the caller's input for that field is thrown away.
 * Only Get_Registered_Numbers_JSON is transcribed here — it is the one whose contract we have seen in full. The
 * .asmx publishes more; add them to this table when their parameters are confirmed, never by guessing. */
const OPERATIONS = [
  {
    key: 'registeredNumbers', op: 'Get_Registered_Numbers_JSON', title: 'Registered numbers — mobile + fixed',
    note: 'What CST receives when it asks which services an identity holds. This is the call the Arqami audit table above counts: every row in APPS.YY_REGISTER_NUMBER_AUDIT is one of these, so a request here and a row there are the same event seen from the two ends.',
    fields: [
      { name: 'User_ID_Number', label: 'National / Iqama id', required: true },
      { name: 'User_Name', label: 'Service account', secret: true, env: 'ARQAMI_API_USER' },
      { name: 'Password', label: 'Service password', secret: true, env: 'ARQAMI_API_PASSWORD' }
    ],
    returns: 'Status, Message, RegisteredNumbersList { Mobile[] { MobileNumber, AccountNumber, PackageID, PackageNameEn, PackageNameAr, OutstandingBills }, Fixed[] { FixedNumber, AccountNumber, PackageID, PackageNameEn, PackageNameAr, OutstandingBills } }'
  }
];
const byKey = k => OPERATIONS.find(o => o.key === k) || null;
const pathOf = o => cfg().svc + '/' + o.op;

const spec = () => {
  const c = cfg();
  return {
    configured: configured(), credsSet: credsSet(), base: c.base, service: c.svc,
    binding: c.soap ? 'SOAP 1.1' : 'HTTP POST (application/x-www-form-urlencoded)',
    user: c.user ? c.user : null, timeoutMs: c.timeoutMs, insecure: c.insecure,
    operations: OPERATIONS.map(o => ({
      key: o.key, op: o.op, path: pathOf(o), title: o.title, note: o.note, returns: o.returns,
      fields: o.fields.map(f => ({ name: f.name, label: f.label, required: !!f.required, secret: !!f.secret, env: f.env || null }))
    }))
  };
};

/* itc-tt-status.itc.sa is outside 152's normal route: a failure here is a network fact to report, not a
 * credential problem to debug. */
function reachable(timeoutMs = 4000) {
  const c = cfg();
  let u; try { u = new URL(c.base); } catch (e) { return Promise.resolve({ ok: false, error: 'ARQAMI_API_BASE is not a URL: ' + c.base }); }
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const target = `${u.hostname}:${port}`;
  return new Promise(resolve => {
    const t0 = Date.now();
    const done = (ok, error) => resolve({ ok, ms: Date.now() - t0, target, error: error || null, at: new Date().toISOString() });
    let s; try { s = net.connect({ host: u.hostname, port }); } catch (e) { return done(false, e.message); }
    const end = (ok, err) => { try { s.destroy(); } catch (_) {} done(ok, err); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => end(true, null));
    s.once('timeout', () => end(false, `no answer from ${target} within ${timeoutMs} ms — filtered, or this host has no route out`));
    s.once('error', e => end(false, e.code === 'ENOTFOUND' ? `${u.hostname} does not resolve from this host`
      : e.code === 'ECONNREFUSED' ? `${target} refused the connection` : `${e.code || ''} ${e.message}`.trim()));
  });
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* ASMX answers either with the JSON itself, or with it wrapped in <string>…</string> (and inside a SOAP envelope
 * when the SOAP binding is used). Unwrap whatever shape arrives so the page always shows the payload. */
function parseAnswer(raw) {
  const t = String(raw || '').trim();
  if (!t) return { json: false, value: '' };
  if (t[0] === '{' || t[0] === '[') { try { return { json: true, value: JSON.parse(t) }; } catch (_) { return { json: false, value: t }; } }
  const m = /<(?:\w+:)?(?:string|\w*Result)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:string|\w*Result)>/i.exec(t);
  if (m) {
    const inner = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    if (inner && (inner[0] === '{' || inner[0] === '[')) { try { return { json: true, value: JSON.parse(inner), unwrapped: true }; } catch (_) { return { json: false, value: inner, unwrapped: true }; } }
    return { json: false, value: inner, unwrapped: true };
  }
  return { json: false, value: t };
}

async function call(opKey, fields = {}) {
  const c = cfg();
  if (!configured()) return { ok: false, error: 'Arqami API not configured (ARQAMI_API_BASE / ARQAMI_API=0)' };
  const o = byKey(opKey);
  if (!o) return { ok: false, error: 'unknown operation: ' + opKey + ' (one of ' + OPERATIONS.map(x => x.key).join(', ') + ')' };
  if (!credsSet()) return { ok: false, error: 'ARQAMI_API_USER / ARQAMI_API_PASSWORD are not set in /apps/unified/.env — the console will not send a call without them' };

  /* the body is rebuilt from the operation's own field list; secrets come from .env and NEVER from the caller */
  const sent = {}, shown = {};
  for (const f of o.fields) {
    if (f.secret) { const v = f.env === 'ARQAMI_API_PASSWORD' ? c.password : c.user; sent[f.name] = v; shown[f.name] = f.env === 'ARQAMI_API_PASSWORD' ? '•'.repeat(8) + ' (from .env)' : v; continue; }
    const v = fields[f.name];
    sent[f.name] = v == null ? '' : String(v).trim().slice(0, 200);
    shown[f.name] = sent[f.name];
  }
  const missing = o.fields.filter(f => f.required && !sent[f.name]).map(f => f.name);
  if (missing.length) return { ok: false, error: 'required field(s) empty: ' + missing.join(', ') };

  const target = c.soap ? c.base + c.svc : c.base + pathOf(o);
  const payload = c.soap
    ? `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <${o.op} xmlns="${c.ns}">\n${o.fields.map(f => `      <${f.name}>${xmlEsc(sent[f.name])}</${f.name}>`).join('\n')}\n    </${o.op}>\n  </soap:Body>\n</soap:Envelope>`
    : o.fields.map(f => encodeURIComponent(f.name) + '=' + encodeURIComponent(sent[f.name])).join('&');

  const u = new URL(target);
  const mod = u.protocol === 'https:' ? https : http;
  const headers = c.soap
    ? { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `"${c.ns}${o.op}"`, 'Content-Length': Buffer.byteLength(payload) }
    : { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json, text/xml', 'Content-Length': Buffer.byteLength(payload) };
  /* what the page shows as "the request", with the password never in it */
  const shownBody = c.soap ? payload.replace(new RegExp('(<Password>)[^<]*(</Password>)'), '$1' + '•'.repeat(8) + '$2')
    : o.fields.map(f => f.name + '=' + (f.env === 'ARQAMI_API_PASSWORD' ? '\u2022'.repeat(8) : encodeURIComponent(sent[f.name]))).join('&');

  const t0 = Date.now();
  return new Promise(resolve => {
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
      method: 'POST', headers, rejectUnauthorized: !c.insecure, timeout: c.timeoutMs }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', d => { bytes += d.length; if (bytes <= 8 * 1024 * 1024) chunks.push(d); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const a = parseAnswer(raw);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, operation: o.key, op: o.op, url: target,
          status: res.statusCode, statusText: res.statusMessage || '', ms: Date.now() - t0, bytes,
          json: a.json, unwrapped: !!a.unwrapped, contentType: res.headers['content-type'] || null,
          binding: c.soap ? 'soap' : 'post', request: shown, requestBody: shownBody,
          response: a.json ? a.value : String(a.value).slice(0, 20000),
          note: a.json ? null : 'the service did not answer with JSON — the raw body is shown as text' });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, operation: o.key, op: o.op, ms: Date.now() - t0, request: shown, requestBody: shownBody, error: `no response within ${c.timeoutMs} ms` }); });
    req.on('error', err => resolve({ ok: false, operation: o.key, op: o.op, ms: Date.now() - t0, request: shown, requestBody: shownBody,
      error: err.code === 'ENOTFOUND' ? `${u.hostname} does not resolve from this host`
        : err.code === 'ECONNREFUSED' ? `${u.hostname} refused the connection`
        : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(err.code || '') ? `TLS: ${err.code} — set ARQAMI_API_INSECURE=1 if the service uses a self-signed certificate`
        : `${err.code || ''} ${err.message}`.trim() }));
    req.write(payload); req.end();
  });
}

module.exports = { configured, credsSet, cfg, spec, call, reachable, OPERATIONS, byKey, parseAnswer };
