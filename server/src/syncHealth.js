/* Sync Health report — mirrors the dealers "Sync Health" email.
 * Checks how far the console watcher is behind the source replica, today's volume,
 * and per-KSA-day coverage (nexus = source orders, ops = orders the watcher has already
 * covered, i.e. created_at <= last sync cursor). Emailed to users with mail_report on. */
const db = require('./db');
const notify = require('./notify');
const errors = require('./errors');

const esc = notify.esc;
const KSA = 'Asia/Riyadh';
const ksaDate = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: KSA }); } catch (e) { return String(iso).slice(0, 10); } };
const behindLabel = s => s == null ? '—' : (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);

async function compute(refIso) {
  const S = db.source, C = db.console;
  const refI = (refIso ? new Date(refIso) : new Date()).toISOString();

  // last console sync cursor (how current the console metrics are)
  let lastSimNow = null;
  try { const m = (await C.query(`SELECT max(sim_now) m FROM sync_runs`)).rows[0].m; lastSimNow = m ? new Date(m).toISOString() : null; } catch (e) {}
  // latest order in the source replica
  let sourceLatest = null;
  try { const m = (await S.query(`SELECT max(created_at) m FROM onboarding_orders`)).rows[0].m; sourceLatest = m ? new Date(m).toISOString() : null; } catch (e) {}
  const behindSec = (sourceLatest && lastSimNow) ? Math.max(0, Math.round((new Date(sourceLatest) - new Date(lastSimNow)) / 1000)) : null;

  // coverage by KSA day (last 4). ops = covered by the watcher's cursor.
  const cutoff = lastSimNow || refI;
  let cov = [];
  try {
    cov = (await S.query(
      `SELECT to_char((created_at AT TIME ZONE $3)::date,'YYYY-MM-DD') AS ksa_day,
              count(*)::int AS nexus,
              count(*) FILTER (WHERE created_at <= $2::timestamptz)::int AS ops
       FROM onboarding_orders
       WHERE created_at >= $1::timestamptz - interval '4 days' AND created_at < $1::timestamptz
       GROUP BY 1 ORDER BY 1 DESC LIMIT 4`, [refI, cutoff, KSA])).rows;
  } catch (e) {}
  cov.forEach(r => { r.gap = r.nexus - r.ops; r.pct = r.nexus ? Math.round(100 * r.ops / r.nexus) : 100; });

  const ordersToday = cov.length ? cov[0].nexus : 0;

  // errors today (KSA) — sum the live error board over hours since KSA midnight
  let errorsToday = null;
  try {
    const ksaNow = new Date(new Date(refI).getTime() + 3 * 3600e3);
    const hrs = Math.max(1, Math.ceil(ksaNow.getUTCHours() + ksaNow.getUTCMinutes() / 60 + 0.02));
    const sum = await errors.summary({ now: refI, windowHours: hrs });
    errorsToday = sum.reduce((a, t) => a + (t.total || 0), 0);
  } catch (e) {}

  const problems = [];
  if (lastSimNow == null) problems.push('No sync has run yet — start the watcher (Settings → Sync engine).');
  if (behindSec != null && behindSec > 2 * 3600) problems.push(`Watcher is ${behindLabel(behindSec)} behind the source replica.`);
  const status = problems.length ? 'WARN' : 'OK';

  const totalNexus = cov.reduce((a, r) => a + r.nexus, 0), totalOps = cov.reduce((a, r) => a + r.ops, 0);
  return { ref: refI, ksaDay: ksaDate(refI), status, problems, lastSimNow, sourceLatest, behindSec,
    ordersToday, errorsToday, coverage: cov,
    totals: { nexus: totalNexus, ops: totalOps, gap: totalNexus - totalOps, pct: totalNexus ? Math.round(100 * totalOps / totalNexus) : 100 } };
}

function buildEmail(d) {
  const ok = d.status === 'OK';
  const metric = (label, val) => `<tr><td style="padding:6px 0;color:#475569;font-size:13px">${label}</td><td style="padding:6px 0 6px 24px;font-weight:800;font-size:14px;color:#0f172a">${val}</td></tr>`;
  const th = 'padding:9px 12px;text-align:left;font-size:12px;color:#334155;background:#eef4f0;border-bottom:1px solid #dbe6df';
  const td = 'padding:9px 12px;font-size:13px;border-bottom:1px solid #eef2f6';
  const rows = d.coverage.map(r => `<tr>
      <td style="${td}">${esc(r.ksa_day)}</td>
      <td style="${td};text-align:right">${r.nexus.toLocaleString()}</td>
      <td style="${td};text-align:right">${r.ops.toLocaleString()}</td>
      <td style="${td};text-align:right;color:${r.gap ? '#d97706' : '#16a34a'}">${r.gap}</td>
      <td style="${td};text-align:right">${r.pct}%</td></tr>`).join('');
  const totalRow = `<tr style="background:#f6f8fa;font-weight:800">
      <td style="${td}">Total</td>
      <td style="${td};text-align:right">${d.totals.nexus.toLocaleString()}</td>
      <td style="${td};text-align:right">${d.totals.ops.toLocaleString()}</td>
      <td style="${td};text-align:right">${d.totals.gap}</td>
      <td style="${td};text-align:right">${d.totals.pct}%</td></tr>`;
  const summaryLine = ok
    ? '<div style="color:#16a34a;font-weight:600;margin-bottom:18px">All checks passed — sync is healthy.</div>'
    : `<div style="color:#b45309;font-weight:600;margin-bottom:12px">Attention needed:</div><ul style="color:#b45309;margin:0 0 18px 18px;padding:0">${d.problems.map(p => `<li style="margin:2px 0">${esc(p)}</li>`).join('')}</ul>`;

  const body = `${summaryLine}
      <table style="border-collapse:collapse;margin-bottom:22px">
        ${metric('Watcher behind source', `<b>${behindLabel(d.behindSec)}</b>`)}
        ${metric('Orders today (source)', (d.ordersToday || 0).toLocaleString())}
        ${metric('Errors today (live board)', d.errorsToday == null ? '—' : d.errorsToday.toLocaleString())}
      </table>
      <div style="color:#0f5132;font-weight:800;font-size:15px;margin-bottom:8px">Coverage — source vs console (by KSA day)</div>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe6df">
        <tr><th style="${th}">KSA day</th><th style="${th};text-align:right">nexus</th><th style="${th};text-align:right">ops</th><th style="${th};text-align:right">gap</th><th style="${th};text-align:right">ops%</th></tr>
        ${rows || `<tr><td style="${td}" colspan="5">No orders in the window.</td></tr>`}
        ${d.coverage.length ? totalRow : ''}
      </table>
      <div style="color:#94a3b8;font-size:12px;margin-top:14px">ops = orders the console watcher has already covered (created_at ≤ last sync cursor). A gap on the latest day is normal — today is partial until the watcher catches up.</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:8px">— Salam Operations Console · automated sync check</div>`;
  const html = notify.shell({ title: 'Sync Health — Operations Console', pill: d.status,
    pillColor: ok ? '#16a34a' : '#d97706', bodyHtml: body });
  const subject = `[Salam Ops] Sync health — ${d.ksaDay} — ${d.status}`;
  return { html, subject };
}

async function send(refIso) {
  const data = await compute(refIso);
  const to = await notify.recipients('mail_report');
  const { html, subject } = buildEmail(data);
  const r = await notify.sendHtml(to, subject, html);
  return { ...data, subject, previewHtml: html, sent: r.sent, dev: r.dev, error: r.error,
    recipients: r.recipients, reason: to.length ? undefined : 'No recipients — enable "Mail report" for at least one user in User management.' };
}

module.exports = { compute, buildEmail, send };
