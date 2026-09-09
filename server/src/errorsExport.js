/* errorsExport.js — Troubleshoot (Mobile error control board) export: analysed PDF + complete XLSX, exactly as filtered
 * (window / range end, team, category, class, decline code, gateway, search). Mirrors the Fixed › Errors export.
 *   GET /api/errors/export?format=xlsx|pdf&window=24&sim=<ISO>&team=&category=&cls=&code=&gw=&q=   (cap: export, audited)
 * XLSX: sheet "Failures" (every row, up to 5 000) + sheet "Summary" (filters, by category with Business/Technical split,
 *       by team, payment decline codes, by gateway, gateway registry). PDF: same analysis, rows capped at 400. */
'use strict';
const errors = require('./errors');
const roles = require('./roles');
const gateways = require('./gateways');

const ksaStr = iso => { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso || ''); } };
const oneLine = (v, max) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const CAT = errors.CATEGORIES;
const catLabel = c => (CAT[c] && CAT[c].label) || c || 'All categories';

async function exportData(q, req, now, cap) {
  const windowHours = Math.min(720, Math.max(1, Number(q.window || 24)));
  const n = new Date(now).toISOString(), from = new Date(new Date(n).getTime() - windowHours * 3600e3).toISOString();
  const allowUnmask = !!(req.caps && req.caps.unmaskPII);
  const [summary, feedRaw, pay, gw] = await Promise.all([
    errors.summary({ now: n, windowHours, team: q.team || undefined }),
    errors.feed({ now: n, windowHours, category: q.category || undefined, team: q.team || undefined, q: q.q || undefined, limit: cap, code: q.code || undefined, gw: q.gw || undefined, cls: q.cls || undefined }),
    (!q.category || q.category === 'payment') ? errors.codeBreakdown({ category: 'payment', now: n, windowHours }).catch(() => null) : Promise.resolve(null),
    gateways.status().catch(() => null),
  ]);
  const feed = roles.maskDeep(feedRaw, allowUnmask);
  const flat = feed.map(r => ({ when: r.when, category: catLabel(r.category), cat: r.category, cls: r.err_class || '', reason: r.err_reason || '', team: r.team || '',
    identifier: r.identifier || '', mobile: r.mobile || '', gw: r.gw || '', detail: r.detail || '', order: r.order_id || '', ref: r.ref || '', id: r.id || '' }));
  const tot = summary.reduce((a, c) => a + c.total, 0), tec = summary.reduce((a, c) => a + c.technical, 0);
  const filters = [
    ['Period', `last ${windowHours}h — ${ksaStr(from)} → ${ksaStr(n)} KSA${q.sim ? ' (range end pinned)' : ''}`],
    ['Category', q.category ? catLabel(q.category) : 'All categories'], ['Team', q.team || 'All teams'],
    ['Class', q.cls === 'technical' ? 'Technical only' : q.cls === 'business' ? 'Business only' : 'Business + Technical'],
    ['Decline code', q.code || '—'], ['Gateway', q.gw || 'All gateways'], ['Search', q.q || '—'],
    ['Live gateways', gw ? (gw.gateways.filter(x => x.enabled).map(x => x.label).join(', ') || 'none') + ' · disabled: ' + (gw.gateways.filter(x => !x.enabled).map(x => x.label).join(', ') || 'none') : '—'],
    ['Rows', `${flat.length}${flat.length >= cap ? ` (capped at ${cap} — narrow the window for the rest)` : ''}`],
    ['PII', allowUnmask ? 'unmasked (export by a PII-cleared role)' : 'masked as on the board'],
    ['Generated', `${ksaStr(new Date().toISOString())} KSA by ${req.actor || 'console'}`],
  ];
  return { windowHours, from, to: n, summary, tot, tec, flat, filters, pay, gw, capped: flat.length >= cap };
}

function exportXlsx(d) {
  const xlsx = require('./xlsx');
  const HEAD = ['Time (KSA)', 'Category', 'Class', 'Reason', 'Team', 'Identifier', 'Mobile', 'Gateway', 'Detail', 'Order id', 'Gateway ref', 'Row id'];
  const body = d.flat.map(r => [ksaStr(r.when), r.category, r.cls, r.reason, r.team, r.identifier, r.mobile, r.gw, oneLine(r.detail, 4000), r.order, r.ref, r.id]);
  const S = [['Troubleshoot — error control board — export'], []];
  d.filters.forEach(([k, v]) => S.push([k, v]));
  S.push([], ['Totals', 'Total', 'Business', 'Technical'], ['All categories', d.tot, d.tot - d.tec, d.tec], []);
  S.push(['By category', 'Total', 'Business', 'Technical', 'Team']); d.summary.forEach(c => S.push([c.label, c.total, c.business, c.technical, c.team]));
  const byTeam = {}; d.summary.forEach(c => { byTeam[c.team] = byTeam[c.team] || { t: 0, tec: 0 }; byTeam[c.team].t += c.total; byTeam[c.team].tec += c.technical; });
  S.push([], ['By team', 'Total', 'Business', 'Technical']); Object.entries(byTeam).forEach(([t, v]) => S.push([t, v.t, v.t - v.tec, v.tec]));
  if (d.pay) {
    S.push([], ['Payment declines — gateway code · message', 'Count', 'Share']); (d.pay.codes || []).forEach(c => S.push([`${c.code || '—'} · ${c.message || ''}`, c.count, d.pay.total ? Math.round(1000 * c.count / d.pay.total) / 10 + '%' : '']));
    S.push([], ['Payment declines — by gateway', 'Count']); (d.pay.gateways || []).forEach(g => S.push([g.gw || '—', g.count]));
  }
  const byGw = {}; d.flat.forEach(r => { if (r.gw) byGw[r.gw] = (byGw[r.gw] || 0) + 1; });
  if (Object.keys(byGw).length) { S.push([], ['Rows by gateway (this export)', 'Rows']); Object.entries(byGw).sort((a, b) => b[1] - a[1]).forEach(([g, c]) => S.push([g, c])); }
  if (d.gw) { S.push([], ['Gateway registry', 'State', 'Since', 'Payments 24h', 'Note']); d.gw.gateways.forEach(g => S.push([g.label, g.enabled ? 'enabled' : 'disabled', g.since ? ksaStr(g.since) : '', g.traffic ? g.traffic.n24 : '', g.note || ''])); }
  return xlsx.build([
    { name: 'Failures', rows: [HEAD, ...body], widths: [19, 24, 10, 34, 12, 26, 16, 10, 60, 30, 30, 22] },
    { name: 'Summary', rows: S, numericCols: [1, 2, 3], widths: [46, 14, 12, 12, 14] },
  ]);
}

function exportPdf(d) {
  const pdfout = require('./pdfout');
  const doc = pdfout.doc({ footer: `Salam Operations Console - Troubleshoot (Mobile) - generated ${ksaStr(new Date().toISOString())} KSA` });
  const CC = doc.colors;
  const top = doc.band(64, CC.dark);
  doc.at(46, top + 24, 'MOBILE - TROUBLESHOOT - ERROR CONTROL BOARD', { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
  doc.at(46, top + 44, `${d.tot.toLocaleString()} failures - ${d.tec.toLocaleString()} technical - last ${d.windowHours}h`, { size: 15, bold: true, color: CC.white });
  doc.space(10);
  doc.h2('Filters'); doc.kv(d.filters, { boldVal: true });
  doc.h2('Summary - by category (Business = the platform said no correctly; Technical = the platform failed)');
  doc.table([{ label: 'Category', w: 30 }, { label: 'Team', w: 14 }, { label: 'Total', w: 10, align: 'right' }, { label: 'Business', w: 10, align: 'right' }, { label: 'Technical', w: 10, align: 'right' }, { label: 'Tech %', w: 8, align: 'right' }],
    d.summary.map(c => [c.label, c.team, String(c.total), String(c.business), String(c.technical), c.total ? Math.round(100 * c.technical / c.total) + '%' : '0%']),
    { rowColor: ri => d.summary[ri].technical > 0 ? CC.amber : null });
  if (d.pay && (d.pay.codes || []).length) {
    doc.h2(`Payment declines - gateway code / message (${d.pay.total} in the window)`);
    doc.table([{ label: 'Code - message', w: 60 }, { label: 'Count', w: 10, align: 'right' }, { label: 'Share', w: 8, align: 'right' }],
      d.pay.codes.slice(0, 30).map(c => [`${c.code || '—'} - ${oneLine(c.message || '', 90)}`, String(c.count), d.pay.total ? Math.round(100 * c.count / d.pay.total) + '%' : '']));
    if ((d.pay.gateways || []).length) doc.table([{ label: 'Gateway', w: 30 }, { label: 'Declines', w: 10, align: 'right' }], d.pay.gateways.map(g => [g.gw || '—', String(g.count)]));
  }
  if (d.gw) {
    doc.h2('Payment gateways - registry');
    doc.table([{ label: 'Gateway', w: 14 }, { label: 'State', w: 10 }, { label: 'Since (KSA)', w: 16 }, { label: 'Payments 24h', w: 10, align: 'right' }, { label: 'Note', w: 40 }],
      d.gw.gateways.map(g => [g.label, g.enabled ? 'enabled' : 'disabled', g.since ? ksaStr(g.since) : '—', g.traffic ? String(g.traffic.n24) : '—', oneLine(g.note || '', 80)]),
      { rowColor: ri => d.gw.gateways[ri].warning ? CC.amber : null });
  }
  doc.h2(`Failures - ${d.flat.length} row(s)${d.capped ? ' (PDF capped - the xlsx export holds the full list)' : ''}`);
  doc.table([{ label: 'Time (KSA)', w: 12 }, { label: 'Category', w: 13 }, { label: 'Class', w: 7 }, { label: 'Identifier', w: 14 }, { label: 'Mobile', w: 10 }, { label: 'GW', w: 7 }, { label: 'Detail', w: 37 }],
    d.flat.map(r => [ksaStr(r.when), r.category, r.cls || '—', oneLine(r.identifier, 24) || '—', r.mobile || '—', r.gw || '—', oneLine(r.detail, 120) || '—']),
    { size: 6.8, rowColor: ri => d.flat[ri].cls === 'technical' ? CC.red : null });
  doc.p('Identifiers are masked as on the board unless exported by a PII-cleared role; timelines and gateway traces stay in the console (Troubleshoot > Timeline / ⇄ UPG).', { color: CC.muted, size: 8 });
  return doc.buffer();
}

function mount(app, { boardNow, audit }) {
  app.get('/api/errors/export', async (req, res) => {
    if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
    const q = req.query || {}; const format = q.format === 'pdf' ? 'pdf' : 'xlsx';
    try {
      const now = await boardNow(q.sim);
      const d = await exportData(q, req, now, format === 'pdf' ? 400 : 5000);
      if (audit) audit(req, 'errors.export', format, { rows: d.flat.length, window: q.window || 24, category: q.category || null, team: q.team || null, cls: q.cls || null, code: q.code || null, gw: q.gw || null });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="troubleshoot_${q.category || 'all'}_${q.window || 24}h_${stamp}.${format}"`);
      if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.send(exportPdf(d)); }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.send(exportXlsx(d));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, exportData, exportXlsx, exportPdf };
