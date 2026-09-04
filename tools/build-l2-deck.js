/* Salam Digital Console — L2 update deck (what shipped since 13 Aug 2026 + L1 workshop plan).
 *
 * Screenshots: taken 22 Aug 2026, browser chrome cropped (shots/sNN_c.png). Several are cropped
 * further to the modal or the first journey row (sNN_modal / sNN_row / s01_top / s02_drawer):
 * a full-page screenshot shrunk to 8" is unreadable, and a half-sliced table row looks like a bug.
 *
 * Every number written beside a screenshot is read off THAT screenshot. Nothing is estimated —
 * if a figure is not visible in the picture, it is not on the slide.
 *
 * Build:  node tools/build-l2-deck.js      (needs pptxgenjs; SHOTS_DIR + OUT_FILE overridable)
 */
'use strict';
const pptxgen = require('pptxgenjs');
const path = require('path');

const SHOTS = process.env.SHOTS_DIR || '/sessions/upbeat-happy-archimedes/shots';
const OUT = process.env.OUT_FILE || '/sessions/upbeat-happy-archimedes/mnt/outputs/Salam-Digital-Console-L2-Update-22Aug2026.pptx';
const fs = require('fs');
/* prefer the optimised .jpg written by tools/optimize-shots.py; the .png stays the master */
const pick = base => { const j = base.replace(/\.png$/, '.jpg'); return fs.existsSync(j) ? j : base; };
const img = n => pick(path.join(SHOTS, `s${String(n).padStart(2, '0')}_c.png`));
const cut = name => pick(path.join(SHOTS, `${name}.png`));

const INK = '11241D', GREEN = '00A651', DARK = '0B3B2E', MUTED = '5F6F69',
      LIGHT = 'F2F6F3', AMBER = 'B26B00', WHITE = 'FFFFFF';
const BODY = 'Calibri', HEAD = 'Calibri';
const NB = ' ';   // keep a value and its unit on one line

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';                 // 13.33 x 7.5
pres.author = 'Yosri A Yahmed';
pres.title  = 'Salam Digital Console — L2 update, 22 August 2026';

const shadow = () => ({ type: 'outer', color: '9AA8A2', blur: 14, offset: 3, angle: 90, opacity: 0.45 });

/* one footer for every slide — the page counter is the slide index, always */
let page = 0;
function footer(s, dark) {
  page++;
  s.addText('Salam Digital Console · L2 update · 22 August 2026',
    { x: 0.55, y: 7.02, w: 8, h: 0.3, fontSize: 9, color: dark ? '9FC7B4' : MUTED, fontFace: BODY, margin: 0 });
  s.addText(String(page),
    { x: 12.3, y: 7.02, w: 0.5, h: 0.3, fontSize: 9, color: dark ? '9FC7B4' : MUTED, fontFace: BODY, align: 'right', margin: 0 });
}

/* header: green badge + kicker + title. The badge is the deck's one repeated motif. */
let badge = 0;
function header(s, kicker, title) {
  badge++;
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 0.42, w: 0.46, h: 0.46, fill: { color: GREEN }, rectRadius: 0.1, line: { color: GREEN } });
  s.addText(String(badge), { x: 0.55, y: 0.42, w: 0.46, h: 0.46, fontSize: 15, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: HEAD, margin: 0 });
  s.addText(kicker.toUpperCase(), { x: 1.18, y: 0.36, w: 11.5, h: 0.26, fontSize: 10, bold: true, color: GREEN, charSpacing: 1.2, fontFace: BODY, margin: 0 });
  s.addText(title, { x: 1.15, y: 0.6, w: 11.6, h: 0.5, fontSize: 25, bold: true, color: INK, fontFace: HEAD, margin: 0 });
}

/* "what it answers" column */
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

/* ---------- 1 · title ---------- */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Salam · DIGITAL CONSOLE', { x: 0.7, y: 0.75, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('What shipped since 13 August', { x: 0.7, y: 1.35, w: 11.9, h: 1.0, fontSize: 44, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Your tickets, closed · Monitoring rebuilt · DMS dealer data live · and the L1 workshop plan',
    { x: 0.7, y: 2.45, w: 11.5, h: 0.6, fontSize: 16, color: 'BFE3CF', fontFace: BODY, margin: 0 });

  const stats = [
    ['4', 'tickets raised by you', '3 closed, 1 in progress'],
    ['6', 'monitoring sub-tabs', 'one per dependency'],
    ['3.4 M', 'gateway calls / 24 h', 'traced, per endpoint'],
    ['DMS', 'dealer system of record', 'live from the Clara cluster'],
  ];
  stats.forEach((st, i) => {
    const x = 0.7 + i * 3.05;
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.6, w: 2.8, h: 1.75, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(st[0], { x: x + 0.22, y: 3.75, w: 2.4, h: 0.6, fontSize: 30, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(st[1], { x: x + 0.22, y: 4.4, w: 2.45, h: 0.35, fontSize: 12, bold: true, color: WHITE, fontFace: BODY, margin: 0 });
    s.addText(st[2], { x: x + 0.22, y: 4.75, w: 2.45, h: 0.5, fontSize: 10.5, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  });

  s.addText('Yosri A Yahmed · Digital Operations · 22 August 2026', { x: 0.7, y: 6.4, w: 8, h: 0.3, fontSize: 12, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
  s.addNotes('Update to the L2 team after the review sessions. Everything here is live on production data.');
}

/* ---------- 2 · at a glance ---------- */
{
  const s = pres.addSlide();
  header(s, 'At a glance', 'Nine additions since the last note — all live on production');
  const cards = [
    ['Tickets & feedback', 'Four tickets from you, three already closed — with screenshots, comments and status mail.', GREEN],
    ['Monitoring · 6 sub-tabs', 'Gateway · Payments · Access · SMS · Delivery · Resellers. Growth merged in.', GREEN],
    ['API gateway drill-down', 'Failing, timing out and slowest endpoints on top; every row opens its own traces.', GREEN],
    ['SMS end to end', 'Search by MSISDN: every OTP, its template text, outcome and time-to-verify.', GREEN],
    ['Payments ⇄ UPG', 'The gateway answer behind a decline — code, message and sanitized payload.', GREEN],
    ['Journeys with real counts', 'Every app screen carries its own number and its own drop.', GREEN],
    ['DMS · Dealer 360', 'Profile, security, sessions, wallet, commission and stock from the Clara cluster.', AMBER],
    ['DMS · Dealer board', 'Rank and filter dealers; flags for never-paid, idle, bypass, no QR.', AMBER],
    ['Yusr copilot', 'Ask in plain language about a payment, an MSISDN or an incident.', GREEN],
  ];
  cards.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.55 + col * 4.15, y = 1.5 + row * 1.78;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 3.9, h: 1.58, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.24, y: y + 0.26, w: 0.2, h: 0.2, fill: { color: c[2] }, line: { color: c[2] } });
    s.addText(c[0], { x: x + 0.55, y: y + 0.16, w: 3.15, h: 0.34, fontSize: 13, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(c[1], { x: x + 0.55, y: y + 0.54, w: 3.15, h: 0.95, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 14 });
  });
  s.addText('Amber = the new DMS section, built this week — the part that most concerns the DMS L2 colleagues joining this thread.',
    { x: 0.55, y: 6.62, w: 10.5, h: 0.3, fontSize: 9.5, italic: true, color: AMBER, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ---------- 3 · tickets ---------- */
{
  const s = pres.addSlide();
  header(s, 'You asked — it shipped', 'Four tickets from you — three closed, one in progress');
  s.addImage({ path: cut('s01_top'), x: 0.55, y: 1.5, w: 8.5, h: 2.09, shadow: shadow() });
  s.addImage({ path: cut('s02_drawer'), x: 9.5, y: 1.5, w: 3.3, h: 3.33, shadow: shadow() });

  const t = [
    ['TKT-000002 · Alert definition', 'every rule now carries what it checks, why it matters and the first move.', 'Closed'],
    ['TKT-000003 · Business vs technical', 'the error list is split — business outcomes never sit beside timeouts again.', 'Closed'],
    ['TKT-000004 · New SIM lane count', 'the onboarding count was wrong; fixed and re-verified against the raw orders.', 'Closed'],
    ['TKT-000005 · 360 readability', 'contrast and spacing pass — part of this week\'s UI work.', 'In progress'],
  ];
  t.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.55 + col * 4.35, y = 3.95 + row * 1.42;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 4.1, h: 1.25, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addText(it[0], { x: x + 0.22, y: y + 0.14, w: 3.7, h: 0.3, fontSize: 11.5, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(it[1], { x: x + 0.22, y: y + 0.44, w: 3.7, h: 0.6, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
    s.addText(it[2], { x: x + 2.95, y: y + 0.13, w: 0.98, h: 0.26, fontSize: 9, bold: true, color: it[2] === 'Closed' ? GREEN : AMBER, align: 'right', fontFace: BODY, margin: 0 });
  });
  s.addText('Screenshots, comments and a status mail travel with every ticket — this is the backlog now.',
    { x: 9.5, y: 5.05, w: 3.3, h: 0.9, fontSize: 10.5, italic: true, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 14 });
  footer(s);
  s.addNotes('Thank them by name in the mail; here just show the board is working.');
}

/* ---------- 4 · monitoring ---------- */
{
  const s = pres.addSlide();
  header(s, 'Monitoring · rebuilt', 'One long page became six tabs, in the order a request travels');
  s.addImage({ path: img(7), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Gateway → Payments → Access → SMS → Delivery → Resellers', 'the request path, not an alphabet.'],
    ['Health strip', '9 OK · 1 degraded · 0 down · 1 not configured. Click a chip for what it checks and why it matters.'],
    ['Growth merged in', 'the old Growth page is now the Resellers tab.'],
  ], 1.55);
  s.addText('Both ambers are by design, not faults: API GW nodes 3/6 (firewalled) and ServiceNow not configured.',
    { x: 0.55, y: 6.55, w: 8.5, h: 0.35, fontSize: 10, italic: true, color: AMBER, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ---------- 5 · APIGW ---------- */
{
  const s = pres.addSlide();
  header(s, 'API gateway', 'What is failing, what is timing out, what is slowest — then one click into it');
  s.addImage({ path: img(8), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Three problem cards on top', '18,132 errors · 0 timing out · worst p95 48,000' + NB + 'ms, over 3,473,979 gateway calls (0.52' + NB + '%).'],
    ['Every row opens', 'get-subscription-profile: 91,054 calls, 6,356 errors (6.98' + NB + '%), p95 25,768' + NB + 'ms, max 30,503' + NB + 'ms.'],
    ['The slow traces are kept in full', 'every error and every call over the threshold — that is where a p95 becomes a case.'],
  ], 1.62);
  s.addText('Same window, same host: get-subscription-balance runs 87,222 calls at 0.09 % errors — so it is that endpoint, not the gateway.',
    { x: 0.55, y: 6.55, w: 11.5, h: 0.35, fontSize: 10, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  footer(s);
  s.addNotes('The profile-vs-balance comparison is the point: same host, same window, very different error rate.');
}

/* ---------- 6 · payments / UPG ---------- */
{
  const s = pres.addSlide();
  header(s, 'Payments ⇄ UPG', 'The gateway\'s own answer, beside our record of the same payment');
  s.addImage({ path: img(15), x: 4.23, y: 1.5, w: 8.57, h: 4.95, shadow: shadow() });
  points(s, 0.55, 1.6, 3.3, [
    ['Invoice + every charge attempt', 'with the final outcome, not only the last one.'],
    ['The real reason', 'gw code 119 · "Transaction not permitted to cardholder".'],
    ['Payload sanitized', 'PAN and PII masked before it reaches the screen.'],
    ['Honest about gaps', 'index-gated lookups are named, never silently empty.'],
  ], 1.2);
  footer(s);
}

/* ---------- 7 · SMS ---------- */
{
  const s = pres.addSlide();
  header(s, 'SMS · end to end', 'Search one MSISDN and see every OTP we ever sent it');
  s.addImage({ path: img(14), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['The funnel', '8,783 sent · 7,526 verified · 86' + NB + '% · 27' + NB + 's average time-to-verify.'],
    ['Per message', 'template text in English and Arabic, outcome, and the seconds to entry. Codes are never displayed.'],
    ['It says what it cannot see', 'login OTPs are derived; campaign and billing SMS leave no trace our side — stated on the panel.'],
  ], 1.62);
  footer(s);
}

/* ---------- 8 · Yusr ---------- */
{
  const s = pres.addSlide();
  header(s, 'Yusr · يُسر', 'Ask in plain language — it answers from the same data, with the next action');
  s.addImage({ path: img(13), x: 4.23, y: 1.5, w: 8.57, h: 4.95, shadow: shadow() });
  points(s, 0.55, 1.6, 3.3, [
    ['Paste a reference', 'a payment id, an MSISDN or an incident number is enough.'],
    ['It reads the case', 'amount, rail, platform, gateway code and class.'],
    ['Then the next action', 'not just a description of the failure.'],
    ['PII is masked', 'before anything reaches the model.'],
  ], 1.2);
  footer(s);
}

/* ---------- 9 · dashboard ---------- */
{
  const s = pres.addSlide();
  header(s, 'Dashboard', 'The morning numbers — and the outcome behind each one');
  s.addImage({ path: img(16), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Outcome per payment, not per attempt', '315 success · 270 abandoned · 77 declined · 0 stuck — and 48' + NB + '% of the failed ones paid later.'],
    ['Business and technical, separated', '490 success · 160 business · 0 technical over 650 calls — the split asked for in TKT-000003.'],
    ['Every tile is a window', 'the range applies to the whole page, and each tile drills into its own cases.'],
  ], 1.62);
  footer(s);
}

/* ---------- 10 · journeys ---------- */
{
  const s = pres.addSlide();
  header(s, 'Journeys', 'Every app screen carries its own count — and its own drop');
  s.addImage({ path: cut('s03_row'), x: 0.55, y: 1.5, w: 7.4, h: 2.45, shadow: shadow() });
  s.addImage({ path: cut('s06_row'), x: 0.55, y: 4.12, w: 7.4, h: 2.56, shadow: shadow() });
  points(s, 8.3, 1.6, 4.5, [
    ['Not logged in, and logged in', 'new SIM and MNP on top; prepaid and postpaid below, each with its own funnel.'],
    ['Error states sit beside the happy path', 'left before paying · no gateway answer · declined by bank — each with a count.'],
    ['Retries are visible', '×1.2 tries means the same customer came back, not new demand.'],
    ['Excluded, and it says so', 'reseller-API orders are named and excluded rather than quietly mixed in.'],
  ], 1.3);
  footer(s);
}

/* ---------- 11 · decline reasons ---------- */
{
  const s = pres.addSlide();
  header(s, 'Why they did not complete', 'Count and share per gateway response — with the payments behind it');
  s.addImage({ path: cut('s04_modal'), x: 0.55, y: 1.5, w: 11.4, h: 3.91, shadow: shadow() });
  const cards = [
    ['Reason · class · count · share · value', 'and which app and which vendor each one came from.'],
    ['Business is not an outage', 'insufficient funds and an expired card are outcomes; the badge says so.'],
    ['"trace ›" opens the whole path', 'app call → gateway spans → request/response → UPG attempts.'],
  ];
  cards.forEach((c, i) => {
    const x = 0.55 + i * 4.15;
    s.addShape(pres.ShapeType.roundRect, { x, y: 5.55, w: 3.9, h: 1.25, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addText(c[0], { x: x + 0.22, y: 5.68, w: 3.5, h: 0.3, fontSize: 11.5, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(c[1], { x: x + 0.22, y: 5.99, w: 3.5, h: 0.7, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
  });
  footer(s);
}

/* ---------- 12 · trace ---------- */
{
  const s = pres.addSlide();
  header(s, 'One transaction, end to end', 'App call · gateway spans · the exact request and the exact answer');
  s.addImage({ path: cut('s05_modal'), x: 6.15, y: 1.5, w: 6.65, h: 4.85, shadow: shadow() });
  points(s, 0.55, 1.7, 5.1, [
    ['The app call', 'endpoint, code 22, message and 1,046' + NB + 'ms.'],
    ['The gateway path', 'every service hop the call passed through, in order.'],
    ['The bodies', 'exactly what was sent and exactly what came back.'],
    ['Best-effort is labelled', 'the trace is matched on time and path — the page says so rather than implying certainty.'],
    ['Missing index, named', 'the uil_logs lookup is skipped to protect the OSB DB, and the panel prints the index to create.'],
  ], 1.0);
  footer(s);
}

/* ---------- 13 · DMS dealer 360 ---------- */
{
  const s = pres.addSlide();
  header(s, 'DMS · Dealer 360 — new', 'One dealer, read live from the Clara cluster');
  s.addImage({ path: img(11), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Eight panels', 'profile · security · sessions · wallet · commission · SIM stock · activity · app-side.'],
    ['PII masked by default', 'reveal is admin-only, and every reveal is written to the audit trail.'],
    ['It states what it cannot know', 'the wallet balance is encrypted by the application, so movements are shown instead of a figure.'],
  ], 1.62);
  footer(s);
  s.addNotes('For the DMS L2 colleagues: this is the part built for you this week.');
}

/* ---------- 14 · dealer board ---------- */
{
  const s = pres.addSlide();
  header(s, 'DMS · Dealer board — new', 'Rank and filter the estate, with the flags that need an answer');
  s.addImage({ path: img(12), x: 0.55, y: 1.5, w: 8.5, h: 4.91, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Filter', 'type · status · region · location · partner, then rank by earnings, deals or activity.'],
    ['Flags, not opinions', 'never paid out · idle N days · bypass · no QR — each derived from a record, not a guess.'],
    ['First open question', 'commission is recorded as earned, yet no pay-out row exists against it. Worth a joint look.'],
  ], 1.62);
  footer(s);
  s.addNotes('Raise the never-paid-out pattern as a question, not a conclusion — the pay-out may live in a system we do not read yet.');
}

/* ---------- 15 · alerts ---------- */
{
  const s = pres.addSlide();
  header(s, 'Alerts', '66 rules, each one carrying its own guided response');
  s.addImage({ path: cut('s17_trim'), x: 0.55, y: 1.5, w: 8.5, h: 4.21, shadow: shadow() });
  points(s, 9.45, 1.6, 3.35, [
    ['Severity that means something', '0 P1 · 2 P2 · 0 P3 open, and 93 resolved in the last 24' + NB + 'h.'],
    ['Measured, not claimed', 'MTTA 27' + NB + 'm · MTTR 1.3' + NB + 'h over 30 days.'],
    ['Guided response on every rule', 'the ordered first moves, the owning team, and a jump straight into Troubleshoot.'],
    ['Business and technical', 'separated here too — an eligibility spike is not a gateway fault.'],
  ], 1.3);
  s.addText('Ack · Snooze · Resolve are one click from the row, and the history keeps who did what.',
    { x: 0.55, y: 5.9, w: 8.5, h: 0.35, fontSize: 10, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ---------- 16 · L1 workshops ---------- */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('NEXT', { x: 0.7, y: 0.45, w: 6, h: 0.3, fontSize: 11, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('L1 workshops — two sessions next week', { x: 0.7, y: 0.78, w: 11.9, h: 0.6, fontSize: 32, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Proposal: Monday 24 and Wednesday 26 August, 11:00 – 13:00 KSA. Please confirm and I will send the invites.',
    { x: 0.7, y: 1.48, w: 11.9, h: 0.4, fontSize: 14, color: 'BFE3CF', fontFace: BODY, margin: 0 });

  const days = [
    ['Session 1 · Monday 24 Aug', '11:00 – 13:00 KSA', [
      'The console in an L1 shift: what to open first, and what "normal" looks like',
      'Dashboard and journeys — reading a drop without opening a database',
      'Troubleshoot: one customer, one payment, one order, end to end',
      'Business vs technical — what L1 resolves and what escalates to you',
      'Hands-on: every participant works two live cases',
    ]],
    ['Session 2 · Wednesday 26 Aug', '11:00 – 13:00 KSA', [
      'Alerts: acknowledge, assign, snooze, resolve — and the guided response',
      'Raising a good ticket, and using Yusr as the first line of help',
      'Monitoring: the health strip, and when an amber is not an incident',
      'DMS for L1: what a dealer question looks like, and where it is answered',
      'Close: what L1 owns, what escalates, and the rollout date',
    ]],
  ];
  days.forEach((d, i) => {
    const x = 0.7 + i * 6.2;
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.15, w: 5.9, h: 4.15, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(d[0], { x: x + 0.32, y: 2.34, w: 5.3, h: 0.34, fontSize: 16, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    s.addText(d[1], { x: x + 0.32, y: 2.68, w: 5.3, h: 0.28, fontSize: 11.5, color: '7FD3A6', fontFace: BODY, margin: 0 });
    s.addText(d[2].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < d[2].length - 1 } })),
      { x: x + 0.32, y: 3.02, w: 5.3, h: 3.2, fontSize: 13.5, color: 'DCEFE4', fontFace: BODY, margin: 0, paraSpaceAfter: 15, valign: 'top' });
  });
  s.addText('L2\'s role in both: you take the questions L1 cannot yet answer — that hand-over is the point of the workshop.',
    { x: 0.7, y: 6.45, w: 11.9, h: 0.35, fontSize: 12, italic: true, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  footer(s, true);
}

/* ---------- 17 · asks ---------- */
{
  const s = pres.addSlide();
  header(s, 'What I am asking from you', 'Three things this week');
  const asks = [
    ['Keep raising tickets', 'Suggestion or Issue, with a screenshot. Four so far — the console is measurably better for all four.', GREEN],
    ['Confirm the workshop slots', 'Monday 24 and Wednesday 26 August, 11:00 – 13:00 KSA. Tell me what L1 must be able to do by the end.', GREEN],
    ['DMS L2 — open Dealer 360', 'Look up one dealer you know well and tell me what is wrong or missing. That is the fastest way in.', AMBER],
  ];
  asks.forEach((a, i) => {
    const y = 1.6 + i * 1.68;
    s.addShape(pres.ShapeType.roundRect, { x: 0.55, y, w: 12.25, h: 1.46, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addShape(pres.ShapeType.roundRect, { x: 0.85, y: y + 0.42, w: 0.62, h: 0.62, fill: { color: a[2] }, line: { color: a[2] }, rectRadius: 0.12 });
    s.addText(String(i + 1), { x: 0.85, y: y + 0.42, w: 0.62, h: 0.62, fontSize: 20, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: HEAD, margin: 0 });
    s.addText(a[0], { x: 1.75, y: y + 0.26, w: 10.6, h: 0.38, fontSize: 17, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(a[1], { x: 1.75, y: y + 0.68, w: 10.6, h: 0.55, fontSize: 12.5, color: MUTED, fontFace: BODY, margin: 0 });
  });
  s.addText('Console: https://salam.sa/digital-console/     ·     Tickets: the "?" menu → Raise a ticket',
    { x: 0.55, y: 6.55, w: 11, h: 0.32, fontSize: 12, bold: true, color: DARK, fontFace: BODY, margin: 0 });
  footer(s);
}

pres.writeFile({ fileName: OUT }).then(() => console.log('wrote', OUT, '·', page, 'slides'));
