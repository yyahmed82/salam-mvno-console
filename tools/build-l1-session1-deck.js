/* Salam Digital Console — L1 workshop, SESSION 1 (Monday 24 August 2026, 11:00–13:00 KSA).
 *
 * Same template as the L2 decks (build-l2-deck.js / build-foundation-deck.js): LAYOUT_WIDE,
 * dark title slide with stat cards, green numbered badge + kicker + title on every content slide,
 * light cards, one footer with a running page number.
 *
 * NO SCREENSHOTS. The shots/ folder from the August decks lived in session scratch and is gone, so
 * this deck is built from layout, flow diagrams and tables instead. That turns out to suit an L1
 * training deck better anyway: a trainee needs the ORDER OF OPERATIONS and the BASELINE NUMBERS,
 * not a picture of a page they will have open in front of them.
 *
 * EVERY NUMBER ON THESE SLIDES IS MEASURED, NOT ILLUSTRATIVE. Sources:
 *   · 12-month app-side catalog, Sep 2025 – Aug 2026 (5,224,465 payments) — the funnel, the journey
 *     success rates, the four-journey volumes
 *   · 12-month UPG per-transaction export (553,662 failures, 654,536 gateway attempts) — the
 *     BUSINESS / TECHNICAL / RECONCILIATION split and the failure families
 *   · the 20 Aug voucher capture — the voucher response codes
 * This matters for an L1 deck more than anywhere else: "what normal looks like" is worthless unless
 * the numbers are real, because the whole skill being taught is noticing when they are not.
 *
 * Build:  node tools/build-l1-session1-deck.js
 */
'use strict';
const pptxgen = require('pptxgenjs');

const OUT = process.env.OUT_FILE
  || '/sessions/upbeat-happy-archimedes/mnt/Salam DMS/Salam-Console-L1-Session1-24Aug2026.pptx';

const INK = '11241D', GREEN = '00A651', DARK = '0B3B2E', MUTED = '5F6F69',
      LIGHT = 'F2F6F3', AMBER = 'B26B00', RED = 'B3261E', BLUE = '2563EB', WHITE = 'FFFFFF';
const BODY = 'Calibri', HEAD = 'Calibri', MONO = 'Courier New';

/* Every step carries the URL that proves it. Routes are read from web/router.js, not invented:
 *   #dashboard · #alerts · #journeys · #troubleshoot · #subscriber · #monitoring · #analytics
 *   #apigw · #dms · #tickets · #topology · #workbench · #salamdocs · #tapdocs
 * Deep links the router genuinely parses:
 *   #monitoring?tab=<gateway|payments|access|sms|delivery|resellers>
 *   #subscriber?key=<msisdn>
 *   #troubleshoot?from=&to=&cls=<business|technical>&cat=<category>
 * A trainee who cannot reach one of these has found a permissions or deployment problem, which is
 * exactly what a first session should surface. */
const BASE = 'salam.sa/digital-console/';
const url = h => BASE + '#' + h;
const href = h => 'https://' + url(h);

/* Two buttons targeting ?cls=business and ?cls=technical both rendered as "#troubleshoot" — the
 * links differed, the labels did not, which is worse than a long label. Keep the distinguishing
 * parameter visible; drop only the noisy ones (a full MSISDN would not fit a pill). */
function shortLabel(h) {
  const [route, qs] = String(h).split('?');
  if (!qs) return '#' + route;
  const m = /(?:^|&)(cls|tab|cat)=([^&]+)/.exec(qs);
  return m ? '#' + route + ' · ' + m[2] : '#' + route;
}          // the real target — these buttons are clickable

/* A BUTTON, not a caption. addText with `shape` draws the pill and the label as ONE object, so the
 * whole pill carries the hyperlink — clicking anywhere on it opens the console. A separate shape
 * plus a text box would look identical and only be clickable on the letters, which is worse than
 * having no button at all because it looks like it should work. */
function btn(s, { x, y, w, h = 0.34, hash, label, tone = 'solid' }) {
  const solid = tone === 'solid';   // must be defined before the run styling below
  const link = { url: href(hash), tooltip: url(hash) };
  const runFace = { bold: true, hyperlink: link, color: solid ? WHITE : DARK, underline: false };
  s.addText([{ text: label || ('#' + hash), options: runFace },
             { text: '  ↗', options: runFace }], {
    shape: pres.ShapeType.roundRect, rectRadius: h / 2.2,
    x, y, w, h,
    fill: { color: solid ? GREEN : 'EAF7F0' },
    line: { color: solid ? GREEN : 'B8E0CC', width: 1 },
    color: solid ? WHITE : DARK,
    fontSize: h <= 0.3 ? 9 : 10, fontFace: BODY,
    align: 'center', valign: 'middle', margin: 0,
  });
}
const NB = ' ';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Yosri A Yahmed';
pres.title = 'Salam Digital Console — L1 workshop, session 1';

let page = 0;
function footer(s, dark) {
  page++;
  s.addText('Salam Digital Console · L1 workshop · session 1 · 24 August 2026',
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

/* a section divider — dark, so the five parts of the session are visually obvious */
function divider(s, n, kicker, title, sub) {
  s.background = { color: DARK };
  s.addText(`PART ${n} OF 5`, { x: 0.7, y: 2.2, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText(kicker, { x: 0.7, y: 2.7, w: 11.9, h: 0.9, fontSize: 38, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText(title, { x: 0.7, y: 3.75, w: 11.5, h: 0.5, fontSize: 16, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  if (sub) s.addText(sub, { x: 0.7, y: 4.35, w: 11.5, h: 0.8, fontSize: 13, color: '8FC3A8', fontFace: BODY, margin: 0, lineSpacing: 18 });
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

/* a left-to-right numbered flow — used for "the first five minutes" and the troubleshoot path */
function flow(s, steps, y, { x0 = 0.55, w = 12.2, h = 1.5 } = {}) {
  const n = steps.length, gap = 0.18, bw = (w - gap * (n - 1)) / n;
  steps.forEach((st, i) => {
    const x = x0 + i * (bw + gap);
    s.addShape(pres.ShapeType.roundRect, { x, y, w: bw, h, fill: { color: WHITE }, line: { color: GREEN, width: 1.25 }, rectRadius: 0.06 });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.18, y: y + 0.16, w: 0.32, h: 0.32, fill: { color: GREEN }, line: { color: GREEN } });
    s.addText(String(i + 1), { x: x + 0.18, y: y + 0.16, w: 0.32, h: 0.32, fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: HEAD, margin: 0 });
    s.addText(st[0], { x: x + 0.58, y: y + 0.15, w: bw - 0.75, h: 0.34, fontSize: 12, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    const hasUrl = !!st[2];
    s.addText(st[1], { x: x + 0.18, y: y + 0.58, w: bw - 0.36, h: h - 0.68 - (hasUrl ? 0.38 : 0), fontSize: 10, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
    if (hasUrl) {
      btn(s, { x: x + 0.16, y: y + h - 0.46, w: bw - 0.32, h: 0.34, hash: st[2], label: shortLabel(st[2]) });
    }
    if (i < n - 1) s.addText('›', { x: x + bw + 0.01, y: y + h / 2 - 0.2, w: 0.16, h: 0.4, fontSize: 18, bold: true, color: GREEN, align: 'center', fontFace: HEAD, margin: 0 });
  });
}

/* the slide-wide strip: a sentence, then real buttons. `hashes` may be one route or several. */
function urlbar(s, y, label, hashes, w = 12.2, x = 0.55) {
  const list = Array.isArray(hashes) ? hashes : [hashes];
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.52, fill: { color: 'F4FAF6' }, line: { color: 'D6EBDF' }, rectRadius: 0.07 });
  s.addText('TEST IT', { x: x + 0.18, y: y + 0.11, w: 0.7, h: 0.3, fontSize: 8.5, bold: true, color: GREEN, charSpacing: 0.8, fontFace: BODY, margin: 0, valign: 'middle' });
  const MIN_TEXT = label ? 1.9 : 0;
  const bw = Math.min(2.4, (w - 1.05 - MIN_TEXT) / list.length - 0.12);
  const textW = w - 1.05 - list.length * (bw + 0.12);
  if (label) s.addText(label, { x: x + 0.92, y: y + 0.11, w: textW, h: 0.3, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, valign: 'middle' });
  list.forEach((hsh, i) => {
    btn(s, { x: x + w - 0.18 - (list.length - i) * (bw + 0.12) + 0.12, y: y + 0.09, w: bw, h: 0.34,
             hash: hsh, label: shortLabel(hsh) });
  });
}

/* a plain table with the deck's header style */
function table(s, head, rows, { x = 0.55, y = 1.5, w = 12.2, colW, fs = 11, rowH = 0.34 } = {}) {
  s.addTable([head.map(h => ({ text: h, options: { bold: true, color: WHITE, fill: { color: DARK }, fontSize: fs, fontFace: HEAD } }))]
    .concat(rows.map(r => r.map(c => (typeof c === 'object' ? c
      : { text: String(c), options: { color: INK, fontSize: fs, fontFace: BODY } })))),
    { x, y, w, colW, border: { pt: 0.5, color: 'DDE7E1' }, autoPage: false,
      rowH, valign: 'middle', margin: 0.06 });
}

/* ================================================================= 1 · title */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Salam · DIGITAL CONSOLE', { x: 0.7, y: 0.75, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('The console in an L1 shift', { x: 0.7, y: 1.35, w: 11.9, h: 1.0, fontSize: 44, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Session 1 of 2 · Monday 24 August 2026 · 11:00 – 13:00 KSA · hands-on, two live cases each',
    { x: 0.7, y: 2.45, w: 11.5, h: 0.6, fontSize: 16, color: 'BFE3CF', fontFace: BODY, margin: 0 });

  const stats = [
    ['5', 'parts in two hours', 'the last one is you working'],
    ['4', 'journeys you will own', 'New SIM · MNP · Recharge · Invoice'],
    ['93 %', 'of failures are BUSINESS', 'not a platform fault — you close these'],
    ['0', 'databases you need to open', 'everything here is a page in the console'],
  ];
  stats.forEach((st, i) => {
    const x = 0.7 + i * 3.05;
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.6, w: 2.8, h: 1.75, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(st[0], { x: x + 0.22, y: 3.75, w: 2.4, h: 0.6, fontSize: 30, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(st[1], { x: x + 0.22, y: 4.4, w: 2.45, h: 0.35, fontSize: 12, bold: true, color: WHITE, fontFace: BODY, margin: 0 });
    s.addText(st[2], { x: x + 0.22, y: 4.75, w: 2.45, h: 0.5, fontSize: 10.5, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  });
  s.addText('Yosri A Yahmed · Digital Operations · https://salam.sa/digital-console/',
    { x: 0.7, y: 6.4, w: 8, h: 0.3, fontSize: 12, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
  s.addNotes('Open the console on the projector before starting. Everyone should have it open too — this is not a slideshow session.');
}

/* ================================================================= 2 · how the two hours run */
{
  const s = pres.addSlide();
  header(s, 'How the two hours run', 'Five parts — and you spend the last forty minutes working, not watching');
  const rows = [
    ['11:00', '15 min', '1 · The shift', 'What to open first, and what "normal" looks like'],
    ['11:15', '20 min', '2 · Dashboard & journeys', 'Reading a drop without opening a database'],
    ['11:35', '25 min', '3 · Troubleshoot', 'One customer, one payment, one order — end to end'],
    ['12:00', '20 min', '4 · Business vs technical', 'What you resolve, and what escalates to L2'],
    ['12:20', '40 min', '5 · Hands-on', 'Two live cases each — you drive, we watch'],
  ];
  table(s, ['Start', 'Length', 'Part', 'What you leave able to do'], rows,
    { y: 1.55, colW: [1.1, 1.1, 3.0, 7.0] });
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.35, w: 12.2, h: 1.5, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
  s.addText('One rule for the whole session', { x: 0.85, y: 4.5, w: 11.6, h: 0.32, fontSize: 14, bold: true, color: INK, fontFace: HEAD, margin: 0 });
  s.addText('Stop me the moment a screen does not match what I am saying. A console that does not match the training is a ticket, '
          + 'and raising it here is faster than finding it alone at 02:00 on a Thursday.',
    { x: 0.85, y: 4.86, w: 11.6, h: 0.85, fontSize: 12.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 17 });
  s.addText('Everything shown today is live production data, read-only. Nothing you click in this session can change a customer record.',
    { x: 0.55, y: 6.1, w: 12.2, h: 0.35, fontSize: 10.5, italic: true, color: GREEN, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ================================================================= 3 · divider 1 */
{
  const s = pres.addSlide();
  divider(s, 1, 'The console in an L1 shift', 'What to open first, and what "normal" looks like',
    'The skill is not clicking. It is knowing the baseline well enough that a bad number looks wrong immediately.');
}

/* ================================================================= 4 · first five minutes */
{
  const s = pres.addSlide();
  header(s, 'Your first five minutes', 'Same four steps, every shift, in this order');
  flow(s, [
    ['Health strip', 'Home. Nine or ten chips. Look for red, not amber — amber has reasons, written on the chip.', 'dashboard'],
    ['Alerts', 'Anything unacknowledged? Acknowledge it so the next shift knows a human saw it.', 'alerts'],
    ['Dashboard funnel', 'Today against yesterday. Check the SHAPE, not the size — the mix should look the same.', 'dashboard'],
    ['Journeys', 'Any lane with a drop not in yesterday\'s picture. Note it; do not chase it yet.', 'journeys'],
  ], 1.55, { h: 2.15 });

  s.addText('Then stop. If all four are as expected, the platform is fine and your shift is customer work.',
    { x: 0.55, y: 3.92, w: 12.2, h: 0.35, fontSize: 13, bold: true, color: INK, fontFace: BODY, margin: 0 });

  cards(s, [
    ['Amber is not an incident', 'Two ambers are permanent and by design: API GW nodes 3 of 6 (the others are firewalled from us) and ServiceNow (not configured). Learn these two so they never cost you a phone call.', AMBER],
    ['Red means read the chip', 'Every chip says what it checks and why it matters. Read that before escalating — half of them tell you the next move directly.', RED],
    ['Nothing to do is a valid result', 'Most shifts, all four steps are clean. Writing "checked, normal" in the handover is a real answer, not an empty one.', GREEN],
  ], { y0: 4.42, cols: 3, h: 1.95, fs: 10.5 });
  footer(s);
  s.addNotes('Walk this live on the projector. Five minutes, no talking over it — let them see how short it actually is.');
}

/* ================================================================= 5 · what normal looks like */
{
  const s = pres.addSlide();
  header(s, 'What "normal" looks like', 'Twelve months of real numbers — learn these four and you can spot a bad day in seconds');
  const rows = [
    ['Payments per month', '~377,000 – 490,000', 'Declining gently through the year. A 20% drop overnight is not seasonal.'],
    ['Succeeded', '50.6 %', 'About half. If this moves more than a few points in a day, something is wrong.'],
    ['Never attempted', '38.3 %', 'THE BIG ONE. Page opened, customer never paid. Not an error — see the next slide.'],
    ['Failed', '10.6 %', 'Reached a gateway and was refused. This is the number people mean by "failures".'],
    ['Stuck after gateway answer', '0.1 %', 'Tiny, and the only one that means money may have moved. Always escalate.'],
  ];
  table(s, ['What you are looking at', 'Normal', 'What it means for you'], rows,
    { y: 1.55, colW: [3.4, 2.6, 6.2] });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 3.95, w: 12.2, h: 1.35, fill: { color: 'FFF7E8' }, line: { color: 'E8C48A' }, rectRadius: 0.06 });
  s.addText('The single most common L1 mistake', { x: 0.85, y: 4.1, w: 11.6, h: 0.32, fontSize: 13.5, bold: true, color: AMBER, fontFace: HEAD, margin: 0 });
  s.addText('Reading "38% never attempted" as a 38% failure rate and raising an incident. It is not a failure — it is a payment page '
          + 'that was opened and abandoned. Counting it as an error overstates the real failure rate roughly fourfold.',
    { x: 0.85, y: 4.46, w: 11.6, h: 0.75, fontSize: 12, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });

  urlbar(s, 6.5, 'the funnel and these five numbers are on', 'dashboard');
  cards(s, [
    ['Success rate by journey — also normal', 'New SIM 77.3% · MNP 74.0% · Invoice 58.4% · Recharge 49.8% · Checkout 36.1%. They are SUPPOSED to differ this much. Recharge looks worst and is not.', BLUE],
    ['Why recharge looks bad', 'Recharge is 67% of all payments and has the most abandonment. A long onboarding journey creates its payment record early, so the drop lands elsewhere.', BLUE],
  ], { y0: 5.4, cols: 2, w: 6.0, gapx: 6.25, h: 1.0, fs: 10 });
  footer(s);
  s.addNotes('Ask them to write these five numbers down. This slide is the reference card for the whole role.');
}

/* ================================================================= 6 · divider 2 */
{
  const s = pres.addSlide();
  divider(s, 2, 'Dashboard and journeys', 'Reading a drop without opening a database',
    'Every number on the dashboard is clickable. You are never meant to ask someone to run a query for you.');
}

/* ================================================================= 7 · the funnel */
{
  const s = pres.addSlide();
  header(s, 'The funnel', 'Three outcomes — and only one of them is a problem you chase');
  const segs = [
    ['SUCCEEDED', '50.6 %', 'Paid. Nothing to do.', GREEN, 5.9],
    ['NEVER ATTEMPTED', '38.3 %', 'Page opened, never paid. A commercial question, not a fault.', AMBER, 4.5],
    ['FAILED', '10.6 %', 'Refused at the gateway. Your work starts here.', RED, 1.5],
  ];
  let x = 0.55;
  segs.forEach(g => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.6, w: g[4], h: 1.15, fill: { color: g[3] }, line: { color: g[3] }, rectRadius: 0.05 });
    s.addText(g[0], { x: x + 0.15, y: 1.72, w: g[4] - 0.3, h: 0.3, fontSize: 12, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    s.addText(g[1], { x: x + 0.15, y: 2.04, w: g[4] - 0.3, h: 0.5, fontSize: 20, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    s.addText(g[2], { x: x + 0.02, y: 2.85, w: g[4] + 0.2, h: 0.7, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
    x += g[4] + 0.15;
  });

  s.addText('So when someone says "payments are failing" — ask which of the three they mean. Usually they mean the amber one.',
    { x: 0.55, y: 3.62, w: 12.2, h: 0.35, fontSize: 13, bold: true, color: INK, fontFace: BODY, margin: 0 });

  points(s, 0.55, 4.15, 6.0, [
    ['Click any segment', 'it opens the payments behind it — filtered, not a fresh search.'],
    ['Then filter by journey', 'the same funnel exists per journey; that is where a drop becomes locatable.'],
    ['Then by hour', 'a real incident has an edge. A commercial change does not.'],
  ], 0.82);
  points(s, 6.9, 4.15, 5.9, [
    ['A drop with a sharp edge', 'started at a minute — that is technical. Escalate with the timestamp.'],
    ['A drop that slopes', 'usually a campaign ending, a price change, or a holiday.'],
    ['One journey only', 'look at that journey\'s own page before raising anything.'],
  ], 0.82);
  urlbar(s, 6.4, 'the funnel', 'dashboard', 6.0, 0.55);
  urlbar(s, 6.4, 'the failures behind it', 'troubleshoot', 5.9, 6.85);
  footer(s);
}

/* ================================================================= 8 · reading a drop */
{
  const s = pres.addSlide();
  header(s, 'Reading a drop', 'Four questions, in order — most drops are explained before question three');
  flow(s, [
    ['Is it real?', 'Compare to the same weekday last week, not yesterday. Fridays do not look like Tuesdays.', 'dashboard'],
    ['One journey or all?', 'All journeys = platform. One journey = that journey. Halves the problem instantly.', 'journeys'],
    ['Sharp edge or slope?', 'A minute-level cliff is technical. A gentle slope is commercial. Say which.', 'analytics'],
    ['Does the reason change?', 'New reason at the top = new fault. Same mix = same problem, more of it.', 'troubleshoot'],
  ], 1.55, { h: 2.25 });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.1, w: 12.2, h: 1.5, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
  s.addText('Worked example — the one that catches everybody', { x: 0.85, y: 4.25, w: 11.6, h: 0.32, fontSize: 13.5, bold: true, color: INK, fontFace: HEAD, margin: 0 });
  s.addText('New SIM success fell from 81.7% to 74.2% across the year — a 7.5 point drop. It looks like a payment problem and is not: '
          + 'failures moved only 4.5% → 5.8%, while ABANDONMENT went 10.9% → 16.7%. Customers are leaving before the payment page, '
          + 'not being refused at it. An L1 who reports "New SIM payments failing" sends L2 to the wrong place for a day.',
    { x: 0.85, y: 4.61, w: 11.6, h: 0.95, fontSize: 12, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });

  s.addText('The habit to build: before you say "failing", check whether the failed count actually moved.',
    { x: 0.55, y: 5.75, w: 12.2, h: 0.35, fontSize: 13, bold: true, color: GREEN, fontFace: BODY, margin: 0 });
  urlbar(s, 6.2, 'the New SIM lane', 'journeys');
  footer(s);
  s.addNotes('This example is real and from our own 12-month data. Use it — it lands better than any invented one.');
}

/* ================================================================= 9 · divider 3 */
{
  const s = pres.addSlide();
  divider(s, 3, 'Troubleshoot', 'One customer, one payment, one order — end to end',
    'A customer on the phone does not care about a funnel. This part is the whole job on a normal day.');
}

/* ================================================================= 10 · the path */
{
  const s = pres.addSlide();
  header(s, 'From a phone number to an answer', 'You will do this more than anything else in the role');
  flow(s, [
    ['Search the MSISDN', 'Subscriber 360. One number, no other input needed.', 'subscriber?key=9665XXXXXXXX'],
    ['Pick the event', 'Every payment, order, OTP and delivery for that number, newest first.', 'subscriber'],
    ['Open the timeline', 'What the app asked, what came back, and when — one screen.', 'subscriber'],
    ['Read the answer', 'The gateway\'s own words. Not our guess at them.', 'troubleshoot'],
    ['Decide', 'Business = answer now. Technical = escalate with this screen attached.', 'tickets'],
  ], 1.55, { h: 2.2 });

  cards(s, [
    ['What the customer says', '"I paid and got nothing." Almost always: the payment failed and the money is an authorisation hold that reverses in 3–7 days, or the retry succeeded and they were charged once.', BLUE],
    ['What you can confirm yourself', 'Whether a charge exists, whether it succeeded, whether it was retried, and what the bank said. All of it, without asking anyone.', GREEN],
    ['What you must not say', 'Never tell a customer money was or was not taken based on our record alone. Our record says what WE saw. The gateway is the source of truth and it is on the same screen.', RED],
  ], { y0: 4.0, cols: 3, h: 2.0, fs: 10 });
  urlbar(s, 6.2, 'replace the placeholder with a real number —', 'subscriber?key=9665XXXXXXXX');
  footer(s);
}

/* ================================================================= 11 · reading the answer */
{
  const s = pres.addSlide();
  header(s, 'Reading the gateway answer', 'The five you will see most — and what each one means for the customer');
  const rows = [
    ['Abandoned', 'Customer opened the page and never entered a card. TAP expires it ~31 min later.', 'No money moved. Tell them to try again.', GREEN],
    ['(no message)', 'Apple Pay / STC Pay return no text — BY DESIGN. Successful wallet payments are blank too.', 'Blank is not an error. Read the STATUS, not the message.', AMBER],
    ['Declined, Insufficient Funds', 'The bank refused. Not our system.', 'Customer contacts their bank. You close it.', GREEN],
    ['Declined, Incorrect CSC/CVV', 'Wrong CVV typed.', 'Ask them to re-enter carefully. You close it.', GREEN],
    ['Transaction Type not Supported', 'The acquirer refused this transaction type on that rail.', 'NOT the customer\'s fault. Escalate — this is a configuration issue.', RED],
  ];
  table(s, ['What you see', 'What it actually means', 'What you do'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 11, fontFace: BODY } },
    { text: r[1], options: { color: MUTED, fontSize: 10.5, fontFace: BODY } },
    { text: r[2], options: { color: r[3], bold: true, fontSize: 10.5, fontFace: BODY } },
  ]), { y: 1.55, colW: [3.1, 5.3, 3.8], fs: 10.5 });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.5, w: 12.2, h: 1.45, fill: { color: 'FFF7E8' }, line: { color: 'E8C48A' }, rectRadius: 0.06 });
  s.addText('The blank-message trap', { x: 0.85, y: 4.65, w: 11.6, h: 0.32, fontSize: 13.5, bold: true, color: AMBER, fontFace: HEAD, margin: 0 });
  s.addText('Most failures carry NO message at all — that is the gateway, not a bug in the console, and it does not mean the payment '
          + 'is unexplained. Use the status and the rail. A blank message on APPLE_PAY with status FAILED is an ordinary wallet decline; '
          + 'the same blank on a card is worth a second look.',
    { x: 0.85, y: 5.01, w: 11.6, h: 0.8, fontSize: 12, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });
  urlbar(s, 6.15, 'the failure list, filtered to what the app could read', 'troubleshoot?cls=business');
  footer(s);
}

/* ================================================================= 12 · voucher lane */
{
  const s = pres.addSlide();
  header(s, 'The voucher lane', 'A separate path with its own codes — and one that has caught people out');
  const rows = [
    ['00', 'Success', 'SUCCESS', '—'],
    ['22', 'Voucher number marked used', 'BUSINESS', 'Already consumed. Customer used it before.'],
    ['21', 'Does not exist / already reserved', 'BUSINESS', 'SAME CODE, two different situations. Read the message, not just the code.'],
    ['9', 'Voucher recharge is blocked', 'BUSINESS', 'Policy block on the account.'],
    ['20', 'Invalid voucher number format', 'BUSINESS', 'Typo. Ask them to re-read the card.'],
    ['0', 'FailedInBRM', 'TECHNICAL', 'Escalate. Note it is "0", not "00" — they are opposites.'],
    ['31', 'VOUCHER_RECHARGE service error', 'TECHNICAL', 'Escalate.'],
  ];
  table(s, ['Code', 'Message', 'Class', 'What you do'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 11.5, fontFace: HEAD } },
    { text: r[1], options: { color: INK, fontSize: 10.5, fontFace: BODY } },
    { text: r[2], options: { bold: true, fontSize: 10.5, fontFace: BODY, color: r[2] === 'TECHNICAL' ? RED : r[2] === 'SUCCESS' ? GREEN : BLUE } },
    { text: r[3], options: { color: MUTED, fontSize: 10.5, fontFace: BODY } },
  ]), { y: 1.55, colW: [1.0, 3.7, 1.7, 5.8], fs: 10.5 });

  s.addText('Code "0" versus code "00" — identical if you read them as numbers, opposite in meaning. '
          + 'This is the single most dangerous pair in the whole console.',
    { x: 0.55, y: 4.5, w: 12.2, h: 0.4, fontSize: 12.5, bold: true, color: RED, fontFace: BODY, margin: 0 });
  s.addText('Voucher attempts are visible for the last 7 days only. If a customer asks about a voucher from last month, that record '
          + 'no longer exists on our side — say so plainly and escalate rather than guessing.',
    { x: 0.55, y: 5.0, w: 12.2, h: 0.5, fontSize: 11.5, italic: true, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 15 });
  urlbar(s, 5.9, 'the voucher lane sits inside the logged-in journey', 'journeys');
  footer(s);
}

/* ================================================================= 13 · divider 4 */
{
  const s = pres.addSlide();
  divider(s, 4, 'Business vs technical', 'What you resolve, and what escalates to L2',
    'Getting this split right is most of the value L1 adds. Getting it wrong wastes an L2 day.');
}

/* ================================================================= 14 · the split */
{
  const s = pres.addSlide();
  header(s, 'The split, in real numbers', 'Over 553,662 failures across twelve months');
  const segs = [
    ['BUSINESS', '92.7 %', '513,002 failures', 'Customer or bank outcome. You answer these.', GREEN, 7.9],
    ['TECHNICAL', '6.6 %', '36,394', 'Platform fault. Escalate.', RED, 2.4],
    ['RECON', '0.8 %', '4,266', 'Money may have moved. Escalate always.', AMBER, 1.6],
  ];
  let x = 0.55;
  segs.forEach(g => {
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.6, w: g[5], h: 1.3, fill: { color: g[4] }, line: { color: g[4] }, rectRadius: 0.05 });
    s.addText(g[0], { x: x + 0.18, y: 1.72, w: g[5] - 0.36, h: 0.3, fontSize: 12, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    s.addText(g[1], { x: x + 0.18, y: 2.02, w: g[5] - 0.36, h: 0.5, fontSize: 22, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    s.addText(g[2], { x: x + 0.18, y: 2.52, w: g[5] - 0.36, h: 0.3, fontSize: 10, color: 'EAF7F0', fontFace: BODY, margin: 0 });
    s.addText(g[3], { x: x + 0.02, y: 3.0, w: g[5] + 0.2, h: 0.6, fontSize: 10.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 13 });
    x += g[5] + 0.15;
  });

  s.addText('Nine in ten of the things that look like faults are not faults. That is the headline of this session.',
    { x: 0.55, y: 3.7, w: 12.2, h: 0.35, fontSize: 14, bold: true, color: INK, fontFace: BODY, margin: 0 });

  cards(s, [
    ['You close it', 'Abandoned · insufficient funds · wrong CVV · expired card · issuer declined · wrong voucher number · voucher already used.', GREEN],
    ['You escalate it', 'Timeouts · gateway errors · "Transaction Type not Supported" · FailedInBRM · anything stuck after the gateway answered · anything where our record and the gateway disagree.', RED],
    ['You escalate it FAST', 'Any case where the gateway says PAID and our side says failed. That is money. Do not batch it, do not wait for the shift end.', AMBER],
  ], { y0: 4.25, cols: 3, h: 1.85, fs: 10 });
  urlbar(s, 6.28, 'what you close', 'troubleshoot?cls=business', 6.0, 0.55);
  urlbar(s, 6.28, 'what you escalate', 'troubleshoot?cls=technical', 5.9, 6.85);
  footer(s);
  s.addNotes('If they remember one slide from today, this is the one.');
}

/* ================================================================= 15 · a good ticket */
{
  const s = pres.addSlide();
  header(s, 'What a good escalation contains', 'Five lines. An L2 should never have to ask you a follow-up question');
  const rows = [
    ['1 · What', 'One sentence, plain. "Card payments on STC Pay refused with a format error."'],
    ['2 · Who / how many', 'One customer or many? Which MSISDN, or how many payments in what window.'],
    ['3 · When it started', 'To the minute if it has an edge. "From 14:20, was clean before."'],
    ['4 · What the gateway said', 'The actual message and status, copied — not paraphrased.'],
    ['5 · What you already ruled out', '"Not abandonment — the failed count moved, not the never-attempted count."'],
  ];
  table(s, ['Line', 'What goes in it'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 11.5, fontFace: HEAD } },
    { text: r[1], options: { color: MUTED, fontSize: 11, fontFace: BODY } },
  ]), { y: 1.55, colW: [2.6, 9.6], fs: 11 });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.15, w: 6.0, h: 2.15, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
  s.addText('Line 5 is the one that earns you trust', { x: 0.85, y: 4.3, w: 5.4, h: 0.32, fontSize: 13, bold: true, color: GREEN, fontFace: HEAD, margin: 0 });
  s.addText('Anyone can forward a problem. Saying what you checked and ruled out is what makes an L2 open your ticket first. '
          + 'It also stops the most common waste: an L2 spending a morning on abandonment.',
    { x: 0.85, y: 4.66, w: 5.4, h: 1.4, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });

  s.addShape(pres.ShapeType.roundRect, { x: 6.75, y: 4.15, w: 6.0, h: 2.15, fill: { color: 'FFF7E8' }, line: { color: 'E8C48A' }, rectRadius: 0.06 });
  s.addText('And when you are not sure', { x: 7.05, y: 4.3, w: 5.4, h: 0.32, fontSize: 13, bold: true, color: AMBER, fontFace: HEAD, margin: 0 });
  s.addText('Raise it. A wrong escalation costs an L2 ten minutes. A missed technical fault costs customers all night. '
          + 'Nobody is going to criticise you for escalating something that turned out to be business — say what you were unsure about.',
    { x: 7.05, y: 4.66, w: 5.4, h: 1.4, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });
  urlbar(s, 6.45, 'raise it here — the same board L2 works from', 'tickets');
  footer(s);
}

/* ================================================================= 16 · divider 5 */
{
  const s = pres.addSlide();
  divider(s, 5, 'Hands-on', 'Two live cases each — you drive',
    'Forty minutes. Real data, read-only. We are here to watch you get stuck, which is the useful part.');
}

/* ================================================================= 17 · case A */
{
  const s = pres.addSlide();
  header(s, 'Case A · the customer call', 'Everyone does this one. Fifteen minutes, then we compare answers');
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 1.5, w: 12.2, h: 1.05, fill: { color: DARK }, line: { color: DARK }, rectRadius: 0.06 });
  s.addText('"I tried to recharge twice yesterday. It failed both times but the money left my account. Where is it?"',
    { x: 0.85, y: 1.62, w: 11.6, h: 0.8, fontSize: 15, italic: true, color: WHITE, fontFace: BODY, margin: 0, valign: 'middle' });

  points(s, 0.55, 2.85, 6.0, [
    ['Find the number', 'Troubleshoot → MSISDN. How many payment attempts yesterday?'],
    ['For each attempt', 'what status, what rail, what did the gateway say?'],
    ['Was any of them paid?', 'check whether a later attempt on the same reference succeeded.'],
    ['Decide', 'is this business or technical — and what do you tell the customer, in one sentence?'],
  ], 0.88);

  s.addShape(pres.ShapeType.roundRect, { x: 6.9, y: 2.85, w: 5.85, h: 3.4, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
  s.addText('What we are looking for', { x: 7.2, y: 3.0, w: 5.25, h: 0.32, fontSize: 13, bold: true, color: INK, fontFace: HEAD, margin: 0 });
  urlbar(s, 6.4, 'start here with the number you were given', 'subscriber?key=9665XXXXXXXX');
  s.addText('· That you check the GATEWAY answer, not only our status.\n'
          + '· That you notice whether a retry succeeded — this is the difference between "you were not charged" and "you were charged once".\n'
          + '· That you never assert money moved or did not move without the gateway row on screen.\n'
          + '· That you can say it back to the customer in one plain sentence, with no jargon.',
    { x: 7.2, y: 3.4, w: 5.25, h: 2.7, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 17 });
  footer(s);
  s.addNotes('Hand out real MSISDNs from yesterday — one per participant, different numbers so they cannot copy each other.');
}

/* ================================================================= 18 · case B */
{
  const s = pres.addSlide();
  header(s, 'Case B · the shift check', 'Twenty minutes. This is your Monday morning, every Monday');
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 1.5, w: 12.2, h: 1.05, fill: { color: DARK }, line: { color: DARK }, rectRadius: 0.06 });
  s.addText('"You have just started your shift. Tell me in three minutes whether the platform is healthy — and prove it."',
    { x: 0.85, y: 1.62, w: 11.6, h: 0.8, fontSize: 15, italic: true, color: WHITE, fontFace: BODY, margin: 0, valign: 'middle' });

  points(s, 0.55, 2.85, 6.0, [
    ['Run the four steps', 'health strip, alerts, funnel, journeys — in that order, out loud.'],
    ['Name the ambers', 'and say why each one is expected. If you cannot, that is the gap to close.'],
    ['Compare like with like', 'same weekday last week, not yesterday.'],
    ['Write the handover', 'three lines: what you checked, what you found, what the next shift should watch.'],
  ], 0.88);

  s.addShape(pres.ShapeType.roundRect, { x: 6.9, y: 2.85, w: 5.85, h: 3.4, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
  s.addText('The trap in this exercise', { x: 7.2, y: 3.0, w: 5.25, h: 0.32, fontSize: 13, bold: true, color: AMBER, fontFace: HEAD, margin: 0 });
  urlbar(s, 6.35, 'in this order:', ['dashboard', 'alerts', 'journeys', 'monitoring?tab=gateway']);
  s.addText('Somebody will report the two permanent ambers as a problem. That is the point of the exercise — better to do it here '
          + 'than at 02:00.\n\nAnd somebody will find something real that we have not noticed. That has happened in every session '
          + 'so far, and it goes straight onto the ticket board with your name on it.',
    { x: 7.2, y: 3.4, w: 5.25, h: 2.7, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 17 });
  footer(s);
}

/* ============================================== 19 · every URL, to test before the session */
{
  const s = pres.addSlide();
  header(s, 'Every link in this deck', 'Open each one before Monday — a failing link is a ticket, not a surprise');
  const rows = [
    ['dashboard', 'Home — health strip, funnel, journeys', 'Part 1 · 2'],
    ['alerts', 'Alert list — acknowledge, assign, resolve', 'Part 1'],
    ['journeys', 'Screen-by-screen journeys, incl. the voucher lane', 'Part 2 · 3'],
    ['analytics', 'Trends over time — where a slope or a cliff is visible', 'Part 2'],
    ['troubleshoot', 'Failure list by category', 'Part 3 · 4'],
    ['troubleshoot?cls=business', 'Only the ones you close', 'Part 4'],
    ['troubleshoot?cls=technical', 'Only the ones you escalate', 'Part 4'],
    ['subscriber?key=9665XXXXXXXX', 'Subscriber 360 — one number, everything', 'Part 3 · Case A'],
    ['monitoring?tab=gateway', 'Gateway & API — edge nodes, traces, latency', 'Part 1'],
    ['monitoring?tab=payments', 'Payments GW — UPG · Tap · capture & stuck', 'Part 1 · 4'],
    ['monitoring?tab=access', 'Access — login, IP blocking, app errors', 'reference'],
    ['monitoring?tab=sms', 'SMS gateways — OTP delivery', 'reference'],
    ['monitoring?tab=delivery', 'Delivery — OTO · SMSA · Barq · iMile', 'reference'],
    ['monitoring?tab=resellers', 'Resellers — Apollo · Tygo · Soob', 'reference'],
    ['tickets', 'The ticket board — where escalations go', 'Part 4'],
  ];
  table(s, ['URL', 'What it opens', 'Used in'], rows.map(r => [
    { text: url(r[0]), options: { bold: true, color: '1B6B4A', fontSize: 9.5, fontFace: MONO,
                                  hyperlink: { url: href(r[0]), tooltip: 'open ' + url(r[0]) } } },
    { text: r[1], options: { color: MUTED, fontSize: 9.5, fontFace: BODY } },
    { text: r[2], options: { color: GREEN, bold: true, fontSize: 9.5, fontFace: BODY } },
  ]), { y: 1.35, colW: [4.9, 5.6, 1.7], fs: 9.5, rowH: 0.3 });
  s.addText('Replace 9665XXXXXXXX with a real number before the session. Everything else works as printed. '
          + 'If a link opens the dashboard instead of the page named, that session lacks the permission for it — tell me, do not work around it.',
    { x: 0.55, y: 6.35, w: 12.2, h: 0.5, fontSize: 10.5, italic: true, color: AMBER, fontFace: BODY, margin: 0, lineSpacing: 14 });
  footer(s);
  s.addNotes('Click every one of these on the projector machine the morning of the session. Fifteen minutes, and it removes the only thing that can derail a live demo.');
}

/* ================================================================= 19 · cheat sheet */
{
  const s = pres.addSlide();
  header(s, 'One page to keep', 'Print this. It is the whole session on a single sheet');
  const rows = [
    ['First 5 minutes', 'Health strip → alerts → funnel → journeys. Then stop.   #dashboard · #alerts · #journeys'],
    ['Normal', '~377k–490k payments/month · 50.6% success · 38.3% never attempted · 10.6% failed · 0.1% stuck'],
    ['Never attempted ≠ failed', 'Page opened, never paid. Counting it as failure overstates the rate ~4×.   #dashboard'],
    ['Journey success is meant to differ', 'New SIM 77.3% · MNP 74.0% · Invoice 58.4% · Recharge 49.8% · Checkout 36.1%'],
    ['Two permanent ambers', 'API GW nodes 3/6 (firewalled) · ServiceNow not configured. Neither is an incident.'],
    ['Blank bank message', 'Normal on Apple Pay / STC Pay. Read the STATUS and the RAIL, not the empty text.'],
    ['Voucher 0 vs 00', '"00" = success. "0" = FailedInBRM, technical, escalate. Opposites.'],
    ['You close', 'Abandoned · funds · CVV · expired · issuer · wrong or used voucher.   #troubleshoot?cls=business'],
    ['You escalate', 'Timeouts · gateway errors · Transaction Type not Supported · FailedInBRM · stuck after answer.   #troubleshoot?cls=technical'],
    ['Escalate immediately', 'Gateway says PAID, we say failed. That is money.'],
    ['A good ticket', 'What · who/how many · when it started · the gateway\'s own words · what you ruled out.   #tickets'],
    ['When unsure', 'Escalate and say what you were unsure about. Nobody is criticised for that.'],
  ];
  table(s, ['Remember', 'The line that matters'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 10.5, fontFace: HEAD } },
    { text: r[1], options: { color: MUTED, fontSize: 10.5, fontFace: BODY } },
  ]), { y: 1.45, colW: [3.4, 8.8], fs: 10.5 });
  footer(s);
  s.addNotes('Print one per person before the session and hand it out at the start, not the end — they will annotate it as we go.');
}

/* ================================================================= 20 · close */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('BY THE END OF SESSION 2', { x: 0.7, y: 1.4, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('What L1 owns from here', { x: 0.7, y: 1.9, w: 11.9, h: 0.9, fontSize: 38, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });

  const own = [
    ['Open and read the shift', 'Four steps, three minutes, and a handover line that means something.'],
    ['Answer a payment call unaided', 'One MSISDN to a plain-language answer, with the gateway on screen.'],
    ['Split business from technical', 'Close the nine in ten. Escalate the rest with five lines.'],
    ['Raise a ticket L2 opens first', 'Because line five says what you already ruled out.'],
  ];
  own.forEach((o, i) => {
    const x = 0.7 + (i % 2) * 6.1, y = 3.15 + Math.floor(i / 2) * 1.55;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 5.85, h: 1.35, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(o[0], { x: x + 0.25, y: y + 0.18, w: 5.35, h: 0.34, fontSize: 14, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(o[1], { x: x + 0.25, y: y + 0.56, w: 5.35, h: 0.7, fontSize: 11.5, color: 'BFE3CF', fontFace: BODY, margin: 0, lineSpacing: 15 });
  });

  s.addText('Session 2 · Wednesday 26 August, 11:00 – 13:00 — alerts, raising a good ticket, Yusr, monitoring, and DMS for L1.',
    { x: 0.7, y: 6.15, w: 11.5, h: 0.4, fontSize: 13, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  s.addText('Console: https://salam.sa/digital-console/', { x: 0.7, y: 6.55, w: 8, h: 0.3, fontSize: 12, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
}

pres.writeFile({ fileName: OUT }).then(() => console.log('✓ ' + OUT + `  (${page} slides)`));
