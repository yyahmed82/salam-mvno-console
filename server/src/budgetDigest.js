/* budgetDigest.js — the AI usage & budget screen, mailed once a day (11 Sep 2026).
 *
 * WHY. The detailed view answers "who used the model, how much, and how close to the ceiling" — but
 * somebody has to go and look. This sends the same picture to the super admins at 00:05 KSA for the
 * KSA day that just closed, so the answer arrives without anyone opening the console.
 *
 * REAL DATA ONLY: every figure comes from llm_calls / llm_budget_events on the console DB. If a day
 * had no AI calls the mail still goes out and says so — a silent day is information too.
 *
 *   build({ day })     → { subject, html, stats }   day = 'YYYY-MM-DD' KSA, default: yesterday
 *   send({ to, day })  → { sent, to, subject }      to defaults to the super admins
 *   maybeSend(now)     → sends once per KSA day, at or after DIGEST_HOUR (default 00, i.e. 00:05)
 */
'use strict';
const db = require('./db');
const notify = require('./notify');
const llmBudget = require('./llmBudget');

const KSA = `AT TIME ZONE 'Asia/Riyadh'`;
const esc = s => notify.esc(String(s == null ? '' : s));
const n = v => Number(v || 0).toLocaleString('en-US');
const tk = v => v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v);
const pctOf = (a, b) => b > 0 ? Math.round(100 * a / b) : 0;
const isService = s => /^salam-agent-|^service:/.test(String(s || ''));
const ksaToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const ksaYesterday = () => new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(0, 10);

/* a table-based bar — Outlook has no flexbox and drops CSS widths on divs */
function bar(p, w) {
  const pc = Math.max(0, Math.min(1, p || 0)), col = pc >= 1 ? '#dc2626' : pc >= 0.9 ? '#ea580c' : pc >= 0.8 ? '#d97706' : '#0e9f5a';
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="${w || 150}" style="border-collapse:collapse"><tr>
    <td style="background:#e8edf2;border-radius:6px;height:9px;padding:0"><table role="presentation" cellpadding="0" cellspacing="0" width="${Math.round(pc * 100)}%" style="height:9px"><tr><td style="background:${col};border-radius:6px;height:9px;font-size:0">&nbsp;</td></tr></table></td>
  </tr></table>`;
}
const TH = 'style="text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:7px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap"';
const TD = 'style="font-size:12.5px;color:#20302a;padding:8px;border-bottom:1px solid #eef2f6;vertical-align:top"';

async function build({ day } = {}) {
  const d = day || ksaYesterday();
  const cfg = await llmBudget.config();
  const C = db.console;
  const W = `(at ${KSA})::date = $1::date`;

  const [tot, bySubject, byPurpose, byProvider, byHour, events, month, prev] = await Promise.all([
    C.query(`SELECT count(*)::int calls, coalesce(sum(tokens),0)::bigint tokens, coalesce(sum(prompt_tokens),0)::bigint ptok,
                    coalesce(sum(answer_tokens),0)::bigint ctok, coalesce(sum(cost),0)::numeric cost,
                    count(*) FILTER (WHERE NOT ok AND NOT coalesce(blocked,false))::int failed,
                    count(*) FILTER (WHERE blocked)::int refused,
                    count(*) FILTER (WHERE actor IS NULL)::int unattributed,
                    round(avg(ms))::int avg_ms FROM llm_calls WHERE ${W}`, [d]),
    C.query(`SELECT coalesce(actor,'(unattributed)') subject, count(*)::int calls, coalesce(sum(tokens),0)::bigint tokens,
                    count(*) FILTER (WHERE blocked)::int refused, count(*) FILTER (WHERE NOT ok AND NOT coalesce(blocked,false))::int failed,
                    coalesce(sum(cost),0)::numeric cost, max(at) last_at
             FROM llm_calls WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`, [d]),
    C.query(`SELECT purpose, count(*)::int calls, coalesce(sum(tokens),0)::bigint tokens, round(avg(ms))::int avg_ms
             FROM llm_calls WHERE ${W} GROUP BY 1 ORDER BY 3 DESC LIMIT 8`, [d]),
    C.query(`SELECT provider, count(*)::int calls, coalesce(sum(tokens),0)::bigint tokens, coalesce(sum(cost),0)::numeric cost
             FROM llm_calls WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`, [d]),
    C.query(`SELECT extract(hour FROM (at ${KSA}))::int h, coalesce(sum(tokens),0)::bigint tokens
             FROM llm_calls WHERE ${W} GROUP BY 1 ORDER BY 1`, [d]),
    C.query(`SELECT at, subject, kind, threshold, used, cap, mailed_to FROM llm_budget_events WHERE day = $1::date ORDER BY at`, [d]).catch(() => ({ rows: [] })),
    C.query(`SELECT coalesce(sum(tokens),0)::bigint tokens, count(*)::int calls FROM llm_calls
              WHERE (at ${KSA}) >= date_trunc('month', $1::date) AND (at ${KSA})::date <= $1::date`, [d]),
    C.query(`SELECT coalesce(sum(tokens),0)::bigint tokens FROM llm_calls WHERE (at ${KSA})::date = $1::date - 1`, [d]),
  ]);

  const T = tot.rows[0] || {};
  const tokens = Number(T.tokens || 0), prevTok = Number(prev.rows[0] ? prev.rows[0].tokens : 0);
  const people = [], agents = [];
  for (const r of bySubject.rows) {
    const sub = r.subject;
    const cap = sub === '(unattributed)' ? 0
      : isService(sub) ? Number(cfg.perCaller[sub] ?? cfg.dailyCaller) : Number(cfg.perUser[String(sub).toLowerCase()] ?? cfg.dailyUser);
    const row = { ...r, tokens: Number(r.tokens), cost: Number(r.cost || 0), cap, pct: cap > 0 ? Number(r.tokens) / cap : 0 };
    (isService(sub) ? agents : people).push(row);
  }
  /* name / role / team so the mail says "Akshay Pandey · L2 Digital" and not a login */
  let who = {};
  try { who = await require('./people').basics(C, people.map(p => p.subject).filter(x => String(x).includes('@'))); } catch (_) {}
  const nameOf = e => { const o = who[String(e).toLowerCase()]; if (o && o.name) return o.name;
    const l = String(e).split('@')[0]; return l.split(/[._-]/).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(' '); };
  const roleOf = e => { const o = who[String(e).toLowerCase()] || {}; return [o.role_label, o.team].filter(Boolean).join(' · '); };

  const monthTok = Number(month.rows[0] ? month.rows[0].tokens : 0);
  const dayPct = pctOf(tokens, cfg.dailyGlobal), monthPct = pctOf(monthTok, cfg.monthlyGlobal);
  const delta = prevTok > 0 ? Math.round(100 * (tokens - prevTok) / prevTok) : null;
  const cost = Number(T.cost || 0), cur = (cfg.price && cfg.price.currency) || 'SAR';

  /* ---- KPI strip ---- */
  const kpi = (h, v, s, col) => `<td width="25%" style="padding:0 5px;vertical-align:top">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px"><tr><td style="padding:11px 12px">
      <div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#64748b">${esc(h)}</div>
      <div style="font-size:22px;font-weight:800;color:${col || '#14352a'};margin:2px 0 3px">${v}</div>
      <div style="font-size:11px;color:#64748b;line-height:1.45">${s}</div>
    </td></tr></table></td>`;

  const peopleRows = people.length ? people.map(r => `<tr>
      <td ${TD}><b>${esc(r.subject === '(unattributed)' ? 'Unattributed calls' : nameOf(r.subject))}</b>
        <div style="font-size:11px;color:#64748b">${esc(r.subject === '(unattributed)' ? 'no actor recorded — the app itself, or calls made before per-person metering' : r.subject)}</div>
        ${roleOf(r.subject) ? `<div style="font-size:11px;color:#64748b">${esc(roleOf(r.subject))}</div>` : ''}</td>
      <td ${TD}>${r.cap > 0 ? bar(r.pct) + `<div style="font-size:11px;color:#64748b;margin-top:3px">${tk(r.tokens)} of ${tk(r.cap)} · ${Math.round(r.pct * 100)} %</div>` : '<span style="font-size:11px;color:#64748b">no ceiling</span>'}</td>
      <td ${TD}><b>${tk(r.tokens)}</b></td>
      <td ${TD}>${n(r.calls)}${r.refused ? `<div style="font-size:11px;color:#dc2626">${r.refused} refused</div>` : ''}${r.failed ? `<div style="font-size:11px;color:#64748b">${r.failed} failed</div>` : ''}</td>
      <td ${TD}>${r.cost > 0 ? r.cost.toFixed(2) + ' ' + esc(cur) : '<span style="color:#64748b">on-prem</span>'}</td>
    </tr>`).join('') : `<tr><td ${TD} colspan="5" style="color:#64748b">Nobody used the assistant on this day.</td></tr>`;

  const agentRows = agents.length ? agents.map(r => `<tr>
      <td ${TD}><b>${esc(r.subject === 'salam-agent-incident' ? 'Incident agent' : r.subject === 'salam-agent-log' ? 'Log agent' : r.subject)}</b>
        <div style="font-size:11px;color:#64748b">${esc(r.subject)}</div></td>
      <td ${TD}>${r.cap > 0 ? bar(r.pct) + `<div style="font-size:11px;color:#64748b;margin-top:3px">${tk(r.tokens)} of ${tk(r.cap)} · ${Math.round(r.pct * 100)} %</div>` : '<span style="font-size:11px;color:#64748b">no ceiling</span>'}</td>
      <td ${TD}><b>${tk(r.tokens)}</b></td>
      <td ${TD}>${n(r.calls)}${r.failed ? `<div style="font-size:11px;color:#64748b">${r.failed} failed</div>` : ''}</td>
      <td ${TD}>${r.cost > 0 ? r.cost.toFixed(2) + ' ' + esc(cur) : '<span style="color:#64748b">on-prem</span>'}</td>
    </tr>`).join('') : `<tr><td ${TD} colspan="5" style="color:#64748b">The agents made no calls on this day.</td></tr>`;

  /* hour-by-hour column chart, 24 table cells — renders anywhere */
  const maxH = Math.max(1, ...byHour.rows.map(r => Number(r.tokens)));
  const hours = Array.from({ length: 24 }, (_, h) => {
    const row = byHour.rows.find(r => Number(r.h) === h); const v = row ? Number(row.tokens) : 0;
    const px = Math.max(v > 0 ? 3 : 1, Math.round(60 * v / maxH));
    return `<td valign="bottom" style="padding:0 1px" title="${h}:00 — ${n(v)} tokens">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td height="${60 - px}" style="font-size:0">&nbsp;</td></tr>
      <tr><td height="${px}" style="background:${v > 0 ? '#3b82f6' : '#e2e8f0'};border-radius:3px 3px 0 0;font-size:0">&nbsp;</td></tr></table>
      <div style="font-size:8px;color:#94a3b8;text-align:center;padding-top:2px">${h % 6 === 0 ? h : '&nbsp;'}</div></td>`;
  }).join('');

  const evRows = events.rows.length ? events.rows.map(e => `<tr>
      <td ${TD} style="font-size:11.5px;color:#64748b;padding:8px;border-bottom:1px solid #eef2f6">${new Date(e.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' })}</td>
      <td ${TD}>${esc(String(e.subject).includes('@') ? nameOf(e.subject) : e.subject)}<div style="font-size:11px;color:#64748b">${esc(e.subject)}</div></td>
      <td ${TD}><span style="font-size:11px;font-weight:700;color:${e.threshold === 'over' ? '#dc2626' : '#d97706'}">${e.threshold === 'over' ? 'ceiling reached' : String(e.threshold).replace(/^warn/, '') + ' % warning'}</span></td>
      <td ${TD}>${tk(Number(e.used))} of ${tk(Number(e.cap))}</td>
      <td ${TD} style="font-size:11px;color:#64748b;padding:8px;border-bottom:1px solid #eef2f6">${esc(e.mailed_to || '—')}</td>
    </tr>`).join('') : `<tr><td ${TD} colspan="5" style="color:#64748b">No warning or ceiling was crossed on this day.</td></tr>`;

  const dayLabel = new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const body = `<div style="font-size:13.5px;color:#20302a;line-height:1.6">
    <div style="font-size:12px;color:#64748b;margin-bottom:12px">${esc(dayLabel)} · KSA day, 00:00 → 24:00 Asia/Riyadh. Every figure below is measured from the console's own call log.</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -5px 16px"><tr>
      ${kpi('Tokens', tk(tokens), `${n(T.calls || 0)} calls · ${dayPct} % of the ${tk(cfg.dailyGlobal)} daily ceiling${delta == null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta} % vs the day before`}`, dayPct >= 80 ? '#d97706' : '#14352a')}
      ${kpi('Month to date', tk(monthTok), `${monthPct} % of ${tk(cfg.monthlyGlobal)}`, monthPct >= 80 ? '#d97706' : '#14352a')}
      ${kpi('People', String(people.filter(p => p.subject !== '(unattributed)').length), people.length ? `top ${esc(nameOf(people[0].subject))} ${tk(people[0].tokens)}` : 'nobody used the assistant', '#14352a')}
      ${kpi('Refused', String(T.refused || 0), T.refused ? 'calls stopped by a ceiling' : 'nobody was blocked', (T.refused || 0) > 0 ? '#dc2626' : '#0e9f5a')}
    </tr></table>

    <div style="font-weight:800;font-size:13px;margin:0 0 6px">Tokens by hour (KSA)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;margin-bottom:18px"><tr><td style="padding:12px 10px 6px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${hours}</tr></table>
      <div style="font-size:11px;color:#64748b;padding-top:4px">peak ${tk(maxH)} tokens in one hour · ${T.avg_ms ? n(T.avg_ms) + ' ms average per call' : 'no calls'}</div>
    </td></tr></table>

    <div style="font-weight:800;font-size:13px;margin:0 0 6px">People</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;border-collapse:separate;margin-bottom:18px">
      <tr><th ${TH}>Who</th><th ${TH}>Against the ceiling</th><th ${TH}>Tokens</th><th ${TH}>Calls</th><th ${TH}>Cost</th></tr>${peopleRows}</table>

    <div style="font-weight:800;font-size:13px;margin:0 0 6px">Agents (services)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;border-collapse:separate;margin-bottom:18px">
      <tr><th ${TH}>Service</th><th ${TH}>Against the ceiling</th><th ${TH}>Tokens</th><th ${TH}>Calls</th><th ${TH}>Cost</th></tr>${agentRows}</table>

    <div style="font-weight:800;font-size:13px;margin:0 0 6px">What the tokens were spent on</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;border-collapse:separate;margin-bottom:18px">
      <tr><th ${TH}>Purpose</th><th ${TH}>Tokens</th><th ${TH}>Calls</th><th ${TH}>Average</th></tr>
      ${byPurpose.rows.length ? byPurpose.rows.map(r => `<tr><td ${TD}>${esc(r.purpose || '—')}</td><td ${TD}><b>${tk(Number(r.tokens))}</b></td><td ${TD}>${n(r.calls)}</td><td ${TD} style="color:#64748b;font-size:12px;padding:8px;border-bottom:1px solid #eef2f6">${n(r.avg_ms)} ms</td></tr>`).join('')
      : `<tr><td ${TD} colspan="4" style="color:#64748b">No calls.</td></tr>`}</table>

    <div style="font-weight:800;font-size:13px;margin:0 0 6px">Warnings and ceilings crossed</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;border-collapse:separate;margin-bottom:18px">
      <tr><th ${TH}>Time</th><th ${TH}>Subject</th><th ${TH}>Line</th><th ${TH}>Used</th><th ${TH}>Mailed to</th></tr>${evRows}</table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:10px;margin-bottom:16px"><tr><td style="padding:11px 13px;font-size:12px;color:#334155;line-height:1.6">
      <b>Where it ran.</b> ${byProvider.rows.map(r => `${esc(r.provider)} — ${tk(Number(r.tokens))} tokens, ${n(r.calls)} calls${Number(r.cost) > 0 ? `, ${Number(r.cost).toFixed(2)} ${esc(cur)}` : ', no external cost'}`).join(' · ') || 'no calls'}.
      ${T.unattributed ? `<br><b style="color:#b45309">${n(T.unattributed)} calls carried no actor</b> and are not counted against any person's ceiling.` : ''}
      ${cost > 0 ? `<br>Total external cost for the day: <b>${cost.toFixed(2)} ${esc(cur)}</b>.` : '<br>Everything ran on our own server — no external cost.'}
    </td></tr></table>

    <a href="${notify.CONSOLE_URL}#settings-agents" style="display:inline-block;background:#0e9f5a;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:9px 16px;border-radius:9px">Open AI usage &amp; budget</a>
    <div style="color:#64748b;font-size:12px;margin-top:12px">Ceilings in force: ${tk(cfg.dailyUser)} per person/day · ${tk(cfg.dailyCaller)} per agent/day · ${tk(cfg.dailyGlobal)} for the console/day · ${tk(cfg.monthlyGlobal)}/month. Warnings at ${cfg.warnSteps.map(x => Math.round(x * 100) + ' %').join(' and ')}, ${cfg.block ? 'AI answers pause over 100 %' : 'warn only — nothing is blocked'}.</div>
  </div>`;

  const html = notify.shell({ title: 'AI usage & budget — daily recap', badge: 'OPERATIONS CONSOLE · AI',
    pill: tk(tokens) + ' TOKENS', pillColor: dayPct >= 100 ? '#dc2626' : dayPct >= 80 ? '#d97706' : '#0e9f5a', bodyHtml: body });

  return { day: d, subject: `[Salam Ops] AI usage — ${dayLabel} · ${tk(tokens)} tokens, ${n(T.calls || 0)} calls`, html,
    stats: { day: d, tokens, calls: T.calls || 0, refused: T.refused || 0, unattributed: T.unattributed || 0, people: people.length, agents: agents.length, events: events.rows.length, monthTok, dayPct } };
}

/* who gets the recap — super admins, exactly like the threshold mails */
async function digestRecipients() {
  const r = await db.console.query(
    `SELECT email, name FROM console_users WHERE enabled AND (role='super_admin' OR 'super_admin'=ANY(coalesce(roles,'{}'))) ORDER BY email`).catch(() => ({ rows: [] }));
  return r.rows;
}

async function send({ to, day } = {}) {
  const m = await build({ day });
  const list = to ? (Array.isArray(to) ? to : String(to).split(/[,;\s]+/)).filter(Boolean).map(e => ({ email: e })) : await digestRecipients();
  if (!list.length) return { sent: false, to: '', subject: m.subject, error: 'no recipient' };
  const r = await notify.sendHtml(list, m.subject, m.html, []);
  return { sent: !!r.sent, error: r.error || null, to: list.map(x => x.email).join(', '), subject: m.subject, stats: m.stats };
}

/* once per KSA day, at or after DIGEST_HOUR — called from the agent-log tick */
const HOUR = Number(process.env.LLM_DIGEST_HOUR || 0);
async function maybeSend(now) {
  const settings = require('./settings');
  const cfg = await llmBudget.config();
  if (cfg.digest === false) return null;
  const nowKsa = new Date((now || new Date()).getTime() + 3 * 3600e3);
  const today = nowKsa.toISOString().slice(0, 10), hour = Number(nowKsa.toISOString().slice(11, 13));
  if (hour < HOUR) return null;
  const st = (await settings.getSetting('llm_budget_digest')) || {};
  if (st.lastDay === today) return null;
  const out = await send({ day: ksaYesterday() });
  await settings.setSetting('llm_budget_digest', { ...st, lastDay: today, lastAt: new Date().toISOString(), last: out.stats || null, ok: out.sent });
  return out;
}

module.exports = { build, send, maybeSend, digestRecipients, ksaToday, ksaYesterday };
