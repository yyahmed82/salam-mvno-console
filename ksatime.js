/* KSA TIME — one formatter for the whole console.
 *
 * Every timestamp the console handles is UTC (the app, the replica, the gateway and the API
 * logs all store UTC). Operations, business and the vendors all think in Riyadh time, so a
 * screen showing "23:41" when the customer paid at 02:41 KSA is worse than useless during an
 * incident. This module is the single place that converts, and it is loaded before every other
 * view script so any file can call it.
 *
 *   KT.dt('2026-08-20T23:41:19Z')  → '2026-08-21 02:41'        (minutes)
 *   KT.dts(v)                      → '2026-08-21 02:41:19'     (seconds)
 *   KT.d(v)                        → '2026-08-21'
 *   KT.t(v)                        → '02:41'
 *   KT.md(v)                       → '21 Aug 02:41'            (compact, for chips/axes)
 *   KT.ago(v)                      → '5m ago' / 'just now'
 *   KT.label(v)                    → '2026-08-21 02:41 KSA'    (when the zone must be explicit)
 *
 * Riyadh is UTC+3 with no daylight saving, so the offset is constant — but we still go through
 * Intl with timeZone:'Asia/Riyadh' rather than adding 3h by hand, so the code stays correct if
 * that ever changes and so the browser's own timezone can never leak in.
 */
(function () {
  'use strict';
  const TZ = 'Asia/Riyadh';
  const DASH = '—';

  const toDate = v => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);   // seconds or ms
    let s = String(v).trim();
    if (!s) return null;
    // "2026-08-20 23:41:19" (Postgres style, no zone) is UTC in every one of our sources
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s))
      s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };

  const P = (d, opts) => {
    const parts = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: TZ, hour12: false }, opts))
      .formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
    return parts;
  };
  const NUM = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };

  function dts(v) {                       // 2026-08-21 02:41:19
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, NUM);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  }
  function dt(v) {                        // 2026-08-21 02:41
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, NUM);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  }
  function dOnly(v) {                     // 2026-08-21
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, NUM);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function tOnly(v, withSec) {            // 02:41[:19]
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, NUM);
    return `${p.hour}:${p.minute}` + (withSec ? `:${p.second}` : '');
  }
  function md(v) {                        // 21 Aug 02:41
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
  }
  function dmy(v) {                       // 21 Aug 2026
    const d = toDate(v); if (!d) return DASH;
    const p = P(d, { day: '2-digit', month: 'short', year: 'numeric' });
    return `${p.day} ${p.month} ${p.year}`;
  }
  function ago(v) {
    const d = toDate(v); if (!d) return DASH;
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 0) return 'in ' + human(-s);
    if (s < 45) return 'just now';
    return human(s) + ' ago';
  }
  function human(s) {
    if (s < 90) return Math.round(s) + 's';
    const m = Math.round(s / 60); if (m < 90) return m + 'm';
    const h = Math.round(m / 60); if (h < 36) return h + 'h';
    return Math.round(h / 24) + 'd';
  }
  const label = v => { const x = dt(v); return x === DASH ? x : x + ' KSA'; };
  // hour-of-day / day-of-week in KSA, for bucketing and axes
  const hour = v => { const d = toDate(v); return d ? Number(P(d, NUM).hour) : null; };
  const dayKey = v => dOnly(v);

  window.KT = { tz: TZ, toDate, dt, dts, d: dOnly, t: tOnly, md, dmy, ago, label, hour, dayKey, DASH };
  // convenience aliases so existing code reads naturally
  window.ksaDT = dt; window.ksaDTS = dts; window.ksaAgo = ago; window.ksaLabel = label;
})();
