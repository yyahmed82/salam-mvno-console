/* Salam Digital Console — L1 workshop, SESSION 2 (Wednesday 26 August 2026, 11:00–13:00 KSA).
 *
 * Same template as session 1 (build-l1-session1-deck.js): LAYOUT_WIDE, dark dividers, green
 * numbered badges, light cards, clickable pill buttons — REQUIRES the post-processor:
 *
 *   node tools/build-l1-session2-deck.js
 *   python3 tools/pptx-shape-links.py "<the .pptx>"     ← makes the whole pill clickable
 *
 * VOICE: warm and respectful — the register of a lead speaking to their own team. Encouraging,
 * plain, courteous; no banter, no jokes at anyone's expense, no informal instructions to the
 * room. Every number is measured (25 Aug data); anything derived says so.
 *
 * SHAPE (per Yosri's brief):
 *   recap (6 topics of session 1) → what shipped SINCE session 1 (real overnight work — the
 *   motivational beat) → Kahoot (10 easy questions; also exported as a paste-ready txt) →
 *   Part 1 alerts round 2 + LIVE config of the P1/P2 API-latency pair → Part 2 monitoring &
 *   correlations (UPG · APIGW · SMS · ServiceNow) → Part 3 documentation → Part 4 responsive +
 *   dark theme → Part 5 SLAs → live "what do you do?" cases → close.
 */
'use strict';
const pptxgen = require('pptxgenjs');

const OUT = process.env.OUT_FILE
  || '/sessions/upbeat-happy-archimedes/mnt/Salam DMS/Salam-Console-L1-Session2-26Aug2026.pptx';

const INK = '11241D', GREEN = '00A651', DARK = '0B3B2E', MUTED = '5F6F69',
      LIGHT = 'F2F6F3', AMBER = 'B26B00', RED = 'B3261E', BLUE = '2563EB',
      VIOLET = '7C3AED', WHITE = 'FFFFFF';
const BODY = 'Calibri', HEAD = 'Calibri';

const BASE = 'salam.sa/digital-console/';
const url = h => BASE + '#' + h;
const href = h => 'https://' + url(h);
function shortLabel(h) {
  const [route, qs] = String(h).split('?');
  if (!qs) return '#' + route;
  const m = /(?:^|&)(cls|tab|cat|id)=([^&]+)/.exec(qs);
  return m ? '#' + route + ' · ' + m[2] : '#' + route;
}

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Yosri A Yahmed';
pres.title = 'Salam Digital Console — L1 workshop, session 2';

let page = 0;
function footer(s, dark) {
  page++;
  s.addText('Salam Digital Console · L1 workshop · session 2 · 26 August 2026',
    { x: 0.55, y: 7.02, w: 8, h: 0.3, fontSize: 9, color: dark ? '9FC7B4' : MUTED, fontFace: BODY, margin: 0 });
  s.addText(String(page),
    { x: 12.3, y: 7.02, w: 0.5, h: 0.3, fontSize: 9, color: dark ? '9FC7B4' : MUTED, fontFace: BODY, align: 'right', margin: 0 });
}
let badge = 0;
function header(s, kicker, title) {
  badge++;
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 0.42, w: 0.46, h: 0.46, fill: { color: GREEN }, rectRadius: 0.1, line: { color: GREEN } });
  s.addText(String(badge), { x: 0.55, y: 0.42, w: 0.46, h: 0.46, fontSize: 15, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: HEAD, margin: 0 });
  s.addText(kicker.toUpperCase(), { x: 1.18, y: 0.36, w: 11.5, h: 0.26, fontSize: 10, bold: true, color: GREEN, charSpacing: 1.2, fontFace: BODY, margin: 0 });
  s.addText(title, { x: 1.15, y: 0.6, w: 11.6, h: 0.5, fontSize: 24, bold: true, color: INK, fontFace: HEAD, margin: 0 });
}
function divider(s, n, kicker, title, sub) {
  s.background = { color: DARK };
  s.addText(`PART ${n} OF 5`, { x: 0.7, y: 2.2, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText(kicker, { x: 0.7, y: 2.7, w: 11.9, h: 0.9, fontSize: 38, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText(title, { x: 0.7, y: 3.75, w: 11.5, h: 0.5, fontSize: 16, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  if (sub) s.addText(sub, { x: 0.7, y: 4.35, w: 11.5, h: 0.9, fontSize: 13, color: '8FC3A8', fontFace: BODY, margin: 0, lineSpacing: 18 });
  footer(s, true);
}
function cards(s, list, { x0 = 0.55, y0 = 1.5, cols = 3, w = 3.9, h = 1.58, gapx = 4.15, gapy = 1.78, fs = 10.5 } = {}) {
  list.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = x0 + col * gapx, y = y0 + row * gapy;
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.24, y: y + 0.26, w: 0.2, h: 0.2, fill: { color: c[2] || GREEN }, line: { color: c[2] || GREEN } });
    s.addText(c[0], { x: x + 0.55, y: y + 0.16, w: w - 0.75, h: 0.34, fontSize: 13, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(c[1], { x: x + 0.55, y: y + 0.54, w: w - 0.75, h: h - 0.62, fontSize: fs, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 14 });
  });
}
function btn(s, { x, y, w, h = 0.34, hash, label, tone = 'solid' }) {
  const solid = tone === 'solid';
  const link = { url: href(hash), tooltip: url(hash) };
  const runFace = { bold: true, hyperlink: link, color: solid ? WHITE : DARK, underline: false };
  s.addText([{ text: label || ('#' + hash), options: runFace }, { text: '  ↗', options: runFace }], {
    shape: pres.ShapeType.roundRect, rectRadius: h / 2.2, x, y, w, h,
    fill: { color: solid ? GREEN : 'EAF7F0' }, line: { color: solid ? GREEN : 'B8E0CC', width: 1 },
    color: solid ? WHITE : DARK, fontSize: h <= 0.3 ? 9 : 10, fontFace: BODY,
    align: 'center', valign: 'middle', margin: 0,
  });
}
function urlbar(s, y, label, hashes, w = 12.2, x = 0.55) {
  const list = Array.isArray(hashes) ? hashes : [hashes];
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.52, fill: { color: 'F4FAF6' }, line: { color: 'D6EBDF' }, rectRadius: 0.07 });
  s.addText('TRY IT', { x: x + 0.18, y: y + 0.11, w: 0.7, h: 0.3, fontSize: 8.5, bold: true, color: GREEN, charSpacing: 0.8, fontFace: BODY, margin: 0, valign: 'middle' });
  const MIN_TEXT = label ? 1.9 : 0;
  const bw = Math.min(2.4, (w - 1.05 - MIN_TEXT) / list.length - 0.12);
  const textW = w - 1.05 - list.length * (bw + 0.12);
  if (label) s.addText(label, { x: x + 0.92, y: y + 0.11, w: textW, h: 0.3, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, valign: 'middle' });
  list.forEach((hsh, i) => {
    btn(s, { x: x + w - 0.18 - (list.length - i) * (bw + 0.12) + 0.12, y: y + 0.09, w: bw, h: 0.34, hash: hsh, label: shortLabel(hsh) });
  });
}
function table(s, head, rows, { x = 0.55, y = 1.5, w = 12.2, colW, fs = 11, rowH = 0.34 } = {}) {
  s.addTable([head.map(h => ({ text: h, options: { bold: true, color: WHITE, fill: { color: DARK }, fontSize: fs, fontFace: HEAD } }))]
    .concat(rows.map(r => r.map(c => (typeof c === 'object' ? c : { text: String(c), options: { color: INK, fontSize: fs, fontFace: BODY } })))),
    { x, y, w, colW, border: { pt: 0.5, color: 'DDE7E1' }, autoPage: false, rowH, valign: 'middle', margin: 0.06 });
}
function points(s, x, y, w, items, gap) {
  items.forEach((it, i) => {
    const yy = y + i * gap;
    s.addShape(pres.ShapeType.ellipse, { x, y: yy + 0.08, w: 0.13, h: 0.13, fill: { color: GREEN }, line: { color: GREEN } });
    s.addText(
      [{ text: it[0], options: { bold: true, color: INK } },
       { text: '  ' + it[1], options: { color: MUTED } }],
      { x: x + 0.24, y: yy - 0.03, w: w - 0.24, h: gap, fontSize: 11.5, fontFace: BODY, margin: 0, valign: 'top', lineSpacing: 15 });
  });
}

/* ============================================================ 1 · title */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Salam · DIGITAL CONSOLE · L1 · SESSION 2', { x: 0.7, y: 0.75, w: 9, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('Alerts, monitoring and SLAs', { x: 0.7, y: 1.3, w: 11.9, h: 1.0, fontSize: 46, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('In session 1 we learned to read the console. Today we set it up to reach you —\nby mail with a full report, by Teams, and by WhatsApp — and we practise responding.', { x: 0.7, y: 2.35, w: 11.5, h: 0.8, fontSize: 16, color: 'BFE3CF', fontFace: BODY, margin: 0, lineSpacing: 22 });
  const stats = [
    ['3', 'alert channels live:\nmail+PDF · Teams · WhatsApp'],
    ['13', 'error screens per journey —\nevery failure now has a face'],
    ['10', 'quiz questions to warm up\n— a short, friendly recap'],
    ['5', 'real cases we work through\ntogether, step by step'],
  ];
  stats.forEach((c, i) => {
    const x = 0.7 + i * 3.1;
    s.addShape(pres.ShapeType.roundRect, { x, y: 4.1, w: 2.9, h: 1.7, fill: { color: '10493A' }, rectRadius: 0.08, line: { color: '1B5E4A' } });
    s.addText(c[0], { x, y: 4.28, w: 2.9, h: 0.7, fontSize: 34, bold: true, color: '7FD3A6', align: 'center', fontFace: HEAD, margin: 0 });
    s.addText(c[1], { x: x + 0.15, y: 4.98, w: 2.6, h: 0.75, fontSize: 10.5, color: 'CFE9DB', align: 'center', fontFace: BODY, margin: 0, lineSpacing: 13 });
  });
  s.addText('Wednesday 26 August 2026 · 11:00–13:00 KSA · please bring a laptop and your phone — both are used in the exercises',
    { x: 0.7, y: 6.2, w: 12, h: 0.4, fontSize: 13, color: '9FC7B4', fontFace: BODY, margin: 0 });
  footer(s, true);
}

/* ============================================================ 2 · recap */
{
  const s = pres.addSlide();
  header(s, 'recap · 10 minutes', 'Session 1 in six topics — please stop me on anything you would like revisited');
  cards(s, [
    ['1 · Dashboard', 'Home KPIs, payment gauges, App screens flow, Order status tree. "What does normal look like?" — the baseline you now recognise.', GREEN],
    ['2 · Alerts & rules', 'P1/P2/P3, ack / snooze / resolve, the Guide button, and the 66 rules evaluated continuously.', AMBER],
    ['3 · Yusr + Subscriber 360', 'One customer, the whole picture: plan, payments, OTPs, orders — available while you are still on the call.', BLUE],
    ['4 · Troubleshoot', 'Live failures with business/technical tags and end-to-end traces: app → gateway → BSS/UPG.', RED],
    ['5 · Raising tickets', 'Five lines that let L2 start immediately: what, when, who, evidence reference, and what you already checked.', VIOLET],
    ['6 · Users & roles', 'Who sees what: report managers read, super admins configure — and every export is audited.', MUTED],
  ]);
  urlbar(s, 6.15, 'Open these before we begin', ['dashboard', 'alerts', 'troubleshoot']);
  footer(s);
}

/* ============================================================ 3 · shipped since session 1 */
{
  const s = pres.addSlide();
  header(s, 'since yesterday', 'What has been added since our first session');
  s.addText('Each item below went live between session 1 and this morning, and most of it came directly from questions and tickets raised by this team.',
    { x: 0.55, y: 1.28, w: 12.2, h: 0.3, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0 });
  cards(s, [
    ['Alerts now reach you', 'Mail carries a per-alert PDF report (KPIs, evidence, action plan). Teams posts a card to MVNO Console. WhatsApp buzzes the on-call phones.', GREEN],
    ['Error states everywhere', 'Every journey — not just payments — shows its failure screens: eligibility, Nafath, activation, delivery. Click any to drill + export.', RED],
    ['Eligibility counted correctly', 'Customers who left before the ID form were counted as refusals. They are now reported separately from genuine refusals — a correction the L2 team asked for.', AMBER],
    ['Nafath failures reclassified', 'A terminal Nafath status = customer/CITC outcome = BUSINESS. Technical Nafath = failed API calls, a different page. No more fake incidents.', BLUE],
    ['Everyday usability', 'The time filter stays visible while scrolling, journeys have navigation arrows and step dots, and the plan filter shows status and live counts (TKT-000007, now closed).', VIOLET],
    ['One year of answers', '12-month catalogues for payments, eligibility, BSS and Nafath, as monthly Excel and PDF — so questions about history can be answered with data.', MUTED],
  ], { fs: 10 });
  s.addText('Your tickets and questions shape this console directly. Please keep raising them on the Tickets & feedback page.',
    { x: 0.55, y: 6.35, w: 12.2, h: 0.3, fontSize: 11.5, bold: true, color: DARK, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ============================================================ 4 · Kahoot */
{
  const s = pres.addSlide();
  header(s, 'quiz · 15 minutes', 'A short quiz — ten questions from session 1');
  points(s, 0.6, 1.6, 6.6, [
    ['How it works.', 'kahoot.it on your phone · game PIN on screen · 10 questions · 20 seconds each. All from session 1 — and none of them are difficult.'],
    ['Why we do it.', 'Not to rank anyone. It is a quick way to confirm how much of session 1 is already familiar, and to show where a short refresher would help.'],
    ['Format.', 'Answers are anonymous on screen if you prefer — use a nickname. We will pause after any question the group finds tricky and go over it together.'],
    ['For the host.', 'The questions and answers are prepared in advance (import file in the project folder), 20-second timer. Maximum 15 participants per session.'],
  ], 1.05);
  s.addShape(pres.ShapeType.roundRect, { x: 7.6, y: 1.6, w: 5.15, h: 4.4, fill: { color: DARK }, rectRadius: 0.1 });
  s.addText('SAMPLE FLAVOUR', { x: 7.9, y: 1.85, w: 4.6, h: 0.3, fontSize: 10, bold: true, color: '7FD3A6', charSpacing: 1.5, fontFace: BODY, margin: 0 });
  s.addText('"A payment shows Declined, Insufficient Funds.\nWho resolves it?"', { x: 7.9, y: 2.25, w: 4.6, h: 0.8, fontSize: 14, bold: true, color: WHITE, fontFace: BODY, margin: 0, lineSpacing: 18 });
  s.addText('A) Salam IT\nB) The customer\'s bank / available balance\nC) UPG support\nD) Raise a P1', { x: 7.9, y: 3.15, w: 4.6, h: 1.3, fontSize: 12.5, color: 'CFE9DB', fontFace: BODY, margin: 0, lineSpacing: 20 });
  s.addText('The answer is B — a business outcome, not a platform fault.', { x: 7.9, y: 4.75, w: 4.6, h: 0.6, fontSize: 11, italic: true, color: '9FC7B4', fontFace: BODY, margin: 0 });
  footer(s);
}

/* ============================================================ P1 divider */
{ divider(pres.addSlide(), 1, 'Alerts, round two', 'The console can now reach you on three channels',
  'Mail with a PDF report attached, a card in the MVNO Console Teams channel, and WhatsApp to the on-call numbers.\nWe will also configure a real P1/P2 pair together.'); }

/* ============================================================ 5 · channels */
{
  const s = pres.addSlide();
  header(s, 'part 1 · alerts', 'One incident, three channels — the same information in each');
  table(s, ['Channel', 'What arrives', 'When to rely on it'], [
    ['📧 Mail', 'Digest + ONE PDF PER FIRING ALERT: what it means, KPIs, the failing APIs with a real request/response, history, numbered action plan.', 'At your desk. The PDF is the briefing — worth reading before escalating.'],
    ['💬 Teams · MVNO Console channel', 'Adaptive card: severity, metric, observed, "Open incident" button that lands you on the Guide.', 'The shared team view — discuss in the thread and keep the record.'],
    ['📱 WhatsApp', 'Template message to each on-call phone: severity · name · observed · link. 1:1 by design (the API does not do groups).', 'When you are away from your desk. It reaches the on-call person directly, which is why it is reserved for what matters.'],
  ], { y: 1.5, colW: [2.6, 6.0, 3.6], fs: 10.5, rowH: 0.85 });
  points(s, 0.6, 4.6, 12, [
    ['The deep links are smart now.', 'A firing alert opens the incident and its Guide; a healthy rule opens the rule editor. No searching required.'],
    ['Set your own notifications.', 'Teams: MVNO Console channel → Channel notifications → All new posts. Each person sets this individually — it takes about twenty seconds.'],
  ], 0.75);
  urlbar(s, 6.15, 'The alert pages', ['alerts', 'settings-notify']);
  footer(s);
}

/* ============================================================ 6 · live config exercise */
{
  const s = pres.addSlide();
  header(s, 'part 1 · hands-on', 'Together: configuring the API-latency P1/P2 pair');
  s.addText('Why this rule: a slow API affects the call centre before anything looks broken — customers retry and queues build while no system is formally down. The P2 warns; the P1 pages.',
    { x: 0.55, y: 1.3, w: 12.2, h: 0.45, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0 });
  table(s, ['Step', 'Who clicks', 'What we set'], [
    ['1 · Open Alerts → Alert rules', 'one participant', 'Find api_latency_p95 and read its current threshold and runbook'],
    ['2 · Edit the P2', 'same participant', 'Threshold ≥ 1.0 (100% of the per-API override) · window 1h · min sample 40 · team Digital Ops'],
    ['3 · Create the P1 sibling', 'another participant', 'Same metric · threshold ≥ 2.0 · P1 · runbook: "check Monitoring→API health p95 table, name the API, page L2"'],
    ['4 · Send test', 'another participant', 'Settings → Notifications → Send test (P2) — phones buzz, Teams card lands, mail arrives with PDF'],
    ['5 · Read the PDF together', 'everyone', 'Find: the breaching API, the p95 table, the real request/response, the action plan'],
  ], { y: 1.85, colW: [3.4, 2.2, 6.6], fs: 10.5, rowH: 0.62 });
  s.addText('Our standard: every rule carries a runbook. An alert without one tells you that something happened, but not what to do about it.',
    { x: 0.55, y: 5.35, w: 12.2, h: 0.35, fontSize: 11.5, bold: true, color: DARK, fontFace: BODY, margin: 0 });
  urlbar(s, 6.15, 'Everything for this exercise', ['alerts', 'settings-notify', 'monitoring?tab=gateway']);
  footer(s);
}

/* ============================================================ P2 divider */
{ divider(pres.addSlide(), 2, 'Monitoring & correlations', 'One incident is rarely isolated — following the connections',
  'UPG and payments, APIGW traces, SMS, and ServiceNow tickets. The core L1 skill is connecting these signals,\nnot simply collecting them.'); }

/* ============================================================ 7 · monitoring tour */
{
  const s = pres.addSlide();
  header(s, 'part 2 · monitoring', 'Six tabs, ordered the way a request travels through the platform');
  table(s, ['Tab', 'Watches', 'The call-centre question it answers'], [
    ['Gateway', 'APIGW nodes, API p95/error rates', '"The app is slow": which API, and since when'],
    ['Payments', 'UPG health, stuck & duplicates', '"Money taken, no recharge": did UPG capture the payment?'],
    ['Access', 'Login, OTP, Nafath', '"I cannot log in": platform-wide, or this customer only?'],
    ['SMS', 'OTP delivery, provider health', '"No code received": sent, delivered, or a provider issue?'],
    ['Delivery', 'Courier states, stuck shipments', '"Where is my SIM?": courier side or ours'],
    ['Resellers', 'tygo/soob activity', 'Partner order storms & courier backlogs'],
  ], { y: 1.5, colW: [2.0, 4.6, 5.6], fs: 10.5, rowH: 0.52 });
  points(s, 0.6, 4.9, 12, [
    ['Health chips are clickable.', 'Every chip opens the evidence behind it. Green is the summary; the drill-down is the proof.'],
  ], 0.6);
  urlbar(s, 6.15, 'The tabs', ['monitoring?tab=gateway', 'monitoring?tab=payments', 'monitoring?tab=sms']);
  footer(s);
}

/* ============================================================ 8 · correlations */
{
  const s = pres.addSlide();
  header(s, 'part 2 · correlations', 'The console links these sources for you');
  cards(s, [
    ['Payment ⇄ UPG', 'Any failed payment → trace → every gateway attempt on that reference, the bank\'s exact answer, the full charge object. No need to raise a request and wait.', GREEN],
    ['Transaction ⇄ APIGW', 'A transaction id opens the end-to-end trace: app call → gateway spans → request/response bodies → BSS. Timeouts show WHERE the time went.', BLUE],
    ['Alert ⇄ ServiceNow', 'Open incident → Related tickets: the SN incidents matching that journey and window. If ServiceNow already has it, add to that ticket — rather than opening a duplicate.', VIOLET],
    ['Alert ⇄ alert', 'Correlation marks root vs child: a BSS root suppresses its activation children. One incident is paged once, not five times.', AMBER],
    ['SMS ⇄ OTP', 'An OTP complaint traces to the SMS attempt and provider answer. "Not received" becomes "rejected by the provider at 14:02".', RED],
    ['Everything ⇄ export', 'Every popup exports to Excel, audited, with PII masked by default — evidence for a ticket in two clicks.', MUTED],
  ], { fs: 10 });
  urlbar(s, 6.15, 'See a correlation live', ['troubleshoot', 'alerts']);
  footer(s);
}

/* ============================================================ P3 divider + docs */
{ divider(pres.addSlide(), 3, 'Documentation', 'Most answers are already documented',
  'Salam API documentation, Tap/UPG codes, a runbook on every rule, and the tickets page where your suggestions are tracked.'); }
{
  const s = pres.addSlide();
  header(s, 'part 3 · documentation', 'Where to look first — usually faster than asking');
  table(s, ['Where', 'What lives there', 'Use it when'], [
    ['#salamdocs', 'Salam Digital API reference — every endpoint, request and response fields', 'You see an API name in a trace and want to know what it does'],
    ['#tapdocs', 'Tap/UPG response codes — official meaning of every decline code', 'A payment declined with a code you don\'t recognise'],
    ['#apidocs', 'Console API docs', 'You (or a script) want data out of the console'],
    ['Rule runbooks', 'On every alert rule — steps written by the people who fixed it last time', 'An alert fires — the Guide button walks through it step by step'],
    ['#tickets', 'Suggestions & issues — with status and email updates', 'You have an issue or an idea — TKT-000007 became a feature within a day'],
  ], { y: 1.5, colW: [2.4, 5.6, 4.2], fs: 10.5, rowH: 0.62 });
  urlbar(s, 6.15, 'Worth bookmarking', ['salamdocs', 'tapdocs', 'tickets']);
  footer(s);
}

/* ============================================================ P4 divider + responsive/dark */
{ divider(pres.addSlide(), 4, 'Your console, your way', 'Works on mobile, and comfortable at night',
  'Incidents do not wait until you reach a desk, and a bright screen is not welcome on a night shift.'); }
{
  const s = pres.addSlide();
  header(s, 'part 4 · comfort', 'Mobile and dark theme — for work outside office hours');
  points(s, 0.6, 1.6, 12, [
    ['It works on your phone.', 'The alert link opens the incident on mobile: acknowledge, read the Guide and decide from wherever you are. We will try it with the test alert from Part 1.'],
    ['Dark theme: the moon icon, top right.', 'Saved per user. On a night shift this is a practical difference, not a cosmetic one.'],
    ['The range bar follows you.', 'The time filter stays under the header as you scroll, so changing 3h to 24h no longer means scrolling twice.'],
    ['Lanes have arrows and dots.', 'In App screens flow, arrows move through the journey and the dots jump to a step; red dots are the error screens.'],
    ['Live exercise (2 min).', 'Please open the console on your phone from the test message and switch to dark theme, so you know it works before you need it.'],
  ], 0.95);
  urlbar(s, 6.15, 'On your phone', ['dashboard', 'alerts']);
  footer(s);
}

/* ============================================================ P5 divider + SLA */
{ divider(pres.addSlide(), 5, 'SLAs', 'The clock starts when the alert fires',
  'Acknowledge promptly, resolve accurately, escalate on time. The SLA page keeps all three visible.'); }
{
  const s = pres.addSlide();
  header(s, 'part 5 · SLAs', 'What the numbers mean, and how we influence them');
  table(s, ['Measure', 'Meaning', 'Current 30-day', 'Target habit'], [
    ['MTTA', 'Fired → someone pressed Ack', '~30 min', 'P1 within minutes. Acknowledging is not resolving — it confirms someone owns it'],
    ['MTTR', 'Fired → resolved', '~1.4 h', 'Resolve when the metric recovers, not when the calls stop'],
    ['Escalation ladder', 'Unacked P1/P2 pages the next tier after N minutes', 'configured per severity', 'The ladder is a safety net for the team, not a judgement'],
    ['Breach count', 'How many cycles an incident stayed open', 'per incident', 'A high breach count means the incident stayed open unattended — that is what we want to avoid'],
  ], { y: 1.5, colW: [2.4, 4.6, 2.4, 2.8], fs: 10.5, rowH: 0.7 });
  points(s, 0.6, 4.7, 12, [
    ['The honest rule.', 'Snoozing with a note is better than resolving prematurely: a premature resolve re-fires shortly after and the timeline records it.'],
  ], 0.6);
  urlbar(s, 6.15, 'The SLA page', ['sla', 'alerts']);
  footer(s);
}

/* ============================================================ live cases */
{
  const s = pres.addSlide();
  header(s, 'hands-on · 30 minutes', 'Five real cases — we work through them together');
  table(s, ['#', 'The situation', 'The question for the group'], [
    ['1', 'Your phone buzzes: WhatsApp P2 — per-API latency breached, observed 1.78.', 'First click? (Open link → Guide → Monitoring→API health → name the API)'],
    ['2', 'Call centre: "customer paid the invoice twice, money gone twice".', 'Which page confirms it quickly? (Troubleshoot → duplicates → UPG trace → both charge objects)'],
    ['3', 'Teams card: Nafath failures climbing — 27 in the window.', 'Business or technical, and who is paged? (Terminal Nafath statuses are business — no page required)'],
    ['4', 'Dashboard: MNP lane shows 0 activated for 3 hours, New SIM lane normal.', 'Real or artifact? (Order tree → MNP lane → where do orders pile up → related SN tickets)'],
    ['5', '"The app is slow" — 4 calls in 10 minutes, nothing is red.', 'Where is slow visible before it is red? (Monitoring p95 table + latency alert thresholds)'],
  ], { y: 1.5, colW: [0.7, 6.3, 5.2], fs: 10, rowH: 0.72 });
  s.addText('Format: one participant shares their screen and the group suggests the next step, about three minutes per case. Exploring a wrong turn is part of the exercise.',
    { x: 0.55, y: 5.5, w: 12.2, h: 0.35, fontSize: 11, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  urlbar(s, 6.15, 'Starting points for the cases', ['alerts', 'troubleshoot', 'monitoring?tab=gateway', 'dashboard']);
  footer(s);
}

/* ============================================================ close */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Thank you — the console is yours to run.', { x: 0.7, y: 1.9, w: 12, h: 0.8, fontSize: 34, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Suggested follow-up this week (about 15 minutes)', { x: 0.7, y: 3.0, w: 11, h: 0.4, fontSize: 15, bold: true, color: '7FD3A6', fontFace: BODY, margin: 0 });
  s.addText('1.  Set the MVNO Console channel notifications to "All new posts".\n2.  On the next real alert: open the PDF first, follow the runbook, and note anything it was missing.\n3.  Raise one ticket on the Tickets page — an issue, a suggestion, or an idea.\n4.  We will open session 3 with a short recap quiz.',
    { x: 0.7, y: 3.5, w: 11.8, h: 1.8, fontSize: 14, color: 'CFE9DB', fontFace: BODY, margin: 0, lineSpacing: 24 });
  s.addText('Questions are welcome any time, in the MVNO Console Teams channel or directly.',
    { x: 0.7, y: 5.7, w: 11.8, h: 0.4, fontSize: 12, color: '9FC7B4', fontFace: BODY, margin: 0 });
  footer(s, true);
}

pres.writeFile({ fileName: OUT }).then(() => console.log('wrote', OUT));
