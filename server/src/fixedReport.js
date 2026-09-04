/* fixedReport.js — Fixed › Report: the branded "Activity Digest" of the prod Operations Console, rendered live.
 *
 * Port of salam-dealer-ops packages/api/src/report.ts (buildReport + buildHtml) and charts.ts (inline SVG line / bar /
 * donut) to pg over db.ops (sda_ops.public). Same section list and same definitions as the emailed digest:
 * Overview KPIs · Trends (attempts vs completed, by plan type, last REPORT_TREND_DAYS=10 days) · Channel split ·
 * Activity timing (SDA by KSA hour) · Workflow breakdown · Top regions (SDA) · Top dealers · QR / e-purchase ·
 * Integration health (Nafath / Manafith) · Open errors by category (error_events — unified addition) · Data quality ·
 * Coverage map (ONLY when STATIC_MAPS_KEY is set — Google Static Maps <img> + city bubbles; skipped otherwise).
 * NOTE: like the prod digest, the report counts EVERY order_attempts row in the window (consumer-direct e-purchase
 * included) — this is why its totals differ from the Dashboards page, exactly as they do in /operations-console.
 * Route (view 'fixed'): GET /api/fixed/report/html?window=24|168[&format=raw]  → { html, window } (or text/html) */
const LOGO_B64 = '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';
const LOGO = 'data:image/png;base64,' + LOGO_B64;
const TREND_DAYS = Math.max(2, Math.round(Number(process.env.REPORT_TREND_DAYS) || 10));
const WORKFLOWS = ['ftth', 'fttb', 'fiveGWhiteLabel', 'fiveGFWA', 'promoters', 'ePurchaseFTTH'];
const WF_LABEL = { ftth: 'FTTH', fttb: 'FTTB', fiveGWhiteLabel: '5G White-Label', fiveGFWA: '5G FWA', promoters: 'Promoters', ePurchaseFTTH: 'e-Purchase FTTH', unknown: 'Unknown' };

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rate = (a, b) => b > 0 ? a / b : 0;
const pctR = r => `${Math.round(r * 100)}%`;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KSA_STAMP = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtStamp = d => KSA_STAMP.format(d).replace(',', '');
const fmtDuration = s => { s = Math.round(s); if (s <= 0) return 'n/a'; const m = Math.floor(s / 60), r = s % 60; return m > 0 ? `${m}m ${r}s` : `${s}s`; };
const GREEN = '#0a7d3c', AMBER = '#b8860b', RED = '#c0392b';
const colorGood = (r, a, g) => r >= g ? GREEN : r >= a ? AMBER : RED;
const colorBad = (r, a, rr) => r >= rr ? RED : r >= a ? AMBER : GREEN;
function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }

/* ================= charts.ts ================= */
const PALETTE = ['#0a7d3c', '#2f81f7', '#d29922', '#a371f7', '#f85149', '#56b886'];
const AXIS = '#888', GRID = '#e6e6e6', TEXT = '#333', MUTED = '#999';
const svgOpen = (w, h) => `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" style="max-width:${w}px;font-family:Arial,Helvetica,sans-serif;"><rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`;
function niceMax(v) { if (!Number.isFinite(v) || v <= 0) return 1; const e = Math.floor(Math.log10(v)), b = Math.pow(10, e), f = v / b; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * b; }
const placeholder = (w, h, msg) => `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width:${w}px;font-family:Arial,Helvetica,sans-serif;"><rect x="0" y="0" width="${w}" height="${h}" fill="#fafafa" stroke="${GRID}"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="${MUTED}">${esc(msg || 'No data')}</text></svg>`;
function thinLabels(labels, max) { if (labels.length <= max) return labels; const step = Math.ceil(labels.length / max); return labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? l : null); }

function svgLineChart(series, xLabels, o = {}) {
  const W = o.width || 700, H = o.height || 280;
  const maxVal = Math.max(0, ...series.flatMap(s => s.values.filter(Number.isFinite)));
  if (!series.length || !series.some(s => s.values.length) || maxVal <= 0) return placeholder(W, H, o.title ? `${o.title} — no data` : 'No data');
  const padL = 46, padR = 16, padT = o.title ? 30 : 12, legendH = 22, padB = 46;
  const px = padL, py = padT + legendH, pw = W - padL - padR, ph = H - py - padB;
  const yMax = niceMax(maxVal), n = Math.max(...series.map(s => s.values.length));
  const xAt = i => n <= 1 ? px + pw / 2 : px + (pw * i) / (n - 1), yAt = v => py + ph - (ph * v) / yMax;
  const p = [svgOpen(W, H)];
  if (o.title) p.push(`<text x="${px}" y="18" font-size="13" font-weight="bold" fill="${TEXT}">${esc(o.title)}</text>`);
  let lx = px; const ly = padT + (o.title ? 4 : 0);
  for (const s of series) { p.push(`<rect x="${lx}" y="${ly}" width="10" height="10" fill="${s.color}" rx="2"/><text x="${lx + 14}" y="${ly + 9}" font-size="11" fill="${TEXT}">${esc(s.label)}</text>`); lx += 18 + s.label.length * 6.2 + 12; }
  for (let i = 0; i <= 5; i++) { const v = (yMax * i) / 5, yy = yAt(v); p.push(`<line x1="${px}" y1="${yy.toFixed(1)}" x2="${px + pw}" y2="${yy.toFixed(1)}" stroke="${GRID}"/><text x="${px - 6}" y="${(yy + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="${MUTED}">${Math.round(v)}</text>`); }
  p.push(`<line x1="${px}" y1="${py}" x2="${px}" y2="${py + ph}" stroke="${AXIS}"/><line x1="${px}" y1="${py + ph}" x2="${px + pw}" y2="${py + ph}" stroke="${AXIS}"/>`);
  if (o.yLabel) p.push(`<text x="12" y="${py + ph / 2}" font-size="10" fill="${MUTED}" text-anchor="middle" transform="rotate(-90 12 ${py + ph / 2})">${esc(o.yLabel)}</text>`);
  const shown = thinLabels(xLabels, 12);
  xLabels.forEach((l, i) => { if (shown[i] == null) return; const xx = xAt(i).toFixed(1), yy = py + ph + 12; p.push(`<text x="${xx}" y="${yy}" font-size="10" fill="${MUTED}" text-anchor="end" transform="rotate(-40 ${xx} ${yy})">${esc(l)}</text>`); });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(Number.isFinite(v) ? v : 0).toFixed(1)}`).join(' ');
    if (s.values.length > 1) p.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    s.values.forEach((v, i) => p.push(`<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(Number.isFinite(v) ? v : 0).toFixed(1)}" r="2.5" fill="${s.color}"/>`));
  }
  return p.join('\n') + '</svg>';
}
function svgBarChart(bars, o = {}) {
  const W = o.width || 700, horizontal = o.horizontal !== false;
  const maxVal = Math.max(0, ...bars.map(b => Number.isFinite(b.value) ? b.value : 0));
  if (!bars.length || maxVal <= 0) return placeholder(W, o.height || 160, o.title ? `${o.title} — no data` : 'No data');
  const yMax = niceMax(maxVal), p = [];
  if (horizontal) {
    const rowH = 26, gap = 8, padT = o.title ? 30 : 12, labelW = 130, valW = 46, px = labelW, pw = W - labelW - valW - 12;
    const H = o.height || padT + 12 + bars.length * (rowH + gap);
    p.push(svgOpen(W, H));
    if (o.title) p.push(`<text x="12" y="18" font-size="13" font-weight="bold" fill="${TEXT}">${esc(o.title)}</text>`);
    p.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${padT + bars.length * (rowH + gap)}" stroke="${AXIS}"/>`);
    bars.forEach((b, i) => { const v = Number.isFinite(b.value) ? b.value : 0, y = padT + i * (rowH + gap), w = (pw * v) / yMax;
      p.push(`<text x="${px - 8}" y="${y + rowH / 2 + 4}" font-size="11" text-anchor="end" fill="${TEXT}">${esc(b.label)}</text><rect x="${px}" y="${y}" width="${Math.max(0, w).toFixed(1)}" height="${rowH}" fill="${b.color || PALETTE[i % PALETTE.length]}" rx="2"/><text x="${(px + w + 6).toFixed(1)}" y="${y + rowH / 2 + 4}" font-size="11" fill="${TEXT}">${v}</text>`); });
  } else {
    const H = o.height || 260, padL = 40, padR = 12, padT = o.title ? 30 : 12, padB = 44, px = padL, py = padT, pw = W - padL - padR, ph = H - padT - padB;
    const slot = pw / bars.length, bw = Math.min(48, slot * 0.6);
    p.push(svgOpen(W, H));
    if (o.title) p.push(`<text x="12" y="18" font-size="13" font-weight="bold" fill="${TEXT}">${esc(o.title)}</text>`);
    for (let i = 0; i <= 4; i++) { const v = (yMax * i) / 4, yy = py + ph - (ph * v) / yMax; p.push(`<line x1="${px}" y1="${yy.toFixed(1)}" x2="${px + pw}" y2="${yy.toFixed(1)}" stroke="${GRID}"/><text x="${px - 6}" y="${(yy + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="${MUTED}">${Math.round(v)}</text>`); }
    p.push(`<line x1="${px}" y1="${py + ph}" x2="${px + pw}" y2="${py + ph}" stroke="${AXIS}"/>`);
    bars.forEach((b, i) => { const v = Number.isFinite(b.value) ? b.value : 0, cx = px + slot * i + slot / 2, h = (ph * v) / yMax, y = py + ph - h;
      p.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${b.color || PALETTE[i % PALETTE.length]}" rx="2"/><text x="${cx.toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="${TEXT}">${v}</text><text x="${cx.toFixed(1)}" y="${py + ph + 14}" font-size="10" text-anchor="middle" fill="${MUTED}" transform="rotate(-25 ${cx.toFixed(1)} ${py + ph + 14})">${esc(b.label)}</text>`); });
  }
  return p.join('\n') + '</svg>';
}
function svgDonutChart(slices, o = {}) {
  const W = o.width || 560, H = o.height || 220;
  const clean = slices.map(s => ({ ...s, value: Number.isFinite(s.value) ? Math.max(0, s.value) : 0 })).filter(s => s.value > 0);
  const total = clean.reduce((a, s) => a + s.value, 0);
  if (!clean.length || total <= 0) return placeholder(W, H, o.title ? `${o.title} — no data` : 'No data');
  const padT = o.title ? 30 : 12, cy = padT + (H - padT - 12) / 2, cx = H, rO = Math.min((H - padT - 24) / 2, 78), rI = rO * 0.6;
  const p = [svgOpen(W, H)];
  if (o.title) p.push(`<text x="12" y="18" font-size="13" font-weight="bold" fill="${TEXT}">${esc(o.title)}</text>`);
  const pol = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  if (clean.length === 1) p.push(`<circle cx="${cx}" cy="${cy.toFixed(1)}" r="${((rO + rI) / 2).toFixed(1)}" fill="none" stroke="${clean[0].color}" stroke-width="${(rO - rI).toFixed(1)}"/>`);
  else { let a0 = -Math.PI / 2; for (const s of clean) { const a1 = a0 + (s.value / total) * Math.PI * 2, L = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pol(rO, a0), [x1, y1] = pol(rO, a1), [i1, j1] = pol(rI, a1), [i0, j0] = pol(rI, a0);
    p.push(`<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rO} ${rO} 0 ${L} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${i1.toFixed(2)} ${j1.toFixed(2)} A ${rI} ${rI} 0 ${L} 0 ${i0.toFixed(2)} ${j0.toFixed(2)} Z" fill="${s.color}"/>`); a0 = a1; } }
  if (o.centerLabel) p.push(`<text x="${cx}" y="${(cy + 4).toFixed(1)}" font-size="14" font-weight="bold" text-anchor="middle" fill="${TEXT}">${esc(o.centerLabel)}</text>`);
  let ly = padT + 6; const lx = cx + rO + 16;
  for (const s of clean) { p.push(`<rect x="${lx}" y="${ly}" width="11" height="11" fill="${s.color}" rx="2"/><text x="${lx + 16}" y="${ly + 10}" font-size="12" fill="${TEXT}">${esc(s.label)} — ${s.value} (${Math.round((s.value / total) * 100)}%)</text>`); ly += 22; }
  return p.join('\n') + '</svg>';
}

/* ================= data (report.ts build*) ================= */
async function buildReport(db, windowStart, now) {
  const P = [windowStart.toISOString(), now.toISOString()];
  const Q = (sql, params) => db.ops.query(sql, params || P);
  const W = `oa.started_at >= $1 AND oa.started_at <= $2`;
  const trendStart = new Date(now.getTime() + 3 * 3600e3); trendStart.setUTCHours(0, 0, 0, 0); trendStart.setUTCDate(trendStart.getUTCDate() - (TREND_DAYS - 1));
  const trendStartUtc = new Date(trendStart.getTime() - 3 * 3600e3);   // KSA midnight, TREND_DAYS-1 days ago
  const safe = pr => pr.catch(e => { console.error('[fixed report]', e.message); return { rows: [] }; });
  const [ov, ch, wf, rg, dl, qrK, qrRefs, naf, nafBy, man, qual, outside, trends, mapPts, hours, errs] = await Promise.all([
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.outcome='IN_PROGRESS')::int AS in_progress,
              avg(oa.duration_s) FILTER (WHERE oa.duration_s IS NOT NULL) AS avg_duration_s, count(DISTINCT oa.dealer_id)::int AS distinct_dealers FROM order_attempts oa WHERE ${W}`),
    Q(`SELECT oa.channel, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed FROM order_attempts oa WHERE ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed FROM order_attempts oa WHERE ${W} GROUP BY 1`),
    Q(`SELECT d.region, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id
         WHERE oa.channel='sda' AND ${W} AND d.region IS NOT NULL AND btrim(d.region) <> '' AND lower(btrim(d.region)) NOT IN ('unknown','(unknown)') GROUP BY d.region ORDER BY total DESC LIMIT 8`),
    Q(`SELECT d.staff_name, d.region, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*)::int AS total FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id
         WHERE ${W} GROUP BY d.id, d.staff_name, d.region ORDER BY completed DESC, total DESC LIMIT 10`),
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.consent = true)::int AS consent_yes, count(*) FILTER (WHERE oa.consent IS NOT NULL)::int AS consent_total
         FROM order_attempts oa WHERE ${W} AND oa.channel='epurchase' AND oa.referral_code IS NOT NULL`),
    Q(`SELECT oa.referral_code, count(*)::int AS orders, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed FROM order_attempts oa
         WHERE oa.channel='epurchase' AND oa.referral_code IS NOT NULL AND ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.nafath_outcome <> 'COMPLETED')::int AS failed FROM order_attempts oa
         WHERE ${W} AND oa.nafath_outcome IS NOT NULL AND oa.workflow::text IN ('fiveGWhiteLabel','fiveGFWA')`),
    Q(`SELECT oa.nafath_outcome AS outcome, count(*)::int AS count FROM order_attempts oa WHERE ${W} AND oa.nafath_outcome IS NOT NULL AND oa.workflow::text IN ('fiveGWhiteLabel','fiveGFWA') GROUP BY 1 ORDER BY 2 DESC`),
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.dealer_validation='DENIED')::int AS denied FROM order_attempts oa WHERE ${W} AND oa.dealer_validation IS NOT NULL`),
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.lat IS NOT NULL AND oa.lng IS NOT NULL)::int AS with_geo, count(*) FILTER (WHERE oa.workflow::text='unknown')::int AS unknown_workflow,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed_total, count(*) FILTER (WHERE oa.outcome='COMPLETED' AND oa.order_number IS NULL)::int AS completed_missing_order,
              count(*) FILTER (WHERE oa.channel='epurchase' AND oa.referral_code IS NOT NULL)::int AS qr_total,
              count(*) FILTER (WHERE oa.channel='epurchase' AND oa.referral_code IS NOT NULL AND oa.lat IS NOT NULL AND oa.lng IS NOT NULL)::int AS qr_with_geo
         FROM order_attempts oa WHERE ${W}`),
    Q(`SELECT count(*)::int AS c FROM order_attempts oa WHERE ${W} AND oa.lat IS NOT NULL AND oa.lng IS NOT NULL AND (oa.lat < 16 OR oa.lat > 33 OR oa.lng < 34 OR oa.lng > 56)`),
    safe(Q(`SELECT to_char(date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS day, count(*)::int AS total,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.workflow::text='ftth')::int AS ftth, count(*) FILTER (WHERE oa.workflow::text='fttb')::int AS fttb,
              count(*) FILTER (WHERE oa.workflow::text='fiveGWhiteLabel')::int AS five_g_wl, count(*) FILTER (WHERE oa.workflow::text='fiveGFWA')::int AS five_g_fwa,
              count(*) FILTER (WHERE oa.workflow::text='ePurchaseFTTH')::int AS epurchase_ftth, count(*) FILTER (WHERE oa.workflow::text='promoters')::int AS promoters
         FROM order_attempts oa WHERE oa.started_at >= $1 GROUP BY 1 ORDER BY 1 LIMIT 100`, [trendStartUtc.toISOString()])),
    safe(Q(`SELECT d.city, avg(oa.lat)::float AS lat, avg(oa.lng)::float AS lng, count(*)::int AS n FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id
         WHERE oa.lat IS NOT NULL AND oa.lng IS NOT NULL AND ${W} AND oa.lat BETWEEN 16 AND 33 AND oa.lng BETWEEN 34 AND 56
           AND d.city IS NOT NULL AND btrim(d.city) <> '' AND lower(d.city) <> 'unknown' GROUP BY d.city ORDER BY n DESC LIMIT 20`)),
    safe(Q(`SELECT EXTRACT(HOUR FROM oa.started_at AT TIME ZONE 'Asia/Riyadh')::int AS hr, count(*)::int AS n FROM order_attempts oa WHERE oa.channel='sda' AND ${W} GROUP BY 1`)),
    safe(Q(`SELECT category, count(*)::int AS n, count(*) FILTER (WHERE NOT resolved)::int AS open, max(occurred_at) AS last_at
         FROM error_events WHERE occurred_at >= $1 AND occurred_at <= $2 GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 12`)),
  ]);
  const o = ov.rows[0] || {}, q = qual.rows[0] || {}, k = qrK.rows[0] || {}, nf = naf.rows[0] || {}, mn = man.rows[0] || {};
  // channels: sda + epurchase always present in that order, then any others
  const chMap = new Map(ch.rows.map(r => [r.channel, r]));
  const channels = ['sda', 'epurchase'].map(c => ({ channel: c, total: num((chMap.get(c) || {}).total), completed: num((chMap.get(c) || {}).completed) }))
    .concat(ch.rows.filter(r => !['sda', 'epurchase'].includes(r.channel)).map(r => ({ channel: r.channel, total: num(r.total), completed: num(r.completed) })));
  const wfMap = new Map(wf.rows.map(r => [r.workflow, r]));
  const workflows = WORKFLOWS.map(w => ({ workflow: w, total: num((wfMap.get(w) || {}).total), completed: num((wfMap.get(w) || {}).completed) })).filter(w => w.total > 0).sort((a, b) => b.total - a.total);
  // trends on a complete KSA-day axis
  const dayKeys = [], labels = [];
  for (let i = 0; i < TREND_DAYS; i++) { const d = new Date(trendStart.getTime() + i * 86400e3); const key = d.toISOString().slice(0, 10); dayKeys.push(key); labels.push(key.slice(5)); }
  const byDay = new Map(trends.rows.map(r => [r.day, r]));
  const pick = (key, f) => num((byDay.get(key) || {})[f]);
  const wfField = { ftth: 'ftth', fttb: 'fttb', fiveGWhiteLabel: 'five_g_wl', fiveGFWA: 'five_g_fwa', ePurchaseFTTH: 'epurchase_ftth', promoters: 'promoters' };
  const hourMap = new Map(hours.rows.map(r => [Number(r.hr), num(r.n)]));
  return {
    overview: { total: num(o.total), completed: num(o.completed), inProgress: num(o.in_progress), avgDurationS: num(o.avg_duration_s), distinctDealers: num(o.distinct_dealers) },
    channels, workflows,
    regions: rg.rows.map(r => ({ region: r.region || '(unknown)', total: num(r.total), completed: num(r.completed) })),
    dealers: dl.rows.map(r => ({ name: r.staff_name || '(unknown)', region: r.region || '—', completed: num(r.completed), total: num(r.total) })),
    qr: { totalQrOrders: num(k.total), consentYes: num(k.consent_yes), consentTotal: num(k.consent_total), topReferrals: qrRefs.rows.map(r => ({ code: r.referral_code, orders: num(r.orders), completed: num(r.completed) })) },
    nafath: { total: num(nf.total), failed: num(nf.failed), byOutcome: nafBy.rows.map(r => ({ outcome: r.outcome || '(null)', count: num(r.count) })) },
    manafith: { total: num(mn.total), denied: num(mn.denied) },
    quality: { total: num(q.total), withGeo: num(q.with_geo), unknownWorkflow: num(q.unknown_workflow), completedTotal: num(q.completed_total), completedMissingOrderNo: num(q.completed_missing_order),
               qrTotal: num(q.qr_total), qrWithGeo: num(q.qr_with_geo), pinsOutsideKsa: num((outside.rows[0] || {}).c) },
    trends: { days: labels, attempts: dayKeys.map(d => pick(d, 'total')), completed: dayKeys.map(d => pick(d, 'completed')),
              byWorkflow: Object.keys(wfField).map(w => ({ workflow: w, values: dayKeys.map(d => pick(d, wfField[w])) })) },
    mapPoints: mapPts.rows.filter(r => r.lat != null && r.lng != null && r.city).map(r => ({ city: r.city, lat: Number(r.lat), lng: Number(r.lng), count: num(r.n) })),
    hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourMap.get(h) || 0 })),
    errors: errs.rows.map(r => ({ category: r.category || '(uncategorised)', n: num(r.n), open: num(r.open), lastAt: r.last_at })),
  };
}

/* ================= HTML (report.ts buildHtml) ================= */
const BRAND_DEEP = '#0A3B28', BRAND_MID = '#0F7A3D', BRAND_GREEN = '#00A651', BRAND_LIME = '#43D06A', HEAD_TEXT = '#0B3D2A', MINT_TEXT = '#CFEBD9';
const PANEL_BORDER = '#DCEFE2', PANEL_BG = '#ffffff', PANEL_BG_SOFT = '#F2FAF4', ZEBRA_BG = '#F7FCF9', ROW_BORDER = '#E6F2EA', TEXT_DARK = '#2C3A33', TEXT_MUTED = '#6B7C72', PAGE_BG = '#EDF4EF';
const FONT = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";
const TD = `padding:9px 12px;border-bottom:1px solid ${ROW_BORDER};color:${TEXT_DARK};`, TDR = `${TD}text-align:right;white-space:nowrap;`, TH = `padding:9px 12px;text-align:left;font-weight:600;`, THR = `${TH}text-align:right;`;
const sectionTitle = s => `<h2 style="font-size:16px;font-weight:700;margin:22px 0 10px;color:${HEAD_TEXT};border-left:4px solid ${BRAND_LIME};padding:0 0 0 10px;line-height:1.2;font-family:${FONT};">${esc(s)}</h2>`;
const tableOpen = () => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;margin:0;">`;
const convCell = (c, t) => { const r = rate(c, t); return `<td style="${TDR}color:${colorGood(r, 0.25, 0.5)};font-weight:bold;">${pctR(r)}</td>`; };
const chartCard = inner => `<div style="border:1px solid ${PANEL_BORDER};border-radius:14px;padding:16px;margin:0 0 14px;background:${PANEL_BG};box-shadow:0 4px 14px rgba(11,61,42,0.05);overflow:hidden;">${inner}</div>`;
const tableCard = inner => `<div style="border:1px solid ${PANEL_BORDER};border-radius:14px;overflow:hidden;margin:0 0 14px;background:${PANEL_BG};box-shadow:0 4px 14px rgba(11,61,42,0.05);">${inner}</div>`;
const zebra = rows => rows.map((cells, i) => `<tr style="background:${i % 2 === 1 ? ZEBRA_BG : PANEL_BG};">${cells}</tr>`).join('\n');
const theadRow = cells => `<thead><tr style="background:${BRAND_GREEN};color:#ffffff;">${cells}</tr></thead>`;
const statCard = (label, value, color) => `<td width="33%" valign="top" style="padding:0 6px 12px;"><div style="background:${PANEL_BG_SOFT};border:1px solid ${PANEL_BORDER};border-radius:14px;padding:16px 14px;"><div style="font-size:26px;font-weight:700;color:${color};line-height:1.1;font-family:${FONT};">${value}</div><div style="font-size:11px;color:${TEXT_MUTED};text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">${esc(label)}</div></div></td>`;
const emptyRow = (n, msg) => `<tr><td style="${TD}" colspan="${n}">${msg}</td></tr>`;

/* Coverage map — Google Static Maps base + city bubbles projected with Web-Mercator. Only when STATIC_MAPS_KEY is set. */
function buildMapBlock(points, windowHours, key) {
  if (!key || !points.length) return '';
  const LAT = 24.0, LNG = 45.0, ZOOM = 5, MW = 640, MH = 420, world = 256 * 2 ** ZOOM;
  const proj = (lat, lng) => { const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999); return { x: ((lng + 180) / 360) * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world }; };
  const c = proj(LAT, LNG), toPx = (lat, lng) => { const p = proj(lat, lng); return { left: MW / 2 + (p.x - c.x), top: MH / 2 + (p.y - c.y) }; };
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${LAT},${LNG}&zoom=${ZOOM}&size=${MW}x${MH}&maptype=roadmap&key=${encodeURIComponent(key)}`;
  const maxV = Math.max(1, ...points.map(p => p.count)), ordered = [...points].sort((a, b) => b.count - a.count), labelSet = new Set(ordered.slice(0, 8).map(p => p.city));
  const divs = [];
  ordered.forEach((p, i) => { const px = toPx(p.lat, p.lng); if (px.left < 0 || px.left > MW || px.top < 0 || px.top > MH) return;
    const d = 14 + Math.sqrt(p.count / maxV) * 40, left = px.left - d / 2, top = px.top - d / 2, z = 1000 - i, inside = d >= 22, fs = Math.max(9, Math.min(14, Math.round(d * 0.34)));
    divs.push(`<div style="position:absolute;left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${d.toFixed(1)}px;height:${d.toFixed(1)}px;border-radius:50%;background:rgba(10,125,60,0.55);border:1.5px solid #0a5a2b;box-sizing:border-box;z-index:${z};${inside ? `display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:${fs}px;line-height:1;` : ''}">${inside ? p.count : ''}</div>`);
    if (!inside) divs.push(`<div style="position:absolute;left:${(px.left - 14).toFixed(1)}px;top:${(top - 12).toFixed(1)}px;width:28px;text-align:center;color:#0a5a2b;font-weight:bold;font-size:9px;line-height:1;z-index:${z};">${p.count}</div>`);
    if (labelSet.has(p.city)) divs.push(`<div style="position:absolute;left:${(px.left - 40).toFixed(1)}px;top:${(px.top + d / 2 + 1).toFixed(1)}px;width:80px;text-align:center;color:#1a1a1a;font-size:9px;line-height:1.1;z-index:${z};text-shadow:0 0 2px #fff,0 0 2px #fff;">${esc(p.city)}</div>`); });
  const cityTable = tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">City</th><th style="${THR}">Attempts (geo)</th>`)}<tbody>${zebra(points.slice(0, 12).map(p => `<td style="${TD}">${esc(p.city)}</td><td style="${TDR}">${p.count}</td>`))}</tbody></table>`);
  return `${sectionTitle('Coverage map')}${chartCard(`<h3 style="font-size:13px;margin:0 0 8px;color:${HEAD_TEXT};font-weight:600;font-family:${FONT};">Coverage by city (KSA)</h3><div style="position:relative;width:${MW}px;max-width:100%;overflow:hidden;border-radius:10px;"><img src="${esc(url)}" alt="Coverage map of KSA by city" width="${MW}" height="${MH}" style="display:block;width:${MW}px;height:${MH}px;max-width:100%;"/>${divs.join('')}</div>`)}
    <p style="font-size:11px;color:${TEXT_MUTED};margin:2px 0 14px;">Bubble size &amp; number = attempts with geo (last ${windowHours}h). Base map &copy; Google.</p>${cityTable}`;
}

function buildHtml(r, windowStart, now, windowHours, consoleUrl) {
  const ov = r.overview, q = r.quality, convR = rate(ov.completed, ov.total);
  const trendChart = chartCard(svgLineChart([{ label: 'Attempts', color: PALETTE[0], values: r.trends.attempts }, { label: 'Completed', color: PALETTE[1], values: r.trends.completed }], r.trends.days, { title: `Attempts vs Completed — last ${TREND_DAYS} days`, yLabel: 'per day' }));
  const planChart = chartCard(svgLineChart(r.trends.byWorkflow.filter(w => w.values.some(v => v > 0)).map((w, i) => ({ label: WF_LABEL[w.workflow], color: PALETTE[i % PALETTE.length], values: w.values })), r.trends.days, { title: `Activity by plan type — last ${TREND_DAYS} days`, yLabel: 'attempts/day' }));
  const wfChart = chartCard(svgBarChart(r.workflows.map((w, i) => ({ label: WF_LABEL[w.workflow] || w.workflow, value: w.total, color: PALETTE[i % PALETTE.length] })), { title: 'Attempts by workflow' }));
  const regionChart = chartCard(svgBarChart(r.regions.map(g => ({ label: g.region, value: g.total })), { title: 'Attempts by region (SDA)' }));
  const chColor = { sda: PALETTE[0], epurchase: '#2f81f7', salamhome: PALETTE[3] };
  const channelDonut = chartCard(svgDonutChart(r.channels.filter(c => c.total > 0).map((c, i) => ({ label: c.channel, value: c.total, color: chColor[c.channel] || PALETTE[i % PALETTE.length] })), { title: 'Channel split (by attempts)', centerLabel: String(r.channels.reduce((a, c) => a + c.total, 0)) }));
  const hourChart = chartCard(svgBarChart(r.hours.map(h => ({ label: String(h.hour).padStart(2, '0'), value: h.count, color: h.hour >= 15 && h.hour <= 22 ? GREEN : '#bdbdbd' })), { title: `Dealer activity by hour (KSA) — totals over last ${windowHours}h`, horizontal: false, width: 700, height: 260 }));
  const overviewBlock = `${sectionTitle('Overview')}<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 14px;">
      <tr>${statCard('Total attempts', String(ov.total), BRAND_GREEN)}${statCard('Completed', String(ov.completed), BRAND_GREEN)}${statCard('Conversion', pctR(convR), colorGood(convR, 0.25, 0.5))}</tr>
      <tr>${statCard('In progress', String(ov.inProgress), BRAND_GREEN)}${statCard('Avg duration', esc(fmtDuration(ov.avgDurationS)), BRAND_GREEN)}${statCard('Active dealers', String(ov.distinctDealers), BRAND_GREEN)}</tr></table>`;
  const channelBlock = `${sectionTitle('Channel split')}${channelDonut}${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Channel</th><th style="${THR}">Attempts</th><th style="${THR}">Completed</th><th style="${THR}">Conv</th>`)}<tbody>${zebra(r.channels.map(c => `<td style="${TD}">${esc(c.channel)}</td><td style="${TDR}">${c.total}</td><td style="${TDR}">${c.completed}</td>${convCell(c.completed, c.total)}`))}</tbody></table>`)}`;
  const hoursBlock = `${sectionTitle('Activity timing')}${hourChart}<p style="font-size:12px;color:${TEXT_MUTED};margin:0 0 14px;">Each bar is the SDA attempts in that clock-hour summed across the last ${windowHours}h (not a single day). Dealer activity typically runs ~15:00–22:00 KSA; off-hours volume may indicate test/automated traffic.</p>`;
  const wfBlock = `${sectionTitle('Workflow breakdown')}${wfChart}${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Workflow</th><th style="${THR}">Attempts</th><th style="${THR}">Completed</th><th style="${THR}">Conv</th>`)}<tbody>${r.workflows.length ? zebra(r.workflows.map(w => `<td style="${TD}">${esc(WF_LABEL[w.workflow] || w.workflow)}</td><td style="${TDR}">${w.total}</td><td style="${TDR}">${w.completed}</td>${convCell(w.completed, w.total)}`)) : emptyRow(4, 'No activity.')}</tbody></table>`)}`;
  const regionBlock = `${sectionTitle('Top regions (SDA)')}${regionChart}${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Region</th><th style="${THR}">Attempts</th><th style="${THR}">Conv</th>`)}<tbody>${r.regions.length ? zebra(r.regions.map(g => `<td style="${TD}">${esc(g.region)}</td><td style="${TDR}">${g.total}</td>${convCell(g.completed, g.total)}`)) : emptyRow(3, 'No SDA activity.')}</tbody></table>`)}`;
  const dealerBlock = `${sectionTitle('Top dealers (by completed)')}${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Dealer</th><th style="${TH}">Region</th><th style="${THR}">Completed</th><th style="${THR}">Attempts</th><th style="${THR}">Conv</th>`)}<tbody>${r.dealers.length ? zebra(r.dealers.map(d => `<td style="${TD}">${esc(d.name)}</td><td style="${TD}">${esc(d.region)}</td><td style="${TDR}">${d.completed}</td><td style="${TDR}">${d.total}</td>${convCell(d.completed, d.total)}`)) : emptyRow(5, 'No dealer activity.')}</tbody></table>`)}`;
  const consentR = rate(r.qr.consentYes, r.qr.consentTotal);
  const qrBlock = `${sectionTitle('QR / e-purchase')}${tableCard(`${tableOpen()}<tbody><tr style="background:${PANEL_BG};"><td style="${TD}">Total QR orders</td><td style="${TDR}font-weight:bold;">${r.qr.totalQrOrders}</td></tr><tr style="background:${ZEBRA_BG};"><td style="${TD}">Consent rate</td><td style="${TDR}font-weight:bold;">${pctR(consentR)} (${r.qr.consentYes}/${r.qr.consentTotal})</td></tr></tbody></table>`)}
    ${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Referral code</th><th style="${THR}">Orders</th><th style="${THR}">Completed</th>`)}<tbody>${r.qr.topReferrals.length ? zebra(r.qr.topReferrals.map(x => `<td style="${TD}">${esc(x.code)}</td><td style="${TDR}">${x.orders}</td><td style="${TDR}">${x.completed}</td>`)) : emptyRow(3, 'No QR orders.')}</tbody></table>`)}`;
  const nafR = rate(r.nafath.failed, r.nafath.total), manR = rate(r.manafith.denied, r.manafith.total);
  const healthBlock = `${sectionTitle('Integration health')}${tableCard(`${tableOpen()}<tbody>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Nafath (5G) — attempts w/ outcome</td><td style="${TDR}">${r.nafath.total}</td></tr>
      <tr style="background:${ZEBRA_BG};"><td style="${TD}">Nafath failure rate</td><td style="${TDR}font-weight:bold;color:${colorBad(nafR, 0.1, 0.3)};">${pctR(nafR)} (${r.nafath.failed})</td></tr>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Nafath by outcome</td><td style="${TD}color:${TEXT_MUTED};text-align:right;">${r.nafath.byOutcome.length ? r.nafath.byOutcome.map(o => `${esc(o.outcome)}=${o.count}`).join(', ') : '—'}</td></tr>
      <tr style="background:${ZEBRA_BG};"><td style="${TD}">Manafith — validations</td><td style="${TDR}">${r.manafith.total}</td></tr>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Manafith DENIED rate</td><td style="${TDR}font-weight:bold;color:${colorBad(manR, 0.1, 0.2)};">${pctR(manR)} (${r.manafith.denied})</td></tr></tbody></table>`)}`;
  const errBlock = `${sectionTitle('Open errors by category')}${tableCard(`${tableOpen()}${theadRow(`<th style="${TH}">Category</th><th style="${THR}">Events</th><th style="${THR}">Open</th><th style="${THR}">Last (KSA)</th>`)}<tbody>${r.errors.length ? zebra(r.errors.map(e => `<td style="${TD}">${esc(e.category)}</td><td style="${TDR}">${e.n}</td><td style="${TDR}font-weight:bold;color:${e.open > 0 ? RED : GREEN};">${e.open}</td><td style="${TDR}color:${TEXT_MUTED};">${e.lastAt ? esc(fmtStamp(new Date(e.lastAt))) : '—'}</td>`)) : emptyRow(4, 'No error events in the window.')}</tbody></table>`)}<p style="font-size:11px;color:${TEXT_MUTED};margin:-6px 0 14px;">error_events · taxonomy from the Error Control Board · "open" = not yet resolved.</p>`;
  const geoR = rate(q.withGeo, q.total), unkR = rate(q.unknownWorkflow, q.total), missR = rate(q.completedMissingOrderNo, q.completedTotal), qrGeoR = rate(q.qrWithGeo, q.qrTotal);
  const qualityBlock = `${sectionTitle('Data quality / monitoring')}${tableCard(`${tableOpen()}<tbody>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Attempts with geo</td><td style="${TDR}font-weight:bold;color:${colorGood(geoR, 0.5, 0.8)};">${pctR(geoR)} (${q.withGeo}/${q.total})</td></tr>
      <tr style="background:${ZEBRA_BG};"><td style="${TD}">Unknown workflow</td><td style="${TDR}font-weight:bold;color:${colorBad(unkR, 0.05, 0.2)};">${pctR(unkR)} (${q.unknownWorkflow})</td></tr>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Completed missing orderNumber</td><td style="${TDR}font-weight:bold;color:${colorBad(missR, 0.05, 0.2)};">${q.completedMissingOrderNo} (${pctR(missR)} of completed)</td></tr>
      <tr style="background:${ZEBRA_BG};"><td style="${TD}">QR geo coverage</td><td style="${TDR}font-weight:bold;color:${colorGood(qrGeoR, 0.5, 0.8)};">${pctR(qrGeoR)} (${q.qrWithGeo}/${q.qrTotal})</td></tr>
      <tr style="background:${PANEL_BG};"><td style="${TD}">Pins outside KSA</td><td style="${TDR}font-weight:bold;color:${q.pinsOutsideKsa > 0 ? AMBER : GREEN};">${q.pinsOutsideKsa}</td></tr></tbody></table>`)}`;
  const mapBlock = buildMapBlock(r.mapPoints, windowHours, (process.env.STATIC_MAPS_KEY || '').trim());
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>Salam Operations Console — Activity Digest</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${FONT};color:${TEXT_DARK};">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PAGE_BG};border-collapse:collapse;font-family:${FONT};"><tr><td align="center" style="padding:24px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="760" style="width:760px;max-width:100%;background:${PANEL_BG};border:1px solid ${PANEL_BORDER};border-radius:18px;border-collapse:separate;overflow:hidden;box-shadow:0 6px 20px rgba(11,61,42,0.08);font-family:${FONT};">
<tr><td style="background:${BRAND_DEEP};background:linear-gradient(135deg,${BRAND_DEEP} 0%,${BRAND_MID} 100%);padding:26px 28px;border-bottom:3px solid ${BRAND_LIME};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>
    <td width="170" valign="middle" style="padding:0 14px 0 0;line-height:0;"><img src="${LOGO}" alt="Salam" height="40" style="height:40px;display:block;"></td>
    <td valign="middle" align="right"><div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.2;font-family:${FONT};">Activity Digest</div>
      <div style="font-size:12px;color:${MINT_TEXT};margin-top:5px;line-height:1.4;">${fmtStamp(windowStart)} &rarr; ${fmtStamp(now)} KSA (last ${windowHours}h)</div>
      <div style="font-size:11px;color:${MINT_TEXT};line-height:1.4;">Generated ${fmtStamp(now)} KSA · Fixed / Salam Home · unified console</div></td></tr></table></td></tr>
<tr><td style="padding:24px 28px;">${overviewBlock}${sectionTitle('Trends')}${trendChart}${planChart}${channelBlock}${hoursBlock}${wfBlock}${regionBlock}${dealerBlock}${qrBlock}${healthBlock}${errBlock}${qualityBlock}${mapBlock}
  <div style="border-top:1px solid ${ROW_BORDER};margin:22px 0 0;padding:14px 0 0;"><p style="font-size:11px;color:${TEXT_MUTED};margin:0;line-height:1.5;">Salam Operations Console &middot; automated monitoring digest &middot; generated ${fmtStamp(now)} &middot; <a href="${esc(consoleUrl)}" style="color:#0a7d3c;">open the console</a></p></div>
</td></tr></table></td></tr></table></body></html>`;
}

async function renderReportHtml(db, q = {}) {
  if (!db.ops) throw notConfigured();
  const hours = Number(q.window) === 168 ? 168 : Number(q.window) > 0 && Number(q.window) <= 720 ? Math.round(Number(q.window)) : 24;
  const now = new Date(), windowStart = new Date(now.getTime() - hours * 3600e3);
  const report = await buildReport(db, windowStart, now);
  const consoleUrl = (process.env.CONSOLE_PUBLIC_URL || 'https://salam.sa/unified-console').replace(/\/$/, '') + '/#fixed';
  return { window: { hours, from: windowStart, to: now }, html: buildHtml(report, windowStart, now, hours, consoleUrl) };
}

function mount(app, deps) {
  const { gate, wrap, audit, db } = deps;
  app.get('/api/fixed/report/html', gate, async (req, res) => {
    try {
      const q = req.query || {};
      const out = await renderReportHtml(db, q);
      if (audit) audit(req, 'fixed.report', `${out.window.hours}h`, { format: q.format || 'json' });
      if (q.format === 'raw') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(out.html); }
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  void wrap;
}

module.exports = { mount, renderReportHtml, buildReport, svgLineChart, svgBarChart, svgDonutChart };
