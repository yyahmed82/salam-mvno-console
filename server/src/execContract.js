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
 *   alerts:[{severity,name,text,team,at,href,status}]
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
module.exports = { n, pct, delta, dayKey, dayAxis, trendOf, sevOf, rangeOf, statusOf, humanStep };
