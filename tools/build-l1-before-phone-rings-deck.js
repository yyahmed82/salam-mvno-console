/* Salam Digital Console — L1 workshop, ALTERNATE DECK: "Before the phone rings".
 *
 * Same visual template as build-l1-session1-deck.js, same five-part shape, same clickable buttons.
 * Different job: this one is lighter, far less technical, and organised around the CUSTOMER and the
 * CALL CENTRE rather than around the console's architecture. Use it with a room that will glaze
 * over at a funnel chart, or as the warm-up before the technical deck.
 *
 * The running idea: L1 is in a race with the call centre. Every problem found early is a queue of
 * calls that never happens. Everything on these slides serves that one idea.
 *
 * ON THE HUMOUR — it is aimed at the SITUATION and at US, never at customers and never at the call
 * centre. "The Ghost" is a payment page, not a person. A trainee who feels laughed at stops asking
 * questions, and questions are the entire point of a first session.
 *
 * ON THE NUMBERS — the measured ones are the same as the technical deck (12-month catalog and the
 * UPG export). Anything DERIVED by arithmetic (per-day, per-minute, "if one in twenty calls") is
 * labelled on the slide as an estimate. A funny deck is not a licence to invent figures; the one
 * thing that would destroy its credibility in front of L1 is a number they later find is made up.
 *
 * Build:  node tools/build-l1-before-phone-rings-deck.js
 *         python3 tools/pptx-shape-links.py <the .pptx>     ← REQUIRED, makes the buttons clickable
 */
'use strict';
const pptxgen = require('pptxgenjs');

const OUT = process.env.OUT_FILE
  || '/sessions/upbeat-happy-archimedes/mnt/Salam DMS/Salam-Console-L1-Before-The-Phone-Rings.pptx';

const INK = '11241D', GREEN = '00A651', DARK = '0B3B2E', MUTED = '5F6F69',
      LIGHT = 'F2F6F3', AMBER = 'B26B00', RED = 'B3261E', BLUE = '2563EB', WHITE = 'FFFFFF';
const BODY = 'Calibri', HEAD = 'Calibri';

const BASE = 'salam.sa/digital-console/';
const url = h => BASE + '#' + h;
const href = h => 'https://' + url(h);
function shortLabel(h) {
  const [route, qs] = String(h).split('?');
  if (!qs) return '#' + route;
  const m = /(?:^|&)(cls|tab|cat)=([^&]+)/.exec(qs);
  return m ? '#' + route + ' · ' + m[2] : '#' + route;
}

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Yosri A Yahmed';
pres.title = 'Salam Digital Console — L1: before the phone rings';

let page = 0;
function footer(s, dark) {
  page++;
  s.addText('Salam Digital Console · L1 · before the phone rings',
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

/* a "grumpiness" meter — three dots, filled to taste. Cheaper than an emoji and it prints. */
function meter(s, x, y, level, color) {
  for (let i = 0; i < 3; i++) {
    s.addShape(pres.ShapeType.ellipse, { x: x + i * 0.22, y, w: 0.16, h: 0.16,
      fill: { color: i < level ? color : 'DDE7E1' }, line: { color: i < level ? color : 'DDE7E1' } });
  }
}

/* ============================================================ 1 · title */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Salam · DIGITAL CONSOLE · L1', { x: 0.7, y: 0.75, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('Before the phone rings', { x: 0.7, y: 1.3, w: 11.9, h: 1.0, fontSize: 46, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Finding the problem first — and raising the ticket while it is still small',
    { x: 0.7, y: 2.42, w: 11.5, h: 0.6, fontSize: 17, color: 'BFE3CF', fontFace: BODY, margin: 0 });

  const stats = [
    ['~1', 'payment fails per minute', 'somewhere, all day, every day'],
    ['9 in 10', 'are not our fault', 'the bank said no. Really.'],
    ['0', 'customers enjoy calling us', 'nobody rings to say "it worked"'],
    ['3 min', 'to check everything', 'that is the entire morning routine'],
  ];
  stats.forEach((st, i) => {
    const x = 0.7 + i * 3.05;
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.6, w: 2.8, h: 1.75, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(st[0], { x: x + 0.22, y: 3.75, w: 2.4, h: 0.6, fontSize: 28, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(st[1], { x: x + 0.22, y: 4.4, w: 2.45, h: 0.35, fontSize: 12, bold: true, color: WHITE, fontFace: BODY, margin: 0 });
    s.addText(st[2], { x: x + 0.22, y: 4.75, w: 2.45, h: 0.5, fontSize: 10.5, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  });
  s.addText('Yosri A Yahmed · Digital Operations · bring a laptop, not a notebook',
    { x: 0.7, y: 6.4, w: 8, h: 0.3, fontSize: 12, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
  s.addNotes('Open with the "~1 per minute" number. It is real (553,662 failures over 12 months) and it wakes the room up.');
}

/* ============================================================ 2 · the race */
{
  const s = pres.addSlide();
  header(s, 'The whole job in one picture', 'There are two ways we find out something is broken');
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 1.5, w: 12.2, h: 1.75, fill: { color: 'EAF7F0' }, line: { color: GREEN, width: 1.25 }, rectRadius: 0.08 });
  s.addText('THE GOOD WAY', { x: 0.85, y: 1.62, w: 3, h: 0.3, fontSize: 10, bold: true, color: GREEN, charSpacing: 1.2, fontFace: BODY, margin: 0 });
  ['Something breaks', 'You notice it', 'You raise a ticket', 'It is fixed', 'Nobody calls'].forEach((t, i) => {
    const x = 0.9 + i * 2.4;
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.05, w: 2.15, h: 0.75, fill: { color: WHITE }, line: { color: GREEN }, rectRadius: 0.06 });
    s.addText(t, { x: x + 0.08, y: 2.05, w: 1.99, h: 0.75, fontSize: 11, bold: true, color: INK, align: 'center', valign: 'middle', fontFace: BODY, margin: 0 });
    if (i < 4) s.addText('›', { x: x + 2.16, y: 2.22, w: 0.24, h: 0.4, fontSize: 17, bold: true, color: GREEN, align: 'center', fontFace: HEAD, margin: 0 });
  });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 3.45, w: 12.2, h: 1.75, fill: { color: 'FDF0EE' }, line: { color: RED, width: 1.25 }, rectRadius: 0.08 });
  s.addText('THE OTHER WAY', { x: 0.85, y: 3.57, w: 3, h: 0.3, fontSize: 10, bold: true, color: RED, charSpacing: 1.2, fontFace: BODY, margin: 0 });
  ['Something breaks', 'Customers notice', 'They call', 'And call', 'Then we notice'].forEach((t, i) => {
    const x = 0.9 + i * 2.4;
    s.addShape(pres.ShapeType.roundRect, { x, y: 4.0, w: 2.15, h: 0.75, fill: { color: WHITE }, line: { color: RED }, rectRadius: 0.06 });
    s.addText(t, { x: x + 0.08, y: 4.0, w: 1.99, h: 0.75, fontSize: 11, bold: true, color: INK, align: 'center', valign: 'middle', fontFace: BODY, margin: 0 });
    if (i < 4) s.addText('›', { x: x + 2.16, y: 4.17, w: 0.24, h: 0.4, fontSize: 17, bold: true, color: RED, align: 'center', fontFace: HEAD, margin: 0 });
  });

  s.addText('Same fault. Same fix. The only difference is who found it — and how many people had a bad morning first.',
    { x: 0.55, y: 5.45, w: 12.2, h: 0.4, fontSize: 14, bold: true, color: INK, fontFace: BODY, margin: 0 });
  s.addText('That gap is the job. Not the console, not the dashboards — the gap.',
    { x: 0.55, y: 5.88, w: 12.2, h: 0.4, fontSize: 12.5, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ============================================================ 3 · divider 1 */
{
  const s = pres.addSlide();
  divider(s, 1, 'What the customer actually feels', 'Translating console words into human ones',
    'Nobody has ever phoned to say "my payment returned HTTP 200 and I am delighted".');
}

/* ============================================================ 4 · translation */
{
  const s = pres.addSlide();
  header(s, 'The translation table', 'Left column: what the screen says. Right column: what you will hear on the phone');
  const rows = [
    ['Never attempted', '"I opened it and changed my mind."', 1, GREEN, 'Nothing. Truly nothing.'],
    ['Declined — insufficient funds', '"Your app is broken!" (it is the bank)', 2, GREEN, 'Explain kindly. Close it.'],
    ['Declined — wrong CVV', '"It says my card is wrong, but it is not."', 2, GREEN, 'Ask them to re-type it. Close it.'],
    ['Abandoned', '"I was going to pay but the page just sat there."', 2, AMBER, 'Usually nothing. Watch for a spike.'],
    ['Transaction type not supported', '"It works on my other SIM!" — and they are right', 3, RED, 'Not their fault. Ticket.'],
    ['Stuck after the gateway answered', '"YOU TOOK MY MONEY."', 3, RED, 'Ticket. Immediately. Do not wait.'],
  ];
  table(s, ['What the console says', 'What the customer says', 'Grumpiness', 'What you do'],
    rows.map(r => [
      { text: r[0], options: { bold: true, color: INK, fontSize: 11, fontFace: BODY } },
      { text: r[1], options: { color: MUTED, italic: true, fontSize: 11, fontFace: BODY } },
      { text: '', options: {} },
      { text: r[4], options: { color: r[3], bold: true, fontSize: 10.5, fontFace: BODY } },
    ]), { y: 1.5, colW: [3.5, 4.6, 1.5, 2.6], fs: 11, rowH: 0.46 });
  rows.forEach((r, i) => meter(s, 8.9, 1.5 + 0.46 * (i + 1) + 0.15, r[2], r[3]));

  s.addText('Only the bottom two rows are ours. The other four are a conversation, not an incident — and knowing the difference '
          + 'is most of what makes an L1 shift calm instead of frantic.',
    { x: 0.55, y: 4.85, w: 12.2, h: 0.6, fontSize: 12.5, color: INK, fontFace: BODY, margin: 0, lineSpacing: 17 });
  urlbar(s, 5.6, 'every one of these, with the real message, lives here', 'troubleshoot');
  footer(s);
}

/* ============================================================ 5 · three customers */
{
  const s = pres.addSlide();
  header(s, 'The three you will meet every single day', 'Learn these and you have met 95% of your callers');
  cards(s, [
    ['The Ghost', 'Opened the payment page. Went to make tea. Never came back. Two million of these last year — more than every real failure combined. '
      + 'Not a bug, not a ticket, not your problem. Let the Ghost go.', MUTED],
    ['The Retryer', 'Tried once, it failed, tried again, it worked. Now has two SMS from the bank and one heart attack. '
      + 'Usually charged once. Check whether the second attempt succeeded BEFORE you say anything about money.', BLUE],
    ['The One Who Actually Paid', 'Our record says failed. The gateway says PAID. This one is rare, real, and about money. '
      + 'It goes straight to a ticket — not at the end of your shift, now.', RED],
  ], { y0: 1.55, cols: 3, w: 3.9, h: 2.45, fs: 11 });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.3, w: 12.2, h: 1.5, fill: { color: 'FFF7E8' }, line: { color: 'E8C48A' }, rectRadius: 0.06 });
  s.addText('The mistake that makes a calm day into a bad one', { x: 0.85, y: 4.45, w: 11.6, h: 0.32, fontSize: 13.5, bold: true, color: AMBER, fontFace: HEAD, margin: 0 });
  s.addText('Treating a crowd of Ghosts as an outage. Last year 38% of all payments were opened and abandoned — that is normal, '
          + 'every day, forever. If you raise an incident because "38% failed", you will spend the morning explaining, and the '
          + 'real problem will still be sitting there at lunchtime.',
    { x: 0.85, y: 4.81, w: 11.6, h: 0.85, fontSize: 12, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 16 });
  urlbar(s, 5.95, 'the Ghosts, the Retryers and the rest of them', 'dashboard');
  footer(s);
}

/* ============================================================ 6 · divider 2 */
{
  const s = pres.addSlide();
  divider(s, 2, 'The tells', 'How a real problem announces itself',
    'Real problems have manners: they arrive suddenly, they pick one journey, and they bring a new excuse.');
}

/* ============================================================ 7 · the tells */
{
  const s = pres.addSlide();
  header(s, 'Three tells', 'If two of these are true, stop reading and raise the ticket');
  cards(s, [
    ['1 · It arrived suddenly', 'Fine at 14:19, broken at 14:20. Real faults have a start time. Slow slopes are usually a campaign ending or a payday — annoying, not urgent.', RED],
    ['2 · It picked one lane', 'Only recharge? Only new SIM? A fault with a favourite journey is a fault with a cause. If EVERYTHING is bad, that is bigger and louder — escalate faster.', RED],
    ['3 · It brought a new excuse', 'A message at the top of the list that was not there yesterday. Same old messages in the same old order = same old life.', RED],
  ], { y0: 1.55, cols: 3, w: 3.9, h: 2.25, fs: 11 });

  s.addText('And the anti-tell: the numbers look bad but the shape is unchanged. That is volume, not breakage. Breathe.',
    { x: 0.55, y: 4.05, w: 12.2, h: 0.4, fontSize: 13, bold: true, color: GREEN, fontFace: BODY, margin: 0 });

  cards(s, [
    ['Two ambers that are always amber', 'API GW nodes 3 of 6 (the rest are firewalled from us) and ServiceNow (not connected). '
      + 'They have been amber since before you joined and will be amber after we all retire. Not incidents.', AMBER],
    ['The one that is always worth a look', 'Anything where our record and the gateway disagree. Rare, quiet, and about money — '
      + 'which is why it never announces itself loudly like the harmless ones do.', RED],
  ], { y0: 4.6, cols: 2, w: 6.0, gapx: 6.25, h: 1.7, fs: 11 });
  footer(s);
  s.addNotes('The two permanent ambers cost more wasted escalations than any real fault. Say them twice.');
}

/* ============================================================ 8 · divider 3 */
{
  const s = pres.addSlide();
  divider(s, 3, 'Beat the clock', 'The ticket at 11:02 and the ticket at 14:30 are not the same ticket',
    'One is a heads-up. The other is an archaeology project with an audience.');
}

/* ============================================================ 9 · the clock */
{
  const s = pres.addSlide();
  header(s, 'What one hour costs', 'The same fault, told twice');
  const t = [
    ['00:00', 'Something breaks', 'Nobody knows yet. Not even the customers.', GREEN],
    ['00:03', 'YOU see it', 'One lane looks wrong on the dashboard. Ticket raised with a timestamp.', GREEN],
    ['00:10', 'First customer notices', 'Tries again. Gets through, or gives up quietly.', AMBER],
    ['00:25', 'First call reaches the centre', 'One agent, one customer, no context, no ticket to point at.', AMBER],
    ['00:45', 'The calls have a pattern', 'Now several agents are improvising different answers to the same question.', RED],
    ['01:00', 'It becomes an escalation', 'And somebody asks the worst question: "how long has this been happening?"', RED],
  ];
  t.forEach((r, i) => {
    const y = 1.5 + i * 0.78;
    s.addShape(pres.ShapeType.roundRect, { x: 0.55, y, w: 1.15, h: 0.62, fill: { color: r[3] }, line: { color: r[3] }, rectRadius: 0.05 });
    s.addText(r[0], { x: 0.55, y, w: 1.15, h: 0.62, fontSize: 12.5, bold: true, color: WHITE, align: 'center', valign: 'middle', fontFace: HEAD, margin: 0 });
    s.addText(r[1], { x: 1.9, y: y + 0.04, w: 3.5, h: 0.28, fontSize: 12.5, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(r[2], { x: 1.9, y: y + 0.3, w: 10.6, h: 0.32, fontSize: 11, color: MUTED, fontFace: BODY, margin: 0 });
  });
  s.addText('Timings illustrative — the ORDER is what matters, not the exact minutes.',
    { x: 0.55, y: 6.12, w: 12.2, h: 0.3, fontSize: 10, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  s.addText('If you are at 00:03, the rest of that list never happens. That is the whole value of the role, and it is worth more '
          + 'than any answer you give once the phone is already ringing.',
    { x: 0.55, y: 6.42, w: 12.2, h: 0.55, fontSize: 12.5, bold: true, color: INK, fontFace: BODY, margin: 0, lineSpacing: 16 });
  footer(s);
}

/* ============================================================ 10 · divider 4 */
{
  const s = pres.addSlide();
  divider(s, 4, 'Raise it well', 'Five lines, and an L2 opens yours first',
    'A good ticket is not a long ticket. Nobody has ever thanked anyone for a long ticket.');
}

/* ============================================================ 11 · the five lines */
{
  const s = pres.addSlide();
  header(s, 'The five-line ticket', 'If you can answer these, you are done. If you cannot, that is fine — say so.');
  const rows = [
    ['1 · What', '"Recharge payments failing on STC Pay."', 'One sentence. No jargon needed.'],
    ['2 · How many / who', '"About 40 in the last hour" or "one customer, 9665…"', 'Scale changes the response.'],
    ['3 · Since when', '"Started 14:20. Clean before that."', 'The single most useful line you can write.'],
    ['4 · What it says', 'The gateway message, copied exactly.', 'Copied — not remembered, not paraphrased.'],
    ['5 · What it is not', '"Not abandonment — the failed count moved, not the drop-off."', 'This is the line that earns trust.'],
  ];
  table(s, ['Line', 'Looks like', 'Why it matters'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 11.5, fontFace: HEAD } },
    { text: r[1], options: { color: INK, italic: true, fontSize: 11, fontFace: BODY } },
    { text: r[2], options: { color: MUTED, fontSize: 11, fontFace: BODY } },
  ]), { y: 1.5, colW: [2.5, 5.2, 4.5], fs: 11, rowH: 0.5 });

  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 4.65, w: 6.0, h: 1.55, fill: { color: 'FDF0EE' }, line: { color: 'E8B4AE' }, rectRadius: 0.06 });
  s.addText('A ticket that helps nobody', { x: 0.85, y: 4.78, w: 5.4, h: 0.3, fontSize: 12.5, bold: true, color: RED, fontFace: HEAD, margin: 0 });
  s.addText('"Payments not working. Please check urgently."\n\nNo number, no time, no message, no journey. '
          + 'Six people now have to ask you six questions before anyone can start.',
    { x: 0.85, y: 5.1, w: 5.4, h: 1.0, fontSize: 11, color: MUTED, italic: true, fontFace: BODY, margin: 0, lineSpacing: 15 });

  s.addShape(pres.ShapeType.roundRect, { x: 6.75, y: 4.65, w: 6.0, h: 1.55, fill: { color: 'EAF7F0' }, line: { color: 'B8E0CC' }, rectRadius: 0.06 });
  s.addText('The same ticket, done well', { x: 7.05, y: 4.78, w: 5.4, h: 0.3, fontSize: 12.5, bold: true, color: GREEN, fontFace: HEAD, margin: 0 });
  s.addText('"STC Pay recharges failing since 14:20, ~40 so far, gateway says \'transaction declined (format error)\'. '
          + 'Not abandonment — the failed count moved."\n\nNobody has to ask you anything.',
    { x: 7.05, y: 5.1, w: 5.4, h: 1.0, fontSize: 11, color: MUTED, italic: true, fontFace: BODY, margin: 0, lineSpacing: 15 });
  urlbar(s, 6.35, 'raise it here', 'tickets');
  footer(s);
}

/* ============================================================ 12 · when unsure */
{
  const s = pres.addSlide();
  header(s, 'And when you are not sure', 'Read this slide twice — it is the one people ignore');
  s.addShape(pres.ShapeType.roundRect, { x: 0.55, y: 1.55, w: 12.2, h: 1.3, fill: { color: DARK }, line: { color: DARK }, rectRadius: 0.08 });
  s.addText('Raise it anyway. Say what you were unsure about.',
    { x: 0.85, y: 1.55, w: 11.6, h: 1.3, fontSize: 22, bold: true, color: WHITE, valign: 'middle', fontFace: HEAD, margin: 0 });

  cards(s, [
    ['A wrong escalation', 'Costs an L2 about ten minutes and a small smile. That is the entire downside. Nobody keeps a list.', GREEN],
    ['A missed real fault', 'Costs customers their evening, the call centre their queue, and somebody a difficult meeting tomorrow.', RED],
    ['So the maths is easy', 'Ten minutes against an evening. If you are hesitating, you have already worked out the answer.', GREEN],
  ], { y0: 3.1, cols: 3, w: 3.9, h: 1.85, fs: 11 });

  s.addText('Nobody in this company has ever been criticised for escalating something that turned out to be fine. '
          + 'People do get remembered for the one they saw and did not mention.',
    { x: 0.55, y: 5.25, w: 12.2, h: 0.6, fontSize: 13, bold: true, color: INK, fontFace: BODY, margin: 0, lineSpacing: 17 });
  footer(s);
  s.addNotes('Say this out loud and mean it. It is the single biggest blocker to early tickets in every team I have trained.');
}

/* ============================================================ 13 · divider 5 */
{
  const s = pres.addSlide();
  divider(s, 5, 'Spot it first', 'A game, with a scoreboard',
    'Three rounds. Real screens, real data, no trick questions — although one round is a Ghost.');
}

/* ============================================================ 14 · the game */
{
  const s = pres.addSlide();
  header(s, 'The game', 'Three rounds · two minutes each · say your answer out loud');
  const rows = [
    ['Round 1', 'Here is today. Is anything wrong?', 'Correct answer is often "no". Saying so confidently scores full marks.'],
    ['Round 2', 'Here is a number that moved. Real or noise?', 'Sudden or slow? One lane or all? New message or the usual ones?'],
    ['Round 3', 'A customer is on the line. What do you tell them?', 'One plain sentence. No jargon. No promises about money you have not checked.'],
  ];
  table(s, ['Round', 'What you get', 'What scores points'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 12, fontFace: HEAD } },
    { text: r[1], options: { color: INK, fontSize: 11.5, fontFace: BODY } },
    { text: r[2], options: { color: MUTED, fontSize: 11, fontFace: BODY } },
  ]), { y: 1.5, colW: [1.5, 4.6, 6.1], fs: 11.5, rowH: 0.62 });

  cards(s, [
    ['+3 points', 'Naming what it is NOT. "This is not abandonment because…" is the hardest and most valuable move in the job.', GREEN],
    ['+2 points', 'Getting to the gateway message instead of guessing from our own status.', GREEN],
    ['−1 point', 'The word "urgent" with no timestamp attached to it.', AMBER],
  ], { y0: 3.75, cols: 3, w: 3.9, h: 1.6, fs: 11 });

  urlbar(s, 5.6, 'everything you need is behind these two', ['dashboard', 'troubleshoot']);
  footer(s);
  s.addNotes('Keep it light. The scoreboard is a joke; the habits are not.');
}

/* ============================================================ 15 · cheat sheet */
{
  const s = pres.addSlide();
  header(s, 'The whole thing on one page', 'Print it. Stick it where you can see it.');
  const rows = [
    ['Every morning', 'Health strip → alerts → dashboard → journeys. Three minutes. Then get on with your day.'],
    ['If all four look normal', 'Say so in the handover. "Checked, normal" is a real answer.'],
    ['Never attempted', 'The Ghost. 38% of everything. Not a failure, not a ticket.'],
    ['Two permanent ambers', 'API GW 3/6 and ServiceNow. Always amber. Never an incident.'],
    ['You close it', 'No funds · wrong CVV · expired card · bank said no · wrong or used voucher.'],
    ['You raise it', 'Timeouts · gateway errors · "type not supported" · anything stuck after the gateway answered.'],
    ['You raise it NOW', 'Gateway says PAID, we say failed. That is money. Do not wait for the shift end.'],
    ['Three tells', 'Sudden start · one lane · a new message at the top. Two of three = ticket.'],
    ['The five lines', 'What · how many · since when · what it says · what it is not.'],
    ['If unsure', 'Raise it and say what you were unsure about. Ten minutes beats an evening.'],
    ['The best shift', 'A boring one. Boring means somebody upstream did their job — often you.'],
  ];
  table(s, ['Remember', 'The line that matters'], rows.map(r => [
    { text: r[0], options: { bold: true, color: INK, fontSize: 11, fontFace: HEAD } },
    { text: r[1], options: { color: MUTED, fontSize: 11, fontFace: BODY } },
  ]), { y: 1.5, colW: [3.2, 9.0], fs: 11, rowH: 0.42 });
  footer(s);
}

/* ============================================================ 16 · close */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('THE POINT OF ALL THIS', { x: 0.7, y: 1.5, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('The best shift is a boring shift', { x: 0.7, y: 2.0, w: 11.9, h: 0.9, fontSize: 40, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Nobody will ever thank you for the outage that did not happen. You will just have a quiet Tuesday, '
          + 'and so will several thousand customers who never knew your name.',
    { x: 0.7, y: 3.1, w: 11.3, h: 0.9, fontSize: 15, color: 'BFE3CF', fontFace: BODY, margin: 0, lineSpacing: 21 });

  const own = [
    ['Check it in three minutes', 'Four steps, same order, every shift.'],
    ['Know the Ghost from the real thing', 'Most of what looks broken is not.'],
    ['Say it in one sentence', 'To a customer, with no jargon in it.'],
    ['Raise it while it is small', 'Five lines. Before the phone rings.'],
  ];
  own.forEach((o, i) => {
    const x = 0.7 + (i % 2) * 6.1, y = 4.3 + Math.floor(i / 2) * 1.3;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 5.85, h: 1.1, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(o[0], { x: x + 0.25, y: y + 0.14, w: 5.35, h: 0.32, fontSize: 14, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(o[1], { x: x + 0.25, y: y + 0.5, w: 5.35, h: 0.5, fontSize: 11.5, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  });
  s.addText('Questions — and please bring the thing that annoyed you most this week.',
    { x: 0.7, y: 6.5, w: 11.5, h: 0.4, fontSize: 13, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
}

pres.writeFile({ fileName: OUT }).then(() => console.log('✓ ' + OUT + `  (${page} slides)`));
