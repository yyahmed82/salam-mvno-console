/* Plan catalog: id / optiva_reference → "ID - Name (EN / AR)".
 * plans.title is a jsonb {"en": "...", "ar": "..."}. Cached 5 min (plans rarely change).
 * onboarding_orders.plan_id is the numeric plans.id; change_plan_logs.from_plan/to_plan
 * are optiva_reference strings — so we index the lookup by BOTH id and reference. */
const db = require('./db');

let _cache = null, _ts = 0;
const TTL = 5 * 60 * 1000;

function nameOf(title) {
  let t = title || {};
  // jsonb normally arrives parsed, but if a driver/config ever returns it as a JSON string, parse it
  // so plan names still resolve (otherwise 'string'.en === undefined → every label degrades to a raw id)
  if (typeof t === 'string') { try { t = JSON.parse(t); } catch (_) { t = {}; } }
  const en = t.en || t.EN || t.english || '';
  const ar = t.ar || t.AR || t.arabic || '';
  return { en, ar };
}

async function loadMap() {
  if (_cache && Date.now() - _ts < TTL) return _cache;
  const byKey = {};
  try {
    const r = await db.source.query(`SELECT id, optiva_reference, plan_type, price, title FROM plans`);
    for (const p of r.rows) {
      const { en, ar } = nameOf(p.title);
      const rec = { id: p.id, ref: p.optiva_reference, en, ar, plan_type: p.plan_type, price: p.price };
      byKey['id:' + p.id] = rec;
      if (p.optiva_reference != null) byKey['ref:' + p.optiva_reference] = rec;
    }
  } catch (e) { /* plans table missing / no perms — labels degrade to raw id */ }
  _cache = { byKey }; _ts = Date.now();
  return _cache;
}

// look up a raw plan value (id or optiva_reference) against a preloaded map
function lookup(map, value) {
  if (value == null || value === '') return null;
  const m = (map && map.byKey) || {};
  return m['id:' + value] || m['ref:' + value] || m['id:' + String(value)] || m['ref:' + String(value)] || null;
}

// "122 - Salam 55 (EN) / سلام ٥٥ (AR)"  →  we keep it compact: "122 - Salam 55 / سلام ٥٥"
function label(map, value) {
  if (value == null || value === '') return value;
  const rec = lookup(map, value);
  if (!rec) return String(value);
  const nm = [rec.en, rec.ar].filter(Boolean).join(' / ');
  return nm ? `${value} - ${nm}` : String(value);
}

async function list() {
  const map = await loadMap();
  const seen = new Set(), out = [];
  for (const rec of Object.values(map.byKey)) { if (seen.has(rec.id)) continue; seen.add(rec.id); out.push(rec); }
  return out.sort((a, b) => a.id - b.id);
}

module.exports = { loadMap, lookup, label, list };
