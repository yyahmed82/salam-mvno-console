/* Anomaly detection — moves alerting beyond static thresholds to a seasonal baseline.
 *
 * For each journey we learn an hour-of-week profile (168 buckets, KSA) from the
 * hourly rollups over the last N weeks, using MEDIAN + MAD (median absolute
 * deviation) so a few bad hours don't poison the baseline. The current hour is
 * scored with a robust z-score:  z = 0.6745 * (x − median) / MAD.
 *
 * Two signals per journey:
 *   failure_rate — a spike in fail/(ok+fail) above its seasonal norm (bad = high)
 *   volume       — total events far from the seasonal norm (a DROP often means an
 *                  upstream outage; a SPIKE can mean a retry storm)
 *
 * Detection is read-only by default (feeds the Anomalies panel + /api/anomalies).
 * When cfg.raiseAlerts is on, strong anomalies open real incidents so they flow
 * through the existing lifecycle (ack/assign), ChatOps and on-call escalation.
 */
const db = require('./db');
const settings = require('./settings');

const DEFAULTS = { enabled: true, z: 3.5, minSample: 30, lookbackWeeks: 4, raiseAlerts: false, gatewayAlerts: true,
  // volume-anomaly severity floor: when the seasonal norm for the hour is below this many
  // events/hr, a drop/spike is capped to P3 (watch-only, no page) — stops quiet KSA
  // early-morning lulls from opening P1/P2 volume incidents.
  volFloor: 60 };
const C = db.console;
const JOURNEYS = ['payment', 'activation', 'semati', 'nafath', 'eligibility', 'delivery', 'change_plan', 'onboarding', 'checkout'];
const RATE_JOURNEYS = new Set(['payment', 'activation', 'semati', 'nafath', 'eligibility', 'delivery', 'change_plan']); // have ok/fail

async function getConfig() { return { ...DEFAULTS, ...((await settings.getSetting('anomaly')) || {}) }; }
async function setConfig(patch) {
  const next = { ...(await getConfig()), ...(patch || {}) };
  next.z = Math.max(1.5, Number(next.z) || 3.5);
  next.minSample = Math.max(1, Number(next.minSample) || 30);
  next.lookbackWeeks = Math.min(12, Math.max(1, Number(next.lookbackWeeks) || 4));
  next.volFloor = Math.max(0, Number(next.volFloor) || 0);
  await settings.setSetting('anomaly', next);
  return next;
}
async function seedDefaults() { if (!(await settings.getSetting('anomaly'))) await settings.setSetting('anomaly', DEFAULTS); return true; }

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = (a, med) => { if (!a.length) return null; return median(a.map(x => Math.abs(x - med))); };
// KSA (UTC+3) hour-of-week bucket 0..167
const howKsa = iso => { const d = new Date(new Date(iso).getTime() + 3 * 3600e3); return ((d.getUTCDay() * 24) + d.getUTCHours()); };

// Build per-hour series for a journey over the lookback window.
async function hourSeries(journey, fromIso, toIso) {
  const rows = (await C.query(
    `SELECT hour,
            sum(cnt) FILTER (WHERE outcome='fail')::bigint AS fail,
            sum(cnt) FILTER (WHERE outcome IN ('ok','fail'))::bigint AS den,
            sum(cnt)::bigint AS total
       FROM rollup_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3
      GROUP BY hour ORDER BY hour`, [journey, fromIso, toIso])).rows;
  return rows.map(r => ({ hour: r.hour, fail: Number(r.fail || 0), den: Number(r.den || 0), total: Number(r.total || 0) }));
}

function scoreOne(x, arr, z) {
  if (arr.length < 3) return null;                 // not enough history for this hour-of-week
  const med = median(arr); let m = mad(arr, med);
  if (m == null) return null;
  if (m === 0) m = med === 0 ? 0 : Math.max(1e-9, med * 0.05); // floor so a flat baseline can still flag a jump
  if (m === 0) return null;
  const score = 0.6745 * (x - med) / m;
  const half = (z * m) / 0.6745;
  return { median: med, score, low: med - half, high: med + half };
}

/* Scan all journeys at `now`. Returns { now, anomalies:[...] } (read-only). */
async function scan(nowIso, cfgIn) {
  const cfg = cfgIn || await getConfig();
  const now = nowIso || new Date().toISOString();
  const fromIso = new Date(new Date(now).getTime() - cfg.lookbackWeeks * 7 * 86400e3).toISOString();
  const toIso = new Date(new Date(now).getTime() + 3600e3).toISOString();  // include the current hour bucket
  // start of the current KSA/UTC hour — anything at/after this is the partial in-progress bucket
  const nowHr = (() => { const d = new Date(now); d.setUTCMinutes(0, 0, 0, 0); return +d; })();
  const anomalies = [];
  for (const journey of JOURNEYS) {
    let series; try { series = await hourSeries(journey, fromIso, toIso); } catch (e) { continue; }
    if (series.length < 24) continue;
    const latest = series[series.length - 1];            // most recent bucket ≤ now (may be the partial current hour)
    const how = howKsa(latest.hour);
    const sameHow = series.slice(0, -1).filter(s => howKsa(s.hour) === how);   // history for this hour-of-week

    // failure-rate spike — a ratio is meaningful even mid-hour (gated by den ≥ minSample), so use the latest bucket
    if (RATE_JOURNEYS.has(journey) && latest.den >= cfg.minSample) {
      const cur = latest.fail / latest.den;
      const hist = sameHow.filter(s => s.den >= Math.min(cfg.minSample, 5)).map(s => s.fail / s.den);
      const r = scoreOne(cur, hist, cfg.z);
      if (r && r.score >= cfg.z) anomalies.push(mk(journey, 'failure_rate', cur, r, latest, 'rate', cfg));
    }
    // volume deviation (drop or spike) — score the last COMPLETE hour only. The partial current-hour
    // bucket always looks low mid-hour (e.g. 40 min in ≈ 2/3 of the norm) and used to fire phantom
    // "volume drop" P1s every morning; excluding it (like scanGateways does) removes that artifact.
    {
      const complete = series.filter(s => +new Date(s.hour) < nowHr);
      const lc = complete[complete.length - 1];
      if (lc) {
        const cHow = howKsa(lc.hour);
        const hist = complete.slice(0, -1).filter(s => howKsa(s.hour) === cHow).map(s => s.total);
        const r = scoreOne(lc.total, hist, cfg.z);
        if (r && Math.abs(r.score) >= cfg.z && (lc.total >= cfg.minSample || r.median >= cfg.minSample)) {
          anomalies.push(mk(journey, 'volume', lc.total, r, lc, 'count', cfg));
        }
      }
    }
  }
  // strongest first
  anomalies.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return { now, anomalies };
}

function mk(journey, kind, actual, r, latest, unit, cfg) {
  const dir = r.score >= 0 ? 'up' : 'down';
  let sev = Math.abs(r.score) >= 6 ? 'P1' : Math.abs(r.score) >= 4.5 ? 'P2' : 'P3';
  // low-volume floor: don't page on a deviation whose seasonal norm is tiny (quiet hours) — cap to P3
  if (kind === 'volume' && cfg && cfg.volFloor && r.median < cfg.volFloor) sev = 'P3';
  return {
    journey, kind, unit, direction: dir, actual,
    expected: r.median, low: Math.max(0, r.low), high: r.high, score: Number(r.score.toFixed(2)),
    sample: unit === 'rate' ? latest.den : latest.total, at: latest.hour, severity: sev
  };
}

const fmt = (v, unit) => unit === 'rate' ? (v * 100).toFixed(1) + '%' : Math.round(v).toLocaleString();
function describe(a) {
  const d = a.direction === 'up' ? 'above' : 'below';
  return `${a.journey} ${a.kind.replace('_', ' ')} ${fmt(a.actual, a.unit)} is ${Math.abs(a.score).toFixed(1)}σ ${d} the seasonal norm ${fmt(a.expected, a.unit)} (expected ${fmt(a.low, a.unit)}–${fmt(a.high, a.unit)})`;
}

/* ---- per-GATEWAY drop detector ----
 * Catches "UPG/salam is down" even when OVERALL payment success stays healthy because traffic
 * fails over to another gateway (e.g. HyperPay) — the exact blind spot in INC000003202277,
 * where L1 noticed at 09:43 though the last UPG success was 09:09. Aggregate alerts stay silent;
 * this watches each gateway's own volume vs its seasonal norm. */
async function vendorSeries(journey, vendor, fromIso, toIso) {
  const rows = (await C.query(
    `SELECT hour, sum(cnt)::bigint total FROM rollup_vendor_hourly
      WHERE journey=$1 AND vendor=$2 AND hour >= $3 AND hour < $4 GROUP BY hour ORDER BY hour`, [journey, vendor, fromIso, toIso])).rows;
  return rows.map(r => ({ hour: r.hour, total: Number(r.total || 0) }));
}
async function listVendors(journey, fromIso, toIso) {
  const r = await C.query(`SELECT DISTINCT vendor FROM rollup_vendor_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3 AND vendor <> ''`, [journey, fromIso, toIso]);
  return r.rows.map(x => x.vendor);
}
async function scanGateways(nowIso, cfgIn) {
  const cfg = cfgIn || await getConfig();
  const now = nowIso || new Date().toISOString();
  const fromIso = new Date(new Date(now).getTime() - cfg.lookbackWeeks * 7 * 86400e3).toISOString();
  const toIso = new Date(new Date(now).getTime() + 3600e3).toISOString();
  const nowHr = (() => { const d = new Date(now); d.setUTCMinutes(0, 0, 0, 0); return +d; })();
  const drops = [];
  for (const journey of ['payment', 'delivery']) {          // payment gateways + couriers
    let vendors; try { vendors = await listVendors(journey, fromIso, now); } catch (e) { continue; }
    for (const vendor of vendors) {
      let series; try { series = await vendorSeries(journey, vendor, fromIso, toIso); } catch (e) { continue; }
      const complete = series.filter(s => +new Date(s.hour) < nowHr);   // ignore the partial current hour
      if (complete.length < 24) continue;
      const latest = complete[complete.length - 1];
      const how = howKsa(latest.hour);
      const hist = complete.slice(0, -1).filter(s => howKsa(s.hour) === how).map(s => s.total);
      const r = scoreOne(latest.total, hist, cfg.z);
      if (r && r.median >= cfg.minSample && r.score <= -cfg.z) {          // volume well BELOW its seasonal norm = drop
        const ratio = r.median > 0 ? latest.total / r.median : 0;
        drops.push({ journey, vendor, actual: latest.total, expected: r.median, score: Number(r.score.toFixed(2)),
          severity: (latest.total === 0 || ratio < 0.1) ? 'P1' : 'P2', at: latest.hour });
      }
    }
  }
  return drops;
}
const GW_LABEL = { payment: 'payment gateway', delivery: 'courier' };
// friendly vendor names — the Salam in-house payment gateway is "UPG"
const VENDOR_LABEL = { salam: 'UPG (salam)', apollo: 'Apollo', hyperpay: 'HyperPay', tap: 'Tap' };
const vlabel = v => VENDOR_LABEL[String(v || '').toLowerCase()] || v;
function describeGateway(g) {
  return `${vlabel(g.vendor)} ${GW_LABEL[g.journey] || g.journey} volume ${Math.round(g.actual)}/hr is ${Math.abs(g.score).toFixed(1)}σ below its seasonal norm ${Math.round(g.expected)}/hr — likely down or failing over`;
}

/* Open/refresh/resolve anomaly incidents so they flow through the normal pipeline.
 * Only runs when cfg.raiseAlerts. rule_key = anomaly:<journey>:<kind> or gateway:<journey>:<vendor>. */
async function detectAndRaise(nowIso, cfgIn) {
  const cfg = cfgIn || await getConfig();
  if (!cfg.enabled || !cfg.raiseAlerts) return { opened: 0, resolved: 0, scanned: 0 };
  const now = nowIso || new Date().toISOString();
  const { anomalies } = await scan(now, cfg);
  const active = new Map(anomalies.map(a => [`anomaly:${a.journey}:${a.kind}`, a]));
  // per-gateway drops (payment gateways / couriers) → gateway:<journey>:<vendor>
  if (cfg.gatewayAlerts !== false) { const gw = await scanGateways(now, cfg); for (const g of gw) active.set(`gateway:${g.journey}:${g.vendor}`, { ...g, _gw: true }); }
  let opened = 0, resolved = 0;

  // resolve anomaly/gateway alerts that no longer trip
  const open = (await C.query(`SELECT id, rule_key FROM alerts WHERE status='open' AND (rule_key LIKE 'anomaly:%' OR rule_key LIKE 'gateway:%')`)).rows;
  for (const row of open) if (!active.has(row.rule_key)) { await C.query(`UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [row.id, now]); resolved++; }

  for (const [key, a] of active) {
    const isGw = !!a._gw;
    const msg = isGw ? describeGateway(a) : describe(a);
    const cur = (await C.query(`SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
    if (cur) { await C.query(`UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1 WHERE id=$1`, [cur.id, now, a.actual, msg]); }
    else {
      const name = isGw ? `Gateway down · ${vlabel(a.vendor)}` : `Anomaly · ${a.journey} ${a.kind.replace('_', ' ')}`;
      const metric = isGw ? `gateway.${a.journey}.${a.vendor}` : `anomaly.${a.journey}.${a.kind}`;
      const dim = isGw ? { journey: a.journey, vendor: a.vendor, kind: 'gateway_drop' } : { journey: a.journey, kind: a.kind };
      await C.query(
        `INSERT INTO alerts (rule_key, name, severity, team, status, metric_key, operator, threshold,
           observed_value, sample, window_hours, dim, message, fired_at, last_seen_at, peak_value, breach_count)
         VALUES ($1,$2,$3,$4,'open',$5,'anomaly',$6,$7,$8,1,$9,$10,$11,$11,$7,1)`,
        [key, name, a.severity, 'Digital Ops', metric, a.expected, a.actual, (a.sample != null ? a.sample : a.actual), JSON.stringify(dim), msg, now]);
      opened++;
    }
  }
  return { opened, resolved, scanned: active.size };
}

module.exports = { scan, scanGateways, detectAndRaise, getConfig, setConfig, seedDefaults, describe, describeGateway, DEFAULTS };
