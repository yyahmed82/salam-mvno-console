/* execContract.js — the ONE shape every Executive / Operations page reads (12 Sep 2026)
 *
 * fixedExec.js and mvnoExec.js each produce it for their business; execUnified.js merges two of them.
 * The front end (execops.js) renders the shape and knows nothing about either business. Keep this file
 * boring: helpers + the documented contract, no queries.
 *
 * {
 *   configured, biz:'fixed'|'mobile', label, generatedAt, range:'7d'|'30d', days:N, window:{from,to},
 *   source, freshness:{text, stale}, provisional,
 *   status:'CRITICAL'|'WARNING'|'HEALTHY', summary:[string], counts:{critical,warnings,alerts24,bySeverity},
 *   kpis:[{key,title,value,sub,tone,delta:{pct,good}|null,href,exec,window}],
 *   slos:[{key,name,actual,target,ok,measured,note,href}],
 *   health:[{label,value,state:'up'|'down'|'warn'|'nowire',sub,href}],
 *   series:{days:[{day,...}], charts:[{key,title,type:'line'|'bar',field,color,threshold,thresholdLabel,exec}]},
 *   pipeline:{title,sub,rows:[{step,label,n,share,tone}],href},
 *   issues:[{category,label,open,total,first_seen,daysOngoing,trend,spark,sev,href}],
 *   alerts:[{severity,name,text,team,at,href,status}],
 *   radar:{unit:'hour', hours:12, from:<iso>, slots:['YYYY-MM-DDTHH' KSA clock hour, oldest first],
 *          cells:[{slot, sev, n:<distinct RULES that fired in that hour>, open:<of those, still breaching now>,
 *                  older:<still-open rules fired BEFORE the window, pinned into the oldest slot>,
 *                  firings:<raw event rows>, rules:[name]}],
 *          sev:{P1:{rules,open,firings},…}, rules, open, firings, total}
 *     A 12-hour CLOCK (16 Sep 2026): sector = KSA clock hour, one sweep = the last 12 h. Open
 *     incidents are always on the face whenever they fired. Rows come from execRadar.radarRows(seg).
 *     n / rules are DISTINCT RULE COUNTS, never raw firings: one noisy rule re-firing every
 *     evaluation used to read as ~900 'alerts' in 7 d, which made the board look like noise.
 * } */
const n = v => Number(v) || 0;
const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
const delta = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0);
const dayKey = d => new Date(new Date(d).getTime() + 3 * 3600e3).toISOString().slice(0, 10);   // KSA calendar day
const dayAxis = (now, days) => { const out = []; for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * 864e5)); return out; };
const trendOf = series => {              // last 2 days vs the 2 before: improving / worsening / stable
  const v = series.slice(-4); if (v.length < 4) return 'stable';
  const a = (v[0] + v[1]) / 2, b = (v[2] + v[3]) / 2; if (a === 0 && b === 0) return 'stable';
  const d = (b - a) / Math.max(a, 1); return d <= -0.2 ? 'improving' : d >= 0.2 ? 'worsening' : 'stable';
};
const sevOf = open => open >= 100 ? 'critical' : open >= 20 ? 'warning' : 'info';
const rangeOf = q => q && q.range === '30d' ? '30d' : '7d';
const statusOf = (critical, warnings) => critical > 0 ? 'CRITICAL' : warnings > 0 ? 'WARNING' : 'HEALTHY';
const humanStep = s => String(s || '').replace(/^(ePurchase|salamHome)/, (m) => m === 'ePurchase' ? 'E-purchase · ' : 'Salam Home · ').replace(/([a-z])([A-Z])/g, '$1 $2');
const SEVS = ['P1', 'P2', 'P3', 'P4'];
/* rows:   {slot, severity, n, open, older, firings, rules[]}  — one per KSA clock hour x severity
 * totals: {severity, rules, open, firings}                   — one per severity for the WHOLE face
 * The face totals cannot be summed from the hourly rows: a rule that fires in five hours is five
 * rows but ONE rule. That is the whole point of the unit change, so they are queried apart. */
const radarOf = ({ slots, rows, totals, from, hours }) => {
  const cells = [];
  for (const slot of slots) for (const sev of SEVS) {
    const hit = rows.find(r => r.slot === slot && r.severity === sev);
    if (!hit) continue;
    const n = Number(hit.n) || 0; if (!n) continue;
    cells.push({ slot, sev, n,
      open: Math.min(n, Number(hit.open) || 0),
      older: Math.min(n, Number(hit.older) || 0),
      firings: Number(hit.firings) || 0,
      rules: Array.isArray(hit.rules) ? hit.rules.filter(Boolean).map(String).slice(0, 4) : [] });
  }
  const by = {}; for (const t of (totals || [])) if (t && t.severity) by[t.severity] = t;
  const sev = {}; let rules = 0, open = 0, firings = 0;
  for (const s of SEVS) {
    const t = by[s]; if (!t) continue;
    const e = { rules: Number(t.rules) || 0, open: Number(t.open) || 0, firings: Number(t.firings) || 0 };
    if (!e.rules && !e.firings) continue;
    e.open = Math.min(e.rules, e.open);
    sev[s] = e; rules += e.rules; open += e.open; firings += e.firings;
  }
  return { unit: 'hour', hours, from, slots, cells, sev, rules, open, firings, total: rules };
};
module.exports = { SEVS, radarOf, n, pct, delta, dayKey, dayAxis, trendOf, sevOf, rangeOf, statusOf, humanStep };
