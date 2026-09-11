/* llmBudget.js — HOW MUCH AI EACH PERSON USES, AND THE CEILING (11 Sep 2026).
 *
 * Every llm.js call is metered in TOKENS (what the model actually processes), attributed to WHO asked:
 *   - a console user      → their e-mail (Yusr chat, anything a human triggers)
 *   - an agent service    → its PM2 name (salam-agent-incident / salam-agent-log) — machines get their own budget,
 *                           so an agent storm can never eat a person's allowance and vice versa
 * Tokens come from the provider when it reports them (Ollama prompt_eval_count / eval_count, OpenAI usage) and
 * otherwise from characters ÷ 4 — marked `estimated` so nobody reads an estimate as a measurement.
 *
 * BUDGETS (settings key 'llm_budget'), all per KSA day (Asia/Riyadh, resets at 00:00):
 *   dailyUser      default ceiling for one console user            perUser   { email: tokens }  overrides
 *   dailyCaller    default ceiling for one agent service           perCaller { name: tokens }   overrides
 *   dailyGlobal    ceiling for the whole console (all callers)     monthlyGlobal  calendar month, KSA
 *   warnAt 0.8     first warning at 80 %                           block true → refuse over 100 %, false → warn only
 *   notifyUser / notifyAdmins   one mail per subject per threshold per day (llm_budget_events)
 *   price { primary, fallback, currency }   cost per 1 000 tokens — on-prem is 0, a cloud/GPU fallback is not
 *
 * A refusal is a normal, explained answer — never a crash: llm.chat throws `budget` and the caller degrades
 * (Yusr answers from rules, the agents write their measured-evidence note).
 */
'use strict';
const db = require('./db');

const DEFAULTS = {
  enabled: true,
  dailyUser: 150000, dailyCaller: 600000, dailyGlobal: 4000000, monthlyGlobal: 80000000,
  perUser: {}, perCaller: {},
  /* warnSteps — every line that raises a mail before the ceiling. One warning at 80 % was not enough:
   * people act on 90 %, not on 80 %. Each step mails at most once per subject per KSA day
   * (llm_budget_events is unique on subject+day+threshold). warnAt stays as the legacy single value
   * and is folded into the list, so an older saved config keeps working. */
  warnSteps: [0.8, 0.9], warnAt: 0.8,
  block: true,
  /* Budget mails go to the SUPER ADMINS only (Yosri, 11 Sep 2026). Set notifyUser true to also copy
   * the person who hit their own ceiling — off by default: L1/L2 should not be mailed about a quota
   * they cannot change. */
  notifyUser: false, notifyAdmins: true,
  price: { primary: 0, fallback: 0, currency: 'SAR' },
};
const KSA_DAY = `(at AT TIME ZONE 'Asia/Riyadh')::date`;
const isService = s => /^salam-agent-|^service:/.test(String(s || ''));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

let _cfg = null, _cfgAt = 0;
async function config() {
  if (_cfg && Date.now() - _cfgAt < 20000) return _cfg;
  let s = {};
  try { s = (await require('./settings').getSetting('llm_budget')) || {}; } catch (_) { s = {}; }
  _cfg = {
    ...DEFAULTS, ...s,
    dailyUser: num(s.dailyUser, DEFAULTS.dailyUser), dailyCaller: num(s.dailyCaller, DEFAULTS.dailyCaller),
    dailyGlobal: num(s.dailyGlobal, DEFAULTS.dailyGlobal), monthlyGlobal: num(s.monthlyGlobal, DEFAULTS.monthlyGlobal),
    warnAt: Math.min(0.99, Math.max(0.1, num(s.warnAt, DEFAULTS.warnAt))),
    warnSteps: (() => {
      const raw = Array.isArray(s.warnSteps) && s.warnSteps.length ? s.warnSteps
        : (s.warnAt != null ? [s.warnAt] : DEFAULTS.warnSteps);
      const out = [...new Set(raw.map(Number).filter(x => Number.isFinite(x) && x > 0 && x < 1).map(x => Math.round(x * 100) / 100))].sort((a, b) => a - b);
      return out.length ? out : DEFAULTS.warnSteps;
    })(),
    perUser: s.perUser && typeof s.perUser === 'object' ? s.perUser : {},
    perCaller: s.perCaller && typeof s.perCaller === 'object' ? s.perCaller : {},
    price: { ...DEFAULTS.price, ...(s.price || {}) },
    enabled: s.enabled !== false, block: s.block !== false, notifyUser: s.notifyUser !== false, notifyAdmins: s.notifyAdmins !== false,
  };
  _cfgAt = Date.now(); return _cfg;
}
async function setConfig(patch) {
  const settings = require('./settings'); const cur = (await settings.getSetting('llm_budget')) || {};
  const next = { ...cur, ...(patch || {}) };
  await settings.setSetting('llm_budget', next); _cfg = null; return config();
}

let _schema = false;
async function ensureSchema() {
  if (_schema) return; _schema = true;
  const C = db.console;
  for (const sql of [
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS actor text`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS prompt_tokens integer`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS answer_tokens integer`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS tokens integer`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS estimated boolean NOT NULL DEFAULT false`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS cost numeric`,
    `ALTER TABLE llm_calls ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false`,
    `CREATE INDEX IF NOT EXISTS idx_llm_calls_actor ON llm_calls (actor, at DESC)`,
    `CREATE TABLE IF NOT EXISTS llm_budget_events (
       id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), day date NOT NULL,
       subject text NOT NULL, kind text NOT NULL, threshold text NOT NULL,
       used bigint NOT NULL, cap bigint NOT NULL, mailed_to text, ok boolean)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_budget_once ON llm_budget_events (subject, day, threshold)`,
  ]) await C.query(sql).catch(e => console.warn('[llm-budget] schema:', e.message));
}

/* who this call belongs to + the ceiling that applies */
async function subjectOf(opts = {}) {
  const cfg = await config();
  const actor = String(opts.actor || '').trim().toLowerCase();
  const caller = String(opts.caller || '').trim();
  if (actor && actor !== 'anonymous' && !isService(actor)) return { subject: actor, kind: 'user', cap: num(cfg.perUser[actor], cfg.dailyUser) };
  const svc = isService(caller) ? caller : (isService(actor) ? actor : (caller || 'console'));
  return { subject: svc, kind: isService(svc) ? 'agent' : 'service', cap: num(cfg.perCaller[svc], cfg.dailyCaller) };
}

async function usedToday(subject) {
  const r = await db.console.query(
    `SELECT coalesce(sum(tokens),0)::bigint AS t, count(*)::int AS n FROM llm_calls
     WHERE actor = $1 AND ${KSA_DAY} = (now() AT TIME ZONE 'Asia/Riyadh')::date AND coalesce(blocked,false) = false`, [subject]).catch(() => ({ rows: [{ t: 0, n: 0 }] }));
  return { tokens: Number(r.rows[0].t || 0), calls: r.rows[0].n || 0 };
}
async function usedGlobal() {
  const r = await db.console.query(
    `SELECT coalesce(sum(tokens) FILTER (WHERE ${KSA_DAY} = (now() AT TIME ZONE 'Asia/Riyadh')::date),0)::bigint AS day,
            coalesce(sum(tokens) FILTER (WHERE ${KSA_DAY} >= date_trunc('month', (now() AT TIME ZONE 'Asia/Riyadh'))::date),0)::bigint AS month
     FROM llm_calls WHERE coalesce(blocked,false) = false`).catch(() => ({ rows: [{ day: 0, month: 0 }] }));
  return { day: Number(r.rows[0].day || 0), month: Number(r.rows[0].month || 0) };
}

/* may this call go ahead? → { allowed, reason, subject, kind, used, cap, pct, global } */
async function check(opts = {}) {
  const cfg = await config();
  const s = await subjectOf(opts);
  if (!cfg.enabled) return { allowed: true, off: true, ...s };
  await ensureSchema();
  const [mine, g] = await Promise.all([usedToday(s.subject), usedGlobal()]);
  const pct = s.cap > 0 ? mine.tokens / s.cap : 0;
  const out = { allowed: true, ...s, used: mine.tokens, calls: mine.calls, pct, global: g, dailyGlobal: cfg.dailyGlobal, monthlyGlobal: cfg.monthlyGlobal, block: cfg.block };
  const over = (what, used, cap) => ({ ...out, allowed: !cfg.block, over: what, reason: `${what} AI budget used up — ${used.toLocaleString()} of ${cap.toLocaleString()} tokens${what === 'monthly' ? ' this month' : ' today'}${cfg.block ? '' : ' (warning only)'}` });
  if (cfg.monthlyGlobal > 0 && g.month >= cfg.monthlyGlobal) return over('monthly', g.month, cfg.monthlyGlobal);
  if (cfg.dailyGlobal > 0 && g.day >= cfg.dailyGlobal) return over('console', g.day, cfg.dailyGlobal);
  if (s.cap > 0 && mine.tokens >= s.cap) return over(s.kind === 'user' ? 'your daily' : `${s.subject} daily`, mine.tokens, s.cap);
  return out;
}

/* after a call: threshold mails, once per subject per threshold per KSA day */
async function afterCall(opts = {}) {
  try {
    const cfg = await config(); if (!cfg.enabled) return;
    const s = await subjectOf(opts);
    const [mine, g] = await Promise.all([usedToday(s.subject), usedGlobal()]);
    /* which line was crossed — 'over' at 100 %, otherwise the HIGHEST warn step passed. The step is
     * part of the threshold key ('warn80', 'warn90'), so 80 % and 90 % are two separate mails and
     * neither repeats within the same KSA day. */
    const crossed = (used, cap) => {
      if (!(cap > 0)) return null;
      const p = used / cap;
      if (p >= 1) return 'over';
      const hit = [...cfg.warnSteps].reverse().find(x => p >= x);
      return hit ? 'warn' + Math.round(hit * 100) : null;
    };
    const marks = [];
    { const t = crossed(mine.tokens, s.cap); if (t) marks.push([s.subject, s.kind, t, mine.tokens, s.cap]); }
    { const t = crossed(g.day, cfg.dailyGlobal); if (t) marks.push(['console', 'global', t, g.day, cfg.dailyGlobal]); }
    for (const [subject, kind, threshold, used, cap] of marks) {
      const ins = await db.console.query(
        `INSERT INTO llm_budget_events (day, subject, kind, threshold, used, cap)
         VALUES ((now() AT TIME ZONE 'Asia/Riyadh')::date, $1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [subject, kind, threshold, used, cap]).catch(() => ({ rowCount: 0 }));
      if (!ins.rowCount) continue;                                   // already announced today
      await mail({ subject, kind, threshold, used, cap, cfg }).catch(() => {});
    }
  } catch (e) { console.warn('[llm-budget] afterCall:', e.message); }
}

/* WHO the mail goes to for a given event — a person gets their own warning, super admins get the
 * global ones and every ceiling actually reached. */
async function recipients({ subject, kind, threshold, cfg }) {
  const to = [];
  if (cfg.notifyAdmins !== false) {
    const r = await db.console.query(`SELECT email, name FROM console_users WHERE enabled AND (role='super_admin' OR 'super_admin'=ANY(coalesce(roles,'{}')))`).catch(() => ({ rows: [] }));
    r.rows.forEach(u => { if (!to.some(x => String(x.email).toLowerCase() === String(u.email).toLowerCase())) to.push(u); });
  }
  /* off by default — L1/L2 cannot change their own ceiling, so mailing them is noise, not action */
  if (kind === 'user' && cfg.notifyUser === true && !to.some(x => String(x.email).toLowerCase() === String(subject).toLowerCase())) to.push({ email: subject });
  return to;
}

/* BUILD the mail — subject line + full HTML. Kept separate from sending so the exact production
 * message can be previewed (deploy152/test-budget-mails.cjs) without a real ceiling being reached. */
function buildMail({ subject, kind, threshold, used, cap, cfg, note }) {
  const notify = require('./notify');
  const pct = cap > 0 ? Math.round(100 * used / cap) : 0;
  const who = kind === 'user' ? 'You have' : `${subject} has`;
  const head = threshold === 'over' ? `${kind === 'global' ? 'The console' : who.replace(' have', ' has').replace('You has', 'You have')} reached the daily AI budget`
    : `${kind === 'global' ? 'The console is' : `${who.replace(' have', ' has').replace('You has', 'You have')}`} at ${pct} % of the daily AI budget`;
  const url = notify.CONSOLE_URL + '#settings-agents';
  /* WHAT NOW — every one of these mails names the next step, because the person reading it is usually
   * mid-incident and should not have to work out whether they are blocked and who can unblock them. */
  const next = threshold === 'over'
    ? (cfg.block
      ? (kind === 'user'
        ? 'Nothing you do breaks: Yusr keeps answering from the rule engine. If you need the model back today, ask a super admin to raise your ceiling on the same screen — it takes effect on your next question.'
        : 'The console keeps working from the rule engine and the measured-evidence notes. Raise the ceiling on the screen below if this is a real workload rather than a runaway caller.')
      : 'Nothing is blocked — the budget is set to warn only, so this is for information.')
    : (kind === 'user'
      ? 'Nothing is blocked. Your live percentage is in the Yusr panel header, and at 100 % ' + (cfg.block ? 'AI answers pause until midnight — the console keeps working from the rule engine.' : 'you get one more mail; nothing is blocked.')
      : 'Nothing is blocked. At 100 % ' + (cfg.block ? 'AI answers pause until midnight — the console keeps working from the rule engine.' : 'one more mail is sent; nothing is blocked.'));
  const bar = (() => { const p = Math.max(0, Math.min(1.08, cap > 0 ? used / cap : 0));
    const col = p >= 1 ? '#dc2626' : p >= 0.8 ? '#d97706' : '#0e9f5a';
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 14px"><tr>
      <td style="background:#e8edf2;border-radius:7px;height:12px;padding:0">
        <table role="presentation" cellpadding="0" cellspacing="0" width="${Math.round(Math.min(1, p) * 100)}%" style="height:12px"><tr><td style="background:${col};border-radius:7px;height:12px;font-size:0">&nbsp;</td></tr></table>
      </td></tr></table>`; })();
  const body = `<div style="font-size:13.5px;color:#20302a;line-height:1.6">
      <b>${notify.esc(head)}.</b><br><br>
      Used <b>${used.toLocaleString()}</b> of <b>${cap.toLocaleString()}</b> tokens today — <b>${pct} %</b>. The day is the KSA day and resets at 00:00.
      ${bar}
      ${notify.esc(next)}<br><br>
      <a href="${url}" style="display:inline-block;background:#0e9f5a;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:9px 16px;border-radius:9px">Open AI usage &amp; budget</a><br><br>
      <span style="color:#64748b;font-size:12px">Settings › Agents › AI usage &amp; budget — who used what, the ceilings, and every notification sent. The model runs on our own server: the ceiling protects the shared machine, not a bill.</span>
    </div>`;
  /* the pill gets louder as the line gets closer: 80 % amber, 90 % deep orange, 100 % red */
  const pillColor = threshold === 'over' ? '#dc2626' : pct >= 90 ? '#ea580c' : '#d97706';
  const html = notify.shell({ title: 'AI budget — Operations Console', badge: 'OPERATIONS CONSOLE · AI', pill: threshold === 'over' ? 'BUDGET REACHED' : `${pct} %`, pillColor,
    bodyHtml: body + (note ? `<div style="margin-top:14px;padding:9px 11px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px">${notify.esc(note)}</div>` : '') });
  return { subject: `[Salam Ops] AI budget ${threshold === 'over' ? 'reached' : pct + ' %'} — ${subject}`, html, pct };
}

async function mail({ subject, kind, threshold, used, cap, cfg }) {
  const notify = require('./notify');
  const to = await recipients({ subject, kind, threshold, cfg });
  if (!to.length) return;
  const m = buildMail({ subject, kind, threshold, used, cap, cfg });
  const r = await notify.sendHtml(to, m.subject, m.html, []);
  await db.console.query(`UPDATE llm_budget_events SET mailed_to=$2, ok=$3 WHERE subject=$1 AND day=(now() AT TIME ZONE 'Asia/Riyadh')::date AND threshold=$4`,
    [subject, to.map(x => x.email).join(', '), !!r.sent, threshold]).catch(() => {});
}

/* PREVIEW — send the real budget mails to one address so they can be reviewed before anyone hits a
 * ceiling. Nothing is written to llm_budget_events, no budget is changed, no ceiling is touched. */
async function previewMails({ to, cases, note, dryRun } = {}) {
  const notify = require('./notify');
  const cfg = await config();
  const list = (Array.isArray(to) ? to : String(to || '').split(/[,;\s]+/)).filter(Boolean).map(e => ({ email: e }));
  if (!list.length) throw new Error('previewMails: no recipient');
  const out = [];
  for (const c of (cases || [])) {
    const useCfg = { ...cfg, ...(c.cfg || {}) };
    const m = buildMail({ subject: c.subject, kind: c.kind, threshold: c.threshold, used: c.used, cap: c.cap, cfg: useCfg, note });
    let sent = false, error = null;
    if (!dryRun) { try { const r = await notify.sendHtml(list, m.subject, m.html, []); sent = !!r.sent; error = r.error || null; } catch (e) { error = e.message; } }
    out.push({ name: c.name, to: list.map(x => x.email).join(', '), subject: m.subject, pct: m.pct, sent, error, bytes: m.html.length });
  }
  return out;
}

/* the usage screen: per day, per subject, per purpose, per provider (+ cost) */
async function usage({ days = 14, actor = '' } = {}) {
  await ensureSchema();
  const cfg = await config(); const C = db.console; const d = String(Math.min(180, Math.max(1, Number(days) || 14)));
  const where = actor ? `AND actor = $2` : ''; const p = actor ? [d, actor] : [d];
  const win = `at >= (now() AT TIME ZONE 'Asia/Riyadh')::date - ($1||' days')::interval`;
  const [byDay, bySubject, byPurpose, byProvider, today, g, events] = await Promise.all([
    C.query(`SELECT ${KSA_DAY} AS day, coalesce(sum(tokens),0)::bigint AS tokens, count(*)::int AS calls,
                    coalesce(sum(tokens) FILTER (WHERE actor LIKE 'salam-agent-%'),0)::bigint AS agent_tokens,
                    coalesce(sum(cost),0)::numeric AS cost, count(*) FILTER (WHERE blocked)::int AS blocked
             FROM llm_calls WHERE ${win} ${where} GROUP BY 1 ORDER BY 1`, p),
    C.query(`SELECT actor AS subject, coalesce(sum(tokens),0)::bigint AS tokens, count(*)::int AS calls,
                    count(*) FILTER (WHERE NOT ok AND NOT coalesce(blocked,false))::int AS failed, count(*) FILTER (WHERE blocked)::int AS blocked,
                    coalesce(sum(cost),0)::numeric AS cost, max(at) AS last_at,
                    coalesce(sum(tokens) FILTER (WHERE ${KSA_DAY} = (now() AT TIME ZONE 'Asia/Riyadh')::date),0)::bigint AS today
             FROM llm_calls WHERE ${win} ${where} AND actor IS NOT NULL GROUP BY 1 ORDER BY tokens DESC LIMIT 50`, p),
    C.query(`SELECT purpose, coalesce(sum(tokens),0)::bigint AS tokens, count(*)::int AS calls, round(avg(ms))::int AS avg_ms
             FROM llm_calls WHERE ${win} ${where} GROUP BY 1 ORDER BY tokens DESC LIMIT 12`, p),
    C.query(`SELECT provider, coalesce(sum(tokens),0)::bigint AS tokens, count(*)::int AS calls, coalesce(sum(cost),0)::numeric AS cost
             FROM llm_calls WHERE ${win} ${where} GROUP BY 1 ORDER BY tokens DESC`, p),
    C.query(`SELECT count(*)::int AS calls, coalesce(sum(tokens),0)::bigint AS tokens FROM llm_calls WHERE ${KSA_DAY} = (now() AT TIME ZONE 'Asia/Riyadh')::date`),
    usedGlobal(),
    C.query(`SELECT at, subject, kind, threshold, used, cap, mailed_to FROM llm_budget_events ORDER BY at DESC LIMIT 20`).catch(() => ({ rows: [] })),
  ]);
  /* WHO each person is — the same card the Alerts owner column shows (name, role, team, ack workload) */
  let who = {};
  try { who = await require('./people').cards(C, bySubject.rows.map(r => r.subject).filter(x => !isService(x))); } catch (_) { who = {}; }
  const users = [], agents = [];
  for (const r of bySubject.rows) {
    const cap = isService(r.subject) ? num(cfg.perCaller[r.subject], cfg.dailyCaller) : num(cfg.perUser[String(r.subject).toLowerCase()], cfg.dailyUser);
    const row = { ...r, tokens: Number(r.tokens), today: Number(r.today), cost: Number(r.cost || 0), cap, pct: cap > 0 ? Number(r.today) / cap : 0,
      person: isService(r.subject) ? null : (who[String(r.subject).toLowerCase()] || null) };
    (isService(r.subject) ? agents : users).push(row);
  }
  return {
    days: Number(d), budget: cfg,
    byDay: byDay.rows.map(r => ({ ...r, tokens: Number(r.tokens), agent_tokens: Number(r.agent_tokens), cost: Number(r.cost || 0) })),
    users, agents, people: who, byPurpose: byPurpose.rows.map(r => ({ ...r, tokens: Number(r.tokens) })), byProvider: byProvider.rows.map(r => ({ ...r, tokens: Number(r.tokens), cost: Number(r.cost || 0) })),
    today: { calls: today.rows[0].calls, tokens: Number(today.rows[0].tokens), cap: cfg.dailyGlobal, pct: cfg.dailyGlobal > 0 ? Number(today.rows[0].tokens) / cfg.dailyGlobal : 0 },
    month: { tokens: g.month, cap: cfg.monthlyGlobal, pct: cfg.monthlyGlobal > 0 ? g.month / cfg.monthlyGlobal : 0 },
    events: events.rows,
  };
}
/* one person's own line — for the Yusr panel / a profile card */
async function mine(actor) {
  const cfg = await config(); const s = await subjectOf({ actor });
  const u = await usedToday(s.subject);
  return { subject: s.subject, kind: s.kind, used: u.tokens, calls: u.calls, cap: s.cap, pct: s.cap > 0 ? u.tokens / s.cap : 0, enabled: cfg.enabled, block: cfg.block, warnAt: cfg.warnAt };
}

const price = (cfg, provider, tokens) => {
  const per1k = /fallback/.test(String(provider || '')) ? Number(cfg.price.fallback || 0) : Number(cfg.price.primary || 0);
  return per1k > 0 ? Number(((tokens / 1000) * per1k).toFixed(4)) : 0;
};

module.exports = { DEFAULTS, config, setConfig, ensureSchema, check, afterCall, usage, mine, subjectOf, usedToday, usedGlobal, price, isService , buildMail, recipients, previewMails };
