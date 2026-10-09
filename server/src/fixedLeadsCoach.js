/* fixedLeadsCoach.js — Agent 2 as the OCU team's sales coach (Fixed › Leads, 9 Oct 2026).
 *
 * Runs inside salam-agent-incident (Agent 2's process), every AGENT_LEADS_INTERVAL_MIN (10) minutes, and on demand from a
 * lead ("Ask Agent 2", console process). For every open lead that is new or has changed since its last advice it writes:
 *   score 0–100 · hot / warm / cold · the offer path (OCU MSD ladder: standard plans first, then the shortest discount)
 *   · an opener in Arabic and in English · three talking points · the likely objections with an answer · the best time to
 *   call · the next action · why.
 * RULES FIRST: a deterministic reading (reason of the stop, recency, the person's Salam relationship, how similar leads
 * ended, the hours customers answer) is always computed and is the answer when the model is down or over budget; the
 * model rewrites it with the history in view and is checked against the catalogue (unknown offer codes, a discount for
 * 5G, a discount before the standard plans, wrong months → replaced by the rules).
 * PRIVACY: the prompt carries no name, number or id — the lead's facts and the team's aggregates only.
 * Every morning (AGENT_LEADS_BRIEF_HOUR, 8 KSA) it writes the team brief (agent_reports kind 'leads-brief'). Runs are
 * agent_runs 'leads' — the Leads lane on #agents-live. */
'use strict';
const crypto = require('crypto');
const S = require('./fixedLeadsStore');

const C = S.C;
const log = (...a) => console.log('[AGENT-LEADS]', ...a);
const CFG = {
  enabled: process.env.AGENT_LEADS_ENABLED !== '0',
  intervalMin: Math.max(2, Number(process.env.AGENT_LEADS_INTERVAL_MIN) || 10),
  maxPerTick: Math.max(1, Number(process.env.AGENT_LEADS_MAX_PER_TICK) || 150),   // rules are cheap: a first harvest of a month of stopped journeys is scored in a few ticks
  /* leads never scored on top of that, by the rules only — a catch-up of thousands is scored in a few ticks, not hours (alpha.170) */
  backlogPerTick: Math.max(0, Number(process.env.AGENT_LEADS_BACKLOG_PER_TICK ?? 850)),
  maxModelPerTick: Math.max(0, Number(process.env.AGENT_LEADS_MAX_MODEL_PER_TICK ?? 6)),
  briefHour: Number.isFinite(Number(process.env.AGENT_LEADS_BRIEF_HOUR)) ? Number(process.env.AGENT_LEADS_BRIEF_HOUR) : 8,
};
const CALLER = 'salam-agent-incident';

/* ------------------------------------------------------------------ what the team's history says (cached 10 min) */
let histCache = { at: 0, v: null };
async function history() {
  if (histCache.v && Date.now() - histCache.at < 600e3) return histCache.v;
  const q = async (sql, p) => { try { return (await C().query(sql, p)).rows; } catch (_) { return []; } };
  const [groups, offers, lost, hours, overall] = await Promise.all([
    q(`SELECT reason_class, product, source, count(*)::int AS n, count(*) FILTER (WHERE status='won')::int AS won FROM fixed_leads
        WHERE status = ANY($1) AND updated_at > now() - interval '120 days' GROUP BY 1,2,3`, [S.CLOSED]),
    q(`SELECT coalesce(offer_code,'STD') AS code, product, count(*)::int AS n FROM fixed_leads WHERE status='won' AND updated_at > now() - interval '120 days' GROUP BY 1,2 ORDER BY 3 DESC`),
    q(`SELECT coalesce(lost_reason,'—') AS reason, count(*)::int AS n FROM fixed_leads WHERE status='lost' AND updated_at > now() - interval '120 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
    q(`SELECT extract(hour FROM at + interval '3 hours')::int AS h, count(*)::int AS calls, count(*) FILTER (WHERE (detail->>'contact')::boolean)::int AS answered
        FROM fixed_lead_events WHERE kind='call' AND at > now() - interval '60 days' GROUP BY 1`),
    q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='won')::int AS won FROM fixed_leads WHERE status = ANY($1) AND updated_at > now() - interval '120 days'`, [S.CLOSED]),
  ]);
  const ov = overall[0] || { n: 0, won: 0 };
  const v = { groups, offers, lost, hours, overall: { n: ov.n, won: ov.won, rate: ov.n ? ov.won / ov.n : null } };
  histCache = { at: Date.now(), v }; return v;
}
function similar(h, L) {
  const g = h.groups.filter(x => x.reason_class === L.reason_class && x.product === L.product);
  const n = g.reduce((a, x) => a + x.n, 0), won = g.reduce((a, x) => a + x.won, 0);
  const src = h.groups.filter(x => x.source === L.source && x.product === L.product); const sn = src.reduce((a, x) => a + x.n, 0), sw = src.reduce((a, x) => a + x.won, 0);
  return { n, won, rate: n ? won / n : null, source: { n: sn, won: sw, rate: sn ? sw / sn : null } };
}
function bestHours(h) {
  const rows = h.hours.filter(x => x.calls >= 3).map(x => ({ h: x.h, rate: x.answered / x.calls, calls: x.calls })).sort((a, b) => b.rate - a.rate || b.calls - a.calls);
  if (!rows.length) return null;
  const top = rows.slice(0, 2).map(x => x.h).sort((a, b) => a - b);
  return { text: top.map(x => `${String(x).padStart(2, '0')}:00–${String((x + 1) % 24).padStart(2, '0')}:00`).join(' or ') + ' KSA', rate: rows[0].rate };
}

/* ------------------------------------------------------------------ the rules */
const BASE = { payment: 72, otp: 66, appointment: 62, stock: 60, price: 56, identity: 55, lead_stale: 52, campaign: 48, rejected_install: 50, lead_rejected: 45, abandoned: 42, coverage: 36, early: 30 };
/* the temperature bands — the Leads page explains them from here (meta.scoring), so the definition and the code cannot drift */
const BANDS = { hot: 70, warm: 45 };
const tempOf = score => score >= BANDS.hot ? 'hot' : score >= BANDS.warm ? 'warm' : 'cold';
const ADJUST = [
  'Recency: +15 when the customer stopped less than a day ago, +8 under 3 days, −10 after 14 days, −20 after 30.',
  'Already a Salam Mobile customer: +10. Ordered Salam fiber before (not a new acquisition): −15. An earlier lead for this person was lost: −8.',
  'Came back several times: +5 for each extra journey, up to +15.',
  '3 calls without an answer: −10. Interested, offer made or call back agreed: +12.',
  'How similar leads ended (same reason and product, last 120 days) compared with all leads: up to ±12.',
  'The score stays between 5 and 98. When Agent 2\'s model rewrites the advice it may refine the score with the team\'s history, on the same scale.',
];
function scoring() { return { bands: BANDS, base: Object.entries(BASE).sort((a, b) => b[1] - a[1]).map(([cls, points]) => ({ cls, label: S.REASON_LABEL[cls] || cls, points })), defaultBase: 45, adjust: ADJUST }; }
const PITCH = {
  payment: { en: 'You were one step from finishing your order — I can complete it with you now, it takes two minutes.', ar: 'كنت على بعد خطوة من إتمام طلبك — أقدر أكمله معك الحين، ياخذ دقيقتين بس.',
    points: ['They tried to pay: intent is high — confirm the plan and finish the order on SDA while on the call.', 'Ask whether the card step failed or they hesitated; offer to place it for them.', 'Remind them installation is booked as soon as the order is in.'] },
  otp: { en: 'It looks like the confirmation code did not reach you — let me finish your request with you now.', ar: 'يبدو أن رمز التحقق ما وصلك — خلني أكمل طلبك معك الحين.',
    points: ['They reached the very last step — the order was almost placed.', 'Confirm the mobile number on the order is the one they use.', 'Place the order on SDA during the call.'] },
  appointment: { en: 'We have new installation slots, including evenings and weekends — which day suits you?', ar: 'عندنا مواعيد تركيب جديدة، تشمل المساء ونهاية الأسبوع — أي يوم يناسبك؟',
    points: ['The stop was the installation slot, not the product.', 'Offer evening and weekend slots first.', 'Confirm the address and the building access.'] },
  stock: { en: 'The device is available again and we can deliver it to your home — shall I book it for you?', ar: 'الجهاز متوفر الحين ونقدر نوصله لبيتك — أحجزه لك؟',
    points: ['The stop was availability, not the customer: say it is back.', 'Delivery comes to the door (Naqeel) — no shop visit.', 'Confirm the delivery address on the call.'] },
  price: { en: 'I saw you were looking at Salam Fiber — I have a special offer for you this week.', ar: 'شفت إنك كنت تطالع باقات سلام فايبر — عندي لك عرض خاص هالأسبوع.',
    points: ['They left after seeing the price — value first: speed, router included, stable fiber.', 'Pitch the standard plan; if price is the issue, move to the OCU offer ladder.', 'Ask what they pay today and compare per Mbps.'] },
  price_std: { en: 'I saw you were looking at Salam home internet — let me help you pick the plan that fits your budget.', ar: 'شفت إنك كنت تطالع باقات الإنترنت المنزلي من سلام — خلني أساعدك تختار الباقة اللي تناسب ميزانيتك.',
    points: ['They left after seeing the price — value first: speed, a stable connection, the router / device included.', 'Recommend the smallest plan that fits their use.', 'Standard plans only — no OCU discount for this customer.'] },
  identity: { en: 'The Nafath step can be confusing — I will guide you through it, it takes two minutes.', ar: 'خطوة نفاذ أحيانًا تحير — بساعدك فيها خطوة بخطوة، دقيقتين بس.',
    points: ['The identity step stopped them, not the plan.', 'Walk them through Nafath while on the call.', 'Reassure: it is the national standard, used by every operator.'] },
  coverage: { en: 'Coverage in your area is being extended — let me check your address again now.', ar: 'التغطية في منطقتكم تتوسع — خلني أتحقق من عنوانك مرة ثانية الحين.',
    points: ['They were told there was no free port or coverage: re-check the address first.', 'If fiber is still not there, offer 5G HomeFi (no installation, delivered).', 'Do not promise a date you cannot confirm.'] },
  early: { en: 'You started a request for Salam home internet — can I help you choose the right plan?', ar: 'بدأت طلب إنترنت منزلي من سلام — أقدر أساعدك تختار الباقة المناسبة؟',
    points: ['They left at the first step: discover the need (people at home, streaming, gaming, work).', 'Recommend one plan, not a list.', 'Offer to place the order for them.'] },
  abandoned: { en: 'You started an order with Salam — I am calling to help you finish it.', ar: 'بدأت طلب مع سلام — أتصل عشان أساعدك تكمله.',
    points: ['Ask what stopped them — listen first.', 'Recommend the plan that fits their use.', 'Offer to place the order during the call.'] },
  lead_rejected: { en: 'Our partner could not complete your request — I can take care of it myself now.', ar: 'شريكنا ما قدر يكمل طلبك — أقدر أتابعه معك بنفسي الحين.',
    points: ['A dealer captured them and then rejected the lead: read the dealer\'s reason first.', 'If the reason was technical (coverage, slot), solve that first.', 'Place the order from the OCU account.'] },
  lead_stale: { en: 'You asked about Salam home internet a few days ago — sorry for the wait, I am here to help you now.', ar: 'سألت عن إنترنت سلام المنزلي قبل كم يوم — نعتذر عن التأخير، أنا هنا أساعدك الحين.',
    points: ['Nobody called them back: apologise for the wait.', 'Confirm they still need home internet.', 'Make it easy: you place the order.'] },
  campaign: { en: 'I am calling from Salam about home internet at your address — do you have a minute?', ar: 'أتصل من سلام بخصوص الإنترنت المنزلي في عنوانك — عندك دقيقة؟',
    points: ['Imported list: confirm the context first (they rejected the installation, or asked before).', 'If they rejected the installation, ask what went wrong — that is the objection to solve.', 'OCU offer only if the standard plan does not land.'] },
  rejected_install: { en: 'I am sorry the installation did not work out — I would like to fix that for you.', ar: 'نعتذر إن التركيب ما تم — ودي أصلح الموضوع لك.',
    points: ['They rejected the installation: find out why (timing, technician, cost, cabling).', 'Solve that cause first.', 'If the standard plan does not land, this is the customer the OCU offer ladder was made for.'] },
};
/* a line that promises the OCU discount — never shown for a standard-plans-only lead (5G, or fiber ordered before) */
const PROMISES = t => /\bOCU\b|discount|special offer|خصم|عرض خاص/i.test(String(t || ''));
const STD_ANSWER = 'Compare per Mbps with what they pay today and recommend the plan that fits — standard plans only for this customer.';
const OBJECTIONS = {
  ftth: [{ objection: 'It is too expensive', answer: 'Compare per Mbps with what they pay; if still no, the OCU offer — Fiber 500 at 180 SAR for 3 months, or Fiber 300 at 145 SAR for 4 months.' },
    { objection: 'I am happy with my provider', answer: 'Ask about speed and outages at peak hours; fiber is a dedicated line, router included.' },
    { objection: 'I do not want technicians at home', answer: 'Offer a slot that suits them (evenings / weekends); installation is usually done in one visit.' }],
  '5g': [{ objection: 'Is 5G stable indoors?', answer: 'The HomeFi device is placed by a window; coverage was checked at their address during the journey.' },
    { objection: 'It is too expensive', answer: 'No OCU discount for 5G — pitch value: no installation, delivered to the door, move it when you move.' },
    { objection: 'I want fiber', answer: 'Check fiber feasibility at the address; if not available, 5G is the fast way to get connected today.' }],
};
function sig(L) { return crypto.createHash('sha1').update([L.status, L.attempts, L.offer_code, L.offer_months, L.updated_at && new Date(L.updated_at).toISOString(), L.next_action_at && new Date(L.next_action_at).toISOString()].join('|')).digest('hex').slice(0, 16); }
const daysSince = t => t ? (Date.now() - Date.parse(t)) / 864e5 : null;
function offerPath(desk, L) {
  const offers = desk.offers || S.OFFERS_DEFAULT;
  if (L.product !== 'ftth') return ['STD'];
  const rel = L.relation || {}; if (rel.fixed && rel.fixed.orders > 0) return ['STD'];       // already ordered fiber before: not a new acquisition
  const tried = new Set((L._offered || []).concat(L.offer_code ? [L.offer_code] : []));
  const priceSensitive = ['price', 'payment'].includes(L.reason_class) || /price|expens/i.test(String(L.lost_reason || ''));
  const wantsSpeed = /500|1000/.test(String(L.plan_label || ''));
  const second = wantsSpeed && !priceSensitive ? ['OCU-F500-3', 'OCU-F300-4'] : ['OCU-F300-4', 'OCU-F500-3'];
  const path = ['STD', ...second, 'OCU-F300-6'].filter(c => offers.find(o => o.code === c));
  const next = path.filter(c => !tried.has(c));
  return next.length ? next : path.slice(-1);
}
function rules(desk, L, h) {
  let score = BASE[L.reason_class] ?? 45; const why = [];
  const d = daysSince(L.occurred_at);
  if (d != null) { if (d < 1) { score += 15; why.push('stopped less than a day ago'); } else if (d < 3) score += 8; else if (d > 30) { score -= 20; why.push('more than a month old'); } else if (d > 14) score -= 10; }
  const rel = L.relation || {};
  if (rel.mobile && rel.mobile.active) { score += 10; why.push('already a Salam Mobile customer'); }
  if (rel.fixed && rel.fixed.orders) { score -= 15; why.push('ordered fiber with Salam before — not a new acquisition'); }
  if (rel.fixed && rel.fixed.priorLost) { score -= 8; why.push('a previous lead for this person was lost'); }
  const att = S.n((L.facts || {}).attempts); if (att > 1) { score += Math.min(15, (att - 1) * 5); why.push(`${att} attempts — keeps coming back`); }
  if (L.attempts >= 3 && !L.first_contact_at) { score -= 10; why.push(`${L.attempts} calls without an answer`); }
  if (['interested', 'offer', 'callback'].includes(L.status)) { score += 12; why.push(`status ${S.STATUS_LABEL[L.status].toLowerCase()}`); }
  const sim = similar(h, L);
  if (sim.n >= 5 && h.overall.rate != null) { const delta = (sim.rate - h.overall.rate) * 60; score += Math.max(-12, Math.min(12, delta)); why.push(`similar leads: ${sim.won}/${sim.n} won`); }
  score = Math.max(5, Math.min(98, Math.round(score)));
  const temp = tempOf(score);
  const path = offerPath(desk, L);
  /* standard plans only (5G, or fiber ordered before): no line may promise the OCU discount or a "special offer" */
  const stdOnly = path.length === 1 && path[0] === 'STD';
  const base = PITCH[L.reason_class] || PITCH.abandoned;
  const p = stdOnly && L.reason_class === 'price' ? PITCH.price_std : base;
  const noOcu = L.product === '5g' ? 'Standard 5G HomeFi plans only — there is no OCU discount for 5G.' : 'Standard plans only — the OCU discount is for customers without Salam fiber.';
  const pts = p.points.map(x => stdOnly && /OCU offer|OCU discount/i.test(x) ? noOcu : x);
  const bh = bestHours(h);
  const next = L.status === 'callback' && L.next_action_at ? 'Call back at the agreed time' : !L.first_contact_at ? (temp === 'hot' ? 'Call now — first contact' : 'First call today') : L.status === 'offer' ? 'Follow up on the offer and place the order' : 'Call again and move to an offer';
  return { score, temp, offer_path: path, opener_en: p.en, opener_ar: p.ar, points: [...new Set(pts)].slice(0, 3), objections: (OBJECTIONS[L.product] || OBJECTIONS.ftth).slice(0, 3).map(o => stdOnly && PROMISES(o.answer) ? { objection: o.objection, answer: STD_ANSWER } : o),
    best_time: bh ? bh.text : (L.reason_class === 'payment' || L.reason_class === 'otp' ? 'as soon as possible — within the hour' : '16:00–21:00 KSA (most customers answer after work)'),
    next_action: next, why: why.length ? why.join(' · ') : (BASE[L.reason_class] ? `reason: ${S.REASON_LABEL[L.reason_class] || L.reason_class}` : 'default reading') };
}

/* ------------------------------------------------------------------ the model */
const SYSTEM = `You are Agent 2, the sales coach of Salam's OCU retention team (Saudi telecom, Fixed business: FTTH fiber and 5G HomeFi).
A lead is a customer who started buying Salam home internet and did not finish, or rejected the installation. You help the OCU agent convert it into an order by phone.
Rules you must follow (OCU offer, MSD v1.2):
- Pitch Salam standard plans first. The OCU discount is ONLY for a customer not interested in the standard plans, and ONLY for FTTH new acquisitions (no Salam fiber yet).
- Discounts are offered gradually, shortest first: Fiber 300 at 145 SAR for 4 months, then 6 months; Fiber 500 at 180 SAR for 3 months. 12-month contract. No OCU discount for 5G.
- Allowed offer codes: STD, OCU-F500-3, OCU-F300-4, OCU-F300-6. Never invent an offer, a price or a date.
Write the opener in Gulf Arabic (opener_ar) and in English (opener_en), one or two short sentences each, warm and direct. Talking points: three, short, practical.
Answer with ONE JSON object only: {"score":0-100,"temp":"hot|warm|cold","offer_path":["STD",...],"opener_en":"","opener_ar":"","points":["","",""],"objections":[{"objection":"","answer":""}],"best_time":"","next_action":"","why":""}`;
function prompt(L, base, h) {
  const sim = similar(h, L), rel = L.relation || {};
  const ev = (L._calls || []).slice(-6).map(e => `${e.at.slice(0, 16)} ${e.result}${e.note ? ' — ' + e.note : ''}`).join('; ') || 'no call yet';
  return [
    `LEAD (no personal data): product ${L.product === '5g' ? '5G HomeFi' : 'FTTH fiber'} · plan ${L.plan_label || '—'} · channel ${S.SOURCE_LABEL[L.source] || L.source} · ${L.dealer ? 'dealer/QR involved' : 'direct'}`,
    `Where it stopped: ${L.step_label || '—'} — ${L.reason || '—'} (class ${L.reason_class}). Started ${Math.round(daysSince(L.occurred_at) * 10) / 10} days ago. Journeys by this person: ${S.n((L.facts || {}).attempts) || 1}.`,
    `Relationship with Salam: mobile lines active ${rel.mobile ? rel.mobile.active : 'unknown'}; fixed orders before ${rel.fixed ? rel.fixed.orders : 'unknown'}; earlier leads won ${rel.fixed ? rel.fixed.priorWon : 0}, lost ${rel.fixed ? rel.fixed.priorLost : 0}.`,
    `Status now: ${S.STATUS_LABEL[L.status] || L.status}; contact attempts ${L.attempts}; offers already made: ${(L._offered || []).join(', ') || 'none'}; calls: ${ev}.`,
    `Team history (120 days): similar leads ${sim.won}/${sim.n} won${sim.rate != null ? ` (${Math.round(sim.rate * 100)} %)` : ''}; same channel ${sim.source.won}/${sim.source.n}; overall ${h.overall.won}/${h.overall.n}.`,
    `Offers that won: ${h.offers.slice(0, 4).map(o => `${o.code} ×${o.n}`).join(', ') || 'none yet'}. Top lost reasons: ${h.lost.slice(0, 4).map(o => `${o.reason} ×${o.n}`).join(', ') || 'none yet'}.`,
    `Rule-based reading to improve on: score ${base.score} (${base.temp}); offer path ${base.offer_path.join(' → ')}; best time ${base.best_time}.`,
  ].join('\n');
}
function check(desk, L, j, base) {
  if (!j || typeof j !== 'object') return null;
  const codes = new Set((desk.offers || S.OFFERS_DEFAULT).map(o => o.code));
  let path = Array.isArray(j.offer_path) ? j.offer_path.map(String).filter(c => codes.has(c)) : [];
  if (L.product !== 'ftth' || (L.relation && L.relation.fixed && L.relation.fixed.orders > 0)) path = path.filter(c => c === 'STD');
  if (path.length && path[0] !== 'STD' && !(L._offered || []).includes('STD') && L.status !== 'offer') path = ['STD', ...path.filter(c => c !== 'STD')];
  if (path.includes('OCU-F300-6') && !(L._offered || []).includes('OCU-F300-4') && path.indexOf('OCU-F300-4') < 0) path = path.filter(c => c !== 'OCU-F300-6');
  if (!path.length) path = base.offer_path;
  const stdOnly = path.length === 1 && path[0] === 'STD';
  const s = Math.max(5, Math.min(98, Math.round(Number(j.score)))); const score = Number.isFinite(s) ? s : base.score;
  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const pts = Array.isArray(j.points) ? j.points.map(x => str(x, 220)).filter(Boolean).slice(0, 3) : [];
  const obj = Array.isArray(j.objections) ? j.objections.filter(o => o && o.objection).map(o => ({ objection: str(o.objection, 120), answer: str(o.answer, 260) })).slice(0, 3) : [];
  /* nothing that looks like a phone number or an id may come back from the model */
  const clean = t => String(t || '').replace(/\b\d{9,}\b/g, '…');
  /* standard plans only: a model line that still promises the discount falls back to the rules' line */
  const keep = t => !(stdOnly && PROMISES(t));
  const pts2 = pts.map(clean).filter(keep), obj2 = obj.map(o => keep(o.answer) ? o : { objection: o.objection, answer: STD_ANSWER });
  const oe = clean(str(j.opener_en, 300)), oa = clean(str(j.opener_ar, 300));
  return { score, temp: tempOf(score), offer_path: path,
    opener_en: (keep(oe) && oe) || base.opener_en, opener_ar: (keep(oa) && oa) || base.opener_ar,
    points: pts2.length ? pts2 : base.points, objections: obj2.length ? obj2 : base.objections,
    best_time: str(j.best_time, 80) || base.best_time, next_action: str(j.next_action, 140) || base.next_action, why: clean(str(j.why, 300)) || base.why };
}

/* ------------------------------------------------------------------ advise one lead */
async function load(id) {
  const r = await C().query(`SELECT * FROM fixed_leads WHERE id = $1`, [id]); if (!r.rowCount) return null;
  const L = r.rows[0];
  const ev = await C().query(`SELECT at, kind, detail FROM fixed_lead_events WHERE lead_id = $1 AND kind IN ('call','offer') ORDER BY at`, [id]).catch(() => ({ rows: [] }));
  L._calls = ev.rows.filter(e => e.kind === 'call').map(e => ({ at: new Date(e.at).toISOString(), result: e.detail.result, note: e.detail.lost_reason || null }));
  L._offered = [...new Set(ev.rows.filter(e => e.kind === 'offer' || (e.detail && e.detail.offer)).map(e => e.detail.offer || e.detail.code).filter(Boolean))];
  return L;
}
async function adviseOne(id, { actor, useModel = true, force = false } = {}) {
  await S.ensure();
  const L = await load(id); if (!L) throw Object.assign(new Error('lead not found'), { status: 404 });
  const desk = await S.getDesk(), h = await history();
  const s = sig(L);
  if (!force) { const cur = await C().query(`SELECT sig FROM fixed_lead_advice WHERE lead_id = $1`, [id]); if (cur.rowCount && cur.rows[0].sig === s) return { unchanged: true }; }
  const base = rules(desk, L, h);
  let out = base, model = null, ms = null, modelErr = null;
  if (useModel) {
    try {
      const llm = require('./llm');
      const a = await llm.chat({ system: SYSTEM, user: prompt(L, base, h), purpose: 'agent-leads.coach', caller: CALLER, actor: actor || null, json: true, maxTokens: 650, temperature: 0.4 });
      const c = check(desk, L, a.json, base); if (c) { out = c; model = a.model; ms = a.ms; } else modelErr = a.jsonError || 'unusable answer';
    } catch (e) { modelErr = e.message; if (e.budget) modelErr = 'budget: ' + e.message; }
  }
  const first = out.offer_path[0]; const off = S.offerOf(desk, first);
  await C().query(`INSERT INTO fixed_lead_advice (lead_id, at, model, deterministic, ms, score, temp, offer_code, offer_months, opener_en, opener_ar, points, objections, path, best_time, next_action, why, sig, attempts)
      VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $17, $13, $14, $15, $16, 1)
      ON CONFLICT (lead_id) DO UPDATE SET at = now(), model = EXCLUDED.model, deterministic = EXCLUDED.deterministic, ms = EXCLUDED.ms, score = EXCLUDED.score, temp = EXCLUDED.temp,
        offer_code = EXCLUDED.offer_code, offer_months = EXCLUDED.offer_months, opener_en = EXCLUDED.opener_en, opener_ar = EXCLUDED.opener_ar, points = EXCLUDED.points,
        objections = EXCLUDED.objections, path = EXCLUDED.path, best_time = EXCLUDED.best_time, next_action = EXCLUDED.next_action, why = EXCLUDED.why, sig = EXCLUDED.sig,
        attempts = fixed_lead_advice.attempts + 1, helpful = NULL, feedback_by = NULL, feedback_at = NULL`,
    [id, model, !model, ms, out.score, out.temp, first, off && off.months ? off.months : null, out.opener_en, out.opener_ar, JSON.stringify(out.points), JSON.stringify(out.objections), out.best_time, out.next_action, out.why, s, JSON.stringify(out.offer_path)]);
  await C().query(`UPDATE fixed_leads SET score = $2, temp = $3 WHERE id = $1`, [id, out.score, out.temp]).catch(() => {});
  return { ...out, model, ms, deterministic: !model, modelErr };
}

/* ------------------------------------------------------------------ the tick (Agent 2's process) */
let busy = false;
async function tick({ limit } = {}) {
  if (busy) return { skipped: true }; busy = true;
  const stats = { checked: 0, advised: 0, modelled: 0, hot: 0, model_down: false, brief: null, errors: 0 };
  let run = null;
  try {
    await S.ensure();
    run = (await C().query(`INSERT INTO agent_runs (agent) VALUES ('leads') RETURNING id`)).rows[0].id;
    const rows = (await C().query(`SELECT l.id, l.status, l.attempts, l.offer_code, l.offer_months, l.updated_at, l.next_action_at, a.sig, a.at AS advised_at
        FROM fixed_leads l LEFT JOIN fixed_lead_advice a ON a.lead_id = l.id
       WHERE l.status = ANY($1) ORDER BY (a.lead_id IS NULL) DESC, l.occurred_at DESC LIMIT ${Math.max(400, CFG.maxPerTick + CFG.backlogPerTick + 50)}`, [S.OPEN])).rows;
    const need = rows.filter(r => !r.sig || r.sig !== sig(r)), cap = limit || CFG.maxPerTick;
    const todo = need.slice(0, cap).concat(limit ? [] : need.slice(cap).filter(r => !r.sig).slice(0, CFG.backlogPerTick));   // never scored: rules only, beyond the cap
    stats.checked = todo.length;
    let modelLeft = CFG.maxModelPerTick;
    for (const r of todo) {
      try {
        const a = await adviseOne(r.id, { useModel: modelLeft > 0 && !stats.model_down, force: true });
        stats.advised++; if (a.model) { stats.modelled++; modelLeft--; } else if (a.modelErr && modelLeft > 0) stats.model_down = true;
        if (a.temp === 'hot') stats.hot++;
      } catch (e) { stats.errors++; log('advise', r.id, e.message); }
    }
    /* the model's spare calls upgrade the leads being worked that only carry the rules' advice — hot first, 3 tries at most */
    if (modelLeft > 0 && !stats.model_down) {
      const up = (await C().query(`SELECT l.id FROM fixed_leads l JOIN fixed_lead_advice a ON a.lead_id = l.id
          WHERE l.status = ANY($1) AND a.deterministic AND a.attempts < 3 AND (l.assignee IS NOT NULL OR l.temp = 'hot')
          ORDER BY (l.temp = 'hot') DESC, l.score DESC NULLS LAST LIMIT $2`, [S.OPEN, modelLeft]).catch(() => ({ rows: [] }))).rows;
      for (const r of up) {
        try { const a = await adviseOne(r.id, { useModel: true, force: true }); if (a.model) { stats.modelled++; stats.upgraded = (stats.upgraded || 0) + 1; } else if (a.modelErr) { stats.model_down = true; break; } }
        catch (e) { stats.errors++; log('upgrade', r.id, e.message); }
      }
    }
    try { stats.brief = await maybeBrief(); } catch (e) { log('brief', e.message); }
    await C().query(`UPDATE agent_runs SET finished_at = now(), ok = true, stats = $2 WHERE id = $1`, [run, JSON.stringify(stats)]);
    if (stats.checked || stats.brief || stats.upgraded) log(`tick: ${stats.checked} new / changed lead(s) → ${stats.advised} advised · ${stats.modelled} with the model${stats.upgraded ? ` (${stats.upgraded} worked lead(s) upgraded from the rules)` : ''}${stats.model_down ? ' · model unavailable — rules' : ''} · ${stats.hot} hot${stats.brief ? ' · team brief written' : ''}`);
  } catch (e) { log('tick failed:', e.message); if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = false, error = $2, stats = $3 WHERE id = $1`, [run, e.message, JSON.stringify(stats)]).catch(() => {}); }
  finally { busy = false; }
  return stats;
}

/* ------------------------------------------------------------------ the morning brief for the team */
async function figures() {
  const q = async (sql, p) => { try { return (await C().query(sql, p)).rows; } catch (_) { return []; } };
  const y0 = S.dayStart(Date.now() - 864e5), t0 = S.dayStart(), w0 = S.weekStart();
  const [yday, pipe, reasons, top] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE kind='call')::int AS calls, count(*) FILTER (WHERE kind='call' AND (detail->>'contact')::boolean)::int AS contacts,
          count(*) FILTER (WHERE kind='won')::int AS won, count(*) FILTER (WHERE kind='offer')::int AS offers FROM fixed_lead_events WHERE at >= $1 AND at < $2`, [y0, t0]),
    q(`SELECT count(*) FILTER (WHERE status = ANY($1))::int AS open, count(*) FILTER (WHERE status = ANY($1) AND assignee IS NULL)::int AS unassigned,
          count(*) FILTER (WHERE status = ANY($1) AND temp='hot')::int AS hot, count(*) FILTER (WHERE status = ANY($1) AND next_action_at < now())::int AS overdue,
          count(*) FILTER (WHERE created_at >= $2)::int AS new_today, count(*) FILTER (WHERE status='won' AND won_at >= $3)::int AS won_week FROM fixed_leads`, [S.OPEN, t0, w0]),
    q(`SELECT reason_class, count(*)::int AS n, count(*) FILTER (WHERE status='won')::int AS won FROM fixed_leads WHERE occurred_at > now() - interval '60 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
    q(`SELECT actor, sum(points)::int AS pts, count(*) FILTER (WHERE kind='won')::int AS won FROM fixed_lead_events WHERE at >= $1 AND actor <> 'system' GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, [w0]),
  ]);
  return { yday: yday[0] || {}, pipe: pipe[0] || {}, reasons, top };
}
async function maybeBrief(force) {
  if (!force && S.ksaHour() < CFG.briefHour) return null;
  const day = S.ksaDay();
  if (!force) {
    const done = await C().query(`SELECT summary FROM agent_reports WHERE kind = 'leads-brief' AND period_start = $1::date ORDER BY created_at DESC LIMIT 1`, [day]).catch(() => ({ rowCount: 1, rows: [{ summary: { pipe: { open: 1 } } }] }));
    if (done.rowCount) {
      /* today's brief stands — unless it was written over an empty desk (go-live day, 14:03) and the desk has leads now (alpha.170) */
      if (S.n(((done.rows[0].summary || {}).pipe || {}).open) > 0) return null;
      const now = await C().query(`SELECT count(*)::int AS n FROM fixed_leads WHERE status = ANY($1)`, [S.OPEN]).catch(() => ({ rows: [{ n: 0 }] }));
      if (!S.n(now.rows[0].n)) return null;
    }
  }
  const f = await figures(); const y = f.yday, p = f.pipe;
  /* nothing to say → no brief (alpha.167: on go-live day it wrote "a quiet day, a fresh start" over an empty desk at 14:03) */
  if (!force && !S.n(p.open) && !S.n(y.calls) && !S.n(y.won) && !S.n(p.new_today)) return null;
  const hr = S.ksaHour(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const best = f.reasons.filter(r => r.n >= 3).map(r => ({ ...r, rate: r.won / r.n })).sort((a, b) => b.rate - a.rate)[0];
  let text = `Yesterday: ${S.n(y.calls)} calls, ${S.n(y.contacts)} reached, ${S.n(y.offers)} offers, ${S.n(y.won)} won. Today ${S.n(p.open)} open leads (${S.n(p.hot)} hot, ${S.n(p.unassigned)} not assigned, ${S.n(p.overdue)} callbacks overdue), ${S.n(p.new_today)} new since midnight; ${S.n(p.won_week)} won this week.`
    + (best ? ` Best converting lately: ${S.REASON_LABEL[best.reason_class] || best.reason_class} (${best.won}/${best.n}) — call those first.` : '');
  try {
    const llm = require('./llm');
    const a = await llm.chat({ system: `You are Agent 2, coach of the OCU retention sales team at Salam (Fixed: FTTH, 5G). Write the team brief: 3 to 4 short sentences, motivating, concrete, no personal data, no invented numbers or facts — say only what the figures show. Open with "${greet}, team" (it is ${String(hr).padStart(2, '0')}:00 KSA). Plain text only.`,
      user: `Figures (use only these): ${text}\nLead reasons last 60 days: ${f.reasons.map(r => `${S.REASON_LABEL[r.reason_class] || r.reason_class} ${r.won}/${r.n}`).join(', ') || 'none'}.`, purpose: 'agent-leads.brief', caller: CALLER, maxTokens: 260, temperature: 0.5 });
    const t = String(a.text || '').replace(/\s+/g, ' ').trim(); if (t.length > 40) text = t.slice(0, 700);
  } catch (_) { /* rule text stands */ }
  /* the same table Agent 1 and the refund desk write (agentLog.js): summary jsonb, narrative text */
  await C().query(`CREATE TABLE IF NOT EXISTS agent_reports (id bigserial PRIMARY KEY, kind text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, summary jsonb NOT NULL DEFAULT '{}', narrative text, mailed_to integer, created_at timestamptz NOT NULL DEFAULT now())`).catch(() => {});
  await C().query(`INSERT INTO agent_reports (kind, period_start, period_end, summary, narrative, mailed_to) VALUES ('leads-brief', $1::date, $1::date, $3, $2, 0)`, [day, text, JSON.stringify(f)]).catch(e => log('brief insert', e.message));
  return { day, chars: text.length };
}
async function lastBrief() { try { const r = await C().query(`SELECT created_at, narrative, summary FROM agent_reports WHERE kind = 'leads-brief' ORDER BY created_at DESC LIMIT 1`); return r.rows[0] || null; } catch (_) { return null; } }

function start() {
  if (!CFG.enabled) { log('disabled (AGENT_LEADS_ENABLED=0) — idle'); return; }
  log(`armed: every ${CFG.intervalMin} min · up to ${CFG.maxPerTick} lead(s) per tick (${CFG.maxModelPerTick} with the model) · team brief at ${CFG.briefHour}:00 KSA`);
  setTimeout(() => tick().catch(e => log(e.message)), 75000); setInterval(() => tick().catch(e => log(e.message)), CFG.intervalMin * 60000);
}

module.exports = { start, tick, adviseOne, rules, history, offerPath, maybeBrief, lastBrief, figures, CFG, sig, scoring, BANDS };
