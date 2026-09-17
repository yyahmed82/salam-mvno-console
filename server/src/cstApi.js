/* cstApi.js — the five CST endpoints, callable from the console (18 Sep 2026).
 *
 * WHAT THESE ARE. Spec CITC006001 v6.2, published at https://itc-tt-view.itc.sa ("Salam Swagger Apps"): the API
 * the REGULATOR calls to read Salam's side of a complaint. So running them here answers a question the Remedy
 * section above cannot: not "what do we hold", but "what does CST actually receive when it asks". The two sit on
 * one page on purpose — the HTTP 500 of workstream B, the inverted 5-day rule and the multi-row REQ parity bug
 * (runbook §13 items 4 and 5) are all discrepancies between those two answers.
 *
 * Contracts below are transcribed from the live Swagger, field for field — including that /GetSPRelatedTickets
 * names its body `Datas` rather than `Request`, and takes ServiceNumber + IdentificationNumber instead of a
 * ticket number.
 *
 * SAFETY:
 *  · EXPLICIT ACTION ONLY. A person fills the form and presses Run. Nothing here is scheduled or retried.
 *  · Every call is audited with the endpoint and a masked identifier; the api key lives only in /apps/unified/.env
 *    and is never returned to the browser.
 *  · POST only to the five known paths — the endpoint is chosen by key from this table, never taken from the
 *    request, so the console cannot be used to post anywhere else.
 *  · Attachment bodies come back as base64 and can be megabytes: FileBinary is replaced by its length before the
 *    response leaves the server. Nothing is stored.
 *
 * Env: CST_API_BASE (https://itc-tt-view.itc.sa) · CST_API_KEY · CST_API_KEY_HEADER (api_key) ·
 *      CST_API_TIMEOUT_MS (30000) · CST_API_INSECURE=1 to accept a self-signed certificate (the production
 *      PowerShell path does this) · CST_API_PROVIDER (default value for the Provider field) · CST_API=0 disables. */
'use strict';
const http = require('http'), https = require('https'), net = require('net'), { URL } = require('url');

const E = process.env;
const cfg = () => ({
  base: (E.CST_API_BASE || 'https://itc-tt-view.itc.sa').replace(/\/+$/, ''),
  key: E.CST_API_KEY || '', keyHeader: E.CST_API_KEY_HEADER || 'api_key',
  provider: E.CST_API_PROVIDER || 'Salam',
  timeoutMs: Math.max(2000, Number(E.CST_API_TIMEOUT_MS) || 30000),
  insecure: /^(1|true|yes)$/i.test(E.CST_API_INSECURE || ''),
  enabled: E.CST_API !== '0'
});
const configured = () => { const c = cfg(); return c.enabled && !!c.base; };

/* the five, exactly as the Swagger declares them */
const ENDPOINTS = [
  { key: 'complaints', path: '/GetSPComplaintsData', title: 'Complaint data', body: 'Request',
    note: 'What CST reads for one complaint: its type codes, creation date and status. This is the call that returned HTTP 500 on duplicated tier-triples.',
    fields: [['SpTicketNumber', 'REQ / complaint number', true], ['ServiceNumber', 'Service number', false], ['Provider', 'Provider', false]],
    returns: 'ComplaintData { ComplaintType, ComplaintSubType, ServiceMainType, ServiceSubType, AttachmentId, TicketCreationDate, TicketStatusId }' },
  { key: 'attachments', path: '/GetSPComplaintAttachments', title: 'Complaint attachments', body: 'Request',
    note: 'Files attached to the complaint. FileBinary is base64 and can be large — the console reports its size instead of the bytes.',
    fields: [['SpTicketNumber', 'REQ / complaint number', true], ['ServiceNumber', 'Service number', false], ['FileId', 'File id (blank for all)', false], ['Provider', 'Provider', false]],
    returns: 'Files[] { FileId, FileName, FileBinary }, Status, ErrorMessage' },
  { key: 'actions', path: '/GetSPComplaintActions', title: 'Complaint actions', body: 'Request',
    note: 'The action trail CST sees — who moved the complaint, when, and the comment that went with it.',
    fields: [['SpTicketNumber', 'REQ / complaint number', true], ['ServiceNumber', 'Service number', false], ['Provider', 'Provider', false]],
    returns: 'Actions { FromUser, ToUser, ActionName, ActionDate, SPComments }, Status, ErrorMessage' },
  { key: 'subscription', path: '/GetSubscriptionData', title: 'Subscription data', body: 'Request',
    note: 'The subscription behind the complaint: bundle, subscription date, service status, and the current bill file.',
    fields: [['SpTicketNumber', 'REQ / complaint number', true], ['ServiceNumber', 'Service number', false], ['Provider', 'Provider', false]],
    returns: 'SubscriptionData { BundleName, BundleSubscriptionDate, ServiceNumberStatus }, FileCurrentBill { FileId, FileName }' },
  { key: 'related', path: '/GetSPRelatedTickets', title: 'Related tickets', body: 'Datas',
    note: 'Other complaints for the same service or identity. Note the body is named Datas, not Request, and it takes no ticket number.',
    fields: [['ServiceNumber', 'Service number', true], ['IdentificationNumber', 'National / Iqama id', false]],
    returns: 'Status, ErrorMessage, RelatedComplaints[]' }
];
const byKey = k => ENDPOINTS.find(e => e.key === k) || null;
/* the request skeleton the Swagger shows, with Provider prefilled from .env so the field is not guesswork */
function template(e) {
  const o = {};
  for (const [f] of e.fields) o[f] = f === 'Provider' ? cfg().provider : '';
  return o;
}
const spec = () => {
  const c = cfg();
  return {
    configured: configured(), base: c.base, keySet: !!c.key, keyHeader: c.keyHeader,
    provider: c.provider, timeoutMs: c.timeoutMs, insecure: c.insecure,
    endpoints: ENDPOINTS.map(e => ({ key: e.key, path: e.path, title: e.title, note: e.note, body: e.body,
      fields: e.fields.map(([name, label, required]) => ({ name, label, required: !!required })),
      returns: e.returns, template: template(e) }))
  };
};

/* can this host reach the CST gateway at all? 152 has no general internet route, so a failure here is a network
 * fact to report, not a credential problem to debug. */
function reachable(timeoutMs = 4000) {
  const c = cfg();
  let u; try { u = new URL(c.base); } catch (e) { return Promise.resolve({ ok: false, error: 'CST_API_BASE is not a URL: ' + c.base }); }
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

/* FileBinary is base64 and routinely megabytes. It is never useful in a browser and never leaves the server. */
function slimBinary(v, depth = 0) {
  if (v == null || depth > 6) return v;
  if (Array.isArray(v)) return v.map(x => slimBinary(x, depth + 1));
  if (typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (/^file(binary|content|data)$/i.test(k) && typeof x === 'string') { o[k] = `«${x.length.toLocaleString('en-US')} base64 characters — not shown»`; o[k + '_bytes'] = Math.round(x.length * 3 / 4); continue; }
    o[k] = slimBinary(x, depth + 1);
  }
  return o;
}

async function call(endpointKey, fields = {}) {
  const c = cfg();
  if (!configured()) return { ok: false, error: 'CST API not configured (CST_API_BASE / CST_API=0)' };
  const e = byKey(endpointKey);
  if (!e) return { ok: false, error: 'unknown endpoint: ' + endpointKey + ' (one of ' + ENDPOINTS.map(x => x.key).join(', ') + ')' };
  /* the body is rebuilt from the endpoint's own field list — nothing the caller invents reaches CST */
  const inner = {};
  for (const [f] of e.fields) {
    const v = fields[f];
    inner[f] = v == null ? '' : String(v).trim().slice(0, 200);
  }
  if ('Provider' in inner && !inner.Provider) inner.Provider = c.provider;
  const missing = e.fields.filter(([f, , req]) => req && !inner[f]).map(([f]) => f);
  if (missing.length) return { ok: false, error: 'required field(s) empty: ' + missing.join(', ') };
  const payload = JSON.stringify(inner);

  const u = new URL(c.base + e.path);
  const mod = u.protocol === 'https:' ? https : http;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  if (c.key) headers[c.keyHeader] = c.key;
  const t0 = Date.now();
  return new Promise(resolve => {
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
      method: 'POST', headers, rejectUnauthorized: !c.insecure, timeout: c.timeoutMs }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', d => { bytes += d.length; if (bytes <= 12 * 1024 * 1024) chunks.push(d); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const ms = Date.now() - t0;
        let body = null, parsed = false;
        try { body = slimBinary(JSON.parse(raw)); parsed = true; } catch (_) { body = raw.slice(0, 20000); }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, endpoint: e.key, path: e.path, url: c.base + e.path,
          status: res.statusCode, statusText: res.statusMessage || '', ms, bytes, json: parsed,
          contentType: res.headers['content-type'] || null, request: inner, bodyName: e.body, response: body,
          note: !parsed ? 'the gateway did not answer with JSON — the raw body is shown as text' : null });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, endpoint: e.key, path: e.path, ms: Date.now() - t0, request: inner, error: `no response within ${c.timeoutMs} ms` }); });
    req.on('error', err => resolve({ ok: false, endpoint: e.key, path: e.path, ms: Date.now() - t0, request: inner,
      error: err.code === 'ENOTFOUND' ? `${u.hostname} does not resolve from this host`
        : err.code === 'ECONNREFUSED' ? `${u.hostname} refused the connection`
        : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(err.code || '') ? `TLS: ${err.code} — set CST_API_INSECURE=1 if the gateway uses a self-signed certificate, as the production PowerShell path does`
        : `${err.code || ''} ${err.message}`.trim() }));
    req.write(payload); req.end();
  });
}

module.exports = { configured, cfg, spec, call, reachable, ENDPOINTS, byKey, template, slimBinary };
