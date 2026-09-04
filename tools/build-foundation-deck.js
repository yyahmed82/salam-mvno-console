/* Salam Digital Console — FOUNDATION deck: February → 13 August 2026.
 * Companion to build-l2-deck.js (which covers 13–22 Aug). Same visual language on purpose.
 *
 * SOURCES — every date and figure on a slide traces to something checkable:
 *   · Feb/Mar dates  = docProps/core.xml of the source documents (created/modified), not file mtimes
 *   · 22 Jul         = mvno-console/CHANGELOG.md, v1.0.0
 *   · 9–13 Aug       = the mail thread ("Re: Digital Console — L2 review sessions")
 *   · 19 Aug         = the "imported 2026-08-19" stamp printed on the docs pages themselves
 *   · every KPI      = read off the screenshot placed on that same slide
 * If a figure is not visible in the picture beside it, it is not written on the slide.
 *
 * Screenshots: old/oNN.png (browser chrome cropped). Two are edited and the edit is deliberate:
 *   o14_phone  — cropped out of a WhatsApp media viewer to the customer's phone screen alone
 *   o28_safe   — the page masks NID and MSISDN, but the SEARCH BOX still held the full national
 *                id; that one field is blurred. Nothing else is retouched.
 *
 * Build:  node tools/build-foundation-deck.js
 */
'use strict';
const pptxgen = require('pptxgenjs');
const path = require('path');

const SHOTS = process.env.SHOTS_DIR || '/sessions/upbeat-happy-archimedes/old';
const OUT = process.env.OUT_FILE || '/sessions/upbeat-happy-archimedes/mnt/outputs/Salam-Digital-Console-Foundation-Feb-Aug2026.pptx';
const fs = require('fs');
/* prefer the optimised .jpg written by tools/optimize-shots.py — a 21 MB deck does not fit
 * an email; the .png stays the master. */
const pick = base => { const j = base.replace(/\.png$/, '.jpg'); return fs.existsSync(j) ? j : base; };
const o = n => pick(path.join(SHOTS, typeof n === 'string' ? `${n}.png` : `o${String(n).padStart(2, '0')}.png`));

const INK = '11241D', GREEN = '00A651', DARK = '0B3B2E', MUTED = '5F6F69',
      LIGHT = 'F2F6F3', AMBER = 'B26B00', WHITE = 'FFFFFF';
const BODY = 'Calibri', HEAD = 'Calibri';
const NB = ' ';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Yosri A Yahmed';
pres.title  = 'Salam Digital Console — foundation, February to August 2026';

const shadow = () => ({ type: 'outer', color: '9AA8A2', blur: 14, offset: 3, angle: 90, opacity: 0.45 });

let page = 0;
function footer(s, dark) {
  page++;
  s.addText('Salam Digital Console · February – August 2026',
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
  s.addText(title, { x: 1.15, y: 0.6, w: 11.6, h: 0.5, fontSize: 25, bold: true, color: INK, fontFace: HEAD, margin: 0 });
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

/* standard slide: one wide screenshot left, "what it answers" right */
function shot(kicker, title, image, bullets, note) {
  const s = pres.addSlide();
  header(s, kicker, title);
  // a note needs real clearance under the picture, so the picture gets shorter — not the gap
  const h = note ? 4.72 : 4.91;
  s.addImage({ path: o(image), x: 0.55, y: 1.5, w: 8.5, h, shadow: shadow() });
  // spread the bullets down the full height of the picture instead of stopping two thirds up
  points(s, 9.45, 1.6, 3.35, bullets, bullets.length >= 4 ? 1.45 : 1.85);
  if (note) s.addText(note, { x: 0.55, y: 6.55, w: 11.9, h: 0.35, fontSize: 10, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  footer(s);
  return s;
}

/* TWO screenshots, side by side at native aspect, with the points as a card row underneath.
 * Stacking them was the original plan and it was wrong: 7.4 x 2.45 is aspect 3.02 against a
 * 1.731 source, so both pictures were squashed to 57% of their height. Side by side is the only
 * arrangement that fits two undistorted 16:9-ish screenshots on one slide. */
function shot2(kicker, title, imgA, imgB, bullets) {
  const s = pres.addSlide();
  header(s, kicker, title);
  const w = 6.03, h = w / 1.731;            // 3.48 — native aspect, never guessed
  s.addImage({ path: o(imgA), x: 0.55, y: 1.5, w, h, shadow: shadow() });
  s.addImage({ path: o(imgB), x: 6.77, y: 1.5, w, h, shadow: shadow() });
  bullets.slice(0, 4).forEach((b, i) => {
    const x = 0.55 + i * 3.09;
    s.addShape(pres.ShapeType.roundRect, { x, y: 5.25, w: 2.94, h: 1.45, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addText(b[0], { x: x + 0.2, y: 5.38, w: 2.55, h: 0.3, fontSize: 11.5, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(b[1], { x: x + 0.2, y: 5.68, w: 2.55, h: 0.9, fontSize: 10, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 12 });
  });
  footer(s);
  return s;
}

/* ============================ 1 · title ============================ */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('Salam · DIGITAL CONSOLE', { x: 0.7, y: 0.7, w: 8, h: 0.3, fontSize: 12, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('From architecture to production', { x: 0.7, y: 1.25, w: 11.9, h: 0.9, fontSize: 42, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
  s.addText('Six months of MVNO digital operations — February to August 2026', { x: 0.7, y: 2.2, w: 11.5, h: 0.5, fontSize: 17, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  s.addText('Everything the console does today, and how it got here. For the L2 teams — Digital and DMS.',
    { x: 0.7, y: 2.72, w: 11.5, h: 0.4, fontSize: 13, color: '8FC3A8', fontFace: BODY, margin: 0 });

  const stats = [
    ['24', 'customer journeys', 'documented step by step'],
    ['66', 'alert rules', '37 technical · 25 business'],
    ['32', 'external integrations', 'mapped from the code'],
    ['4.1 M', 'payments in the replica', 'synced and queryable'],
  ];
  stats.forEach((st, i) => {
    const x = 0.7 + i * 3.05;
    s.addShape(pres.ShapeType.roundRect, { x, y: 3.55, w: 2.8, h: 1.8, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(st[0], { x: x + 0.22, y: 3.72, w: 2.4, h: 0.6, fontSize: 30, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(st[1], { x: x + 0.22, y: 4.37, w: 2.45, h: 0.35, fontSize: 12, bold: true, color: WHITE, fontFace: BODY, margin: 0 });
    s.addText(st[2], { x: x + 0.22, y: 4.72, w: 2.45, h: 0.5, fontSize: 10.5, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  });
  s.addText('Yosri A Yahmed · Digital Operations · 22 August 2026', { x: 0.7, y: 5.72, w: 8, h: 0.3, fontSize: 12, color: '8FC3A8', fontFace: BODY, margin: 0 });
  footer(s, true);
  s.addNotes('Companion deck: "What shipped since 13 August" covers the most recent week.');
}

/* ============================ 2 · the arc ============================ */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('THE ARC', { x: 0.7, y: 0.45, w: 6, h: 0.3, fontSize: 11, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('Two phases: understand the estate, then instrument it', { x: 0.7, y: 0.78, w: 11.9, h: 0.6, fontSize: 30, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });

  /* month rail */
  const months = ['FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG'];
  const railY = 2.05, railX = 0.75, railW = 11.8, step = railW / months.length;
  s.addShape(pres.ShapeType.rect, { x: railX, y: railY + 0.34, w: railW, h: 0.02, fill: { color: '2C7A5B' }, line: { color: '2C7A5B' } });
  months.forEach((m, i) => {
    const cx = railX + i * step + step / 2;
    const build = i >= 5;
    s.addShape(pres.ShapeType.ellipse, { x: cx - 0.075, y: railY + 0.27, w: 0.15, h: 0.15, fill: { color: build ? '5FD39B' : '2C7A5B' }, line: { color: build ? '5FD39B' : '2C7A5B' } });
    s.addText(m, { x: cx - 0.5, y: railY - 0.08, w: 1.0, h: 0.28, fontSize: 11, bold: true, color: build ? '5FD39B' : '8FC3A8', align: 'center', fontFace: BODY, margin: 0 });
  });

  const phases = [
    ['PHASE 1 · FEBRUARY – JUNE', 'Understand what we are running', '1C6B50', [
      ['3 Feb', 'MVNO Digital / DMS Ramadan-readiness operational status'],
      ['5 Feb', 'DMS Architecture — the estate written down'],
      ['16 Feb', 'Optiva · Manafith API logging implementation'],
      ['18 Feb → 9 Mar', 'Hybrid Portal / DMS commission model'],
      ['Feb – Jun', 'DMS integration HLD, infra topology, and day-to-day incident support'],
    ]],
    ['PHASE 2 · JULY – AUGUST', 'Turn the knowledge into a tool', '2C7A5B', [
      ['7 Jul', 'Selfcare code analysis + data-flow map — the console\'s source of truth'],
      ['9 Jul', 'Build starts: journeys, data model and integrations catalogued from the code'],
      ['22 Jul', 'v1.0.0 — dashboard, alert engine, troubleshooting, growth, data trust'],
      ['9 Aug', 'Live on production data; L2 review opened'],
      ['9 – 11 Aug', 'Three L2 review sessions — 12 definitions signed off, 43 rules challenged'],
      ['12 – 13 Aug', 'Tickets & feedback · L2 Workbench · Monitoring (API health)'],
    ]],
  ];
  phases.forEach((p, i) => {
    const x = 0.7 + i * 6.2;
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.75, w: 5.9, h: 3.55, fill: { color: '12513C' }, line: { color: p[2] }, rectRadius: 0.08 });
    s.addText(p[0], { x: x + 0.3, y: 2.92, w: 5.3, h: 0.28, fontSize: 10.5, bold: true, color: '7FD3A6', charSpacing: 1, fontFace: BODY, margin: 0 });
    s.addText(p[1], { x: x + 0.3, y: 3.2, w: 5.3, h: 0.34, fontSize: 15, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });
    p[3].forEach((r, j) => {
      const y = 3.66 + j * (p[3].length > 5 ? 0.43 : 0.5);
      s.addText(r[0], { x: x + 0.3, y, w: 1.35, h: 0.3, fontSize: 10.5, bold: true, color: '5FD39B', fontFace: BODY, margin: 0 });
      s.addText(r[1], { x: x + 1.65, y, w: 3.95, h: 0.42, fontSize: 10.5, color: 'DCEFE4', fontFace: BODY, margin: 0, lineSpacing: 12 });
    });
  });
  s.addText('Dates in Phase 1 come from the documents\' own created/modified properties; Phase 2 from the repository changelog and the mail thread.',
    { x: 0.7, y: 6.45, w: 11.9, h: 0.35, fontSize: 10, italic: true, color: 'A9CFBB', fontFace: BODY, margin: 0 });
  footer(s, true);
}

/* ============================ 3 · august log ============================ */
{
  const s = pres.addSlide();
  header(s, 'The last six weeks', 'What was added, week by week');
  const weeks = [
    ['9 – 15 July', ['Journeys, data model and integrations read out of the selfcare codebase',
      'Alert runner, report scheduler and sync-health checks',
      'Prod-sync from the production replica — read-only by design']],
    ['16 – 31 July', ['Console 360 review — first internal pass over every screen',
      'v1.0.0 tagged: dashboard, alert engine, troubleshoot board, growth, data trust',
      'UPG payment monitoring written up']],
    ['1 – 8 August', ['Semati / CITC provider-outage detection and the synthetic canary',
      'INC0016809 studied: why the console stayed green through a P1',
      'Error segregation spec — business outcomes vs technical faults']],
    ['9 – 13 August', ['Live on production; three L2 review sessions run',
      'Tickets & feedback and the L2 Workbench opened to the team',
      'Monitoring: live API health from both Digital-API hosts']],
  ];
  weeks.forEach((w, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.55 + col * 6.15, y = 1.55 + row * 2.45;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 6.1, h: 2.08, fill: { color: LIGHT }, line: { color: 'DDE7E1' }, rectRadius: 0.06 });
    s.addText(w[0], { x: x + 0.3, y: y + 0.14, w: 5.3, h: 0.32, fontSize: 15, bold: true, color: DARK, fontFace: HEAD, margin: 0 });
    s.addText(w[1].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < w[1].length - 1 } })),
      { x: x + 0.3, y: y + 0.46, w: 5.55, h: 1.55, fontSize: 12, color: MUTED, fontFace: BODY, margin: 0, paraSpaceAfter: 6 });
  });
  s.addText('Everything from 13 August onward — the Monitoring rebuild, SMS tracing, UPG correlation and the DMS section — is in the companion deck.',
    { x: 0.55, y: 6.6, w: 11.9, h: 0.3, fontSize: 10, italic: true, color: AMBER, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ============================ 4 · data foundation ============================ */
shot('Data trust first', 'Nothing was built until the data could be trusted', 36, [
  ['A full copy of production, read-only', '4,111,485 payments · 4,085,720 onboarding orders · 1,718,669 eligibility logs · 1,469,160 Nafath logs.'],
  ['Row counts per table, on the page', 'so a number that looks wrong can be traced back to what was actually synced.'],
  ['Every settings change is logged', 'who changed what, and when.'],
], 'The console never writes to production. Every panel in this deck reads from this replica or from a read-only log channel.');

/* ============================ 5 · sync engine ============================ */
shot('Data trust first', 'The tool checks itself, every 15 seconds', 35, [
  ['Health self-check', '1 warning · 4 OK · 4 off — the console tells you when it is degraded instead of showing stale numbers quietly.'],
  ['Freshness is a first-class figure', '"oldest source: delivery 31 m behind" — staleness is stated, never hidden.'],
  ['The alert engine reports itself', '58 rules enabled · 153 metrics written by the sync job.'],
]);

/* ============================ 6 · dashboard ============================ */
shot('Dashboard', 'The first screen of an L1 shift', 1, [
  ['Journey health, then the numbers', '846 orders · 109 checkouts · 468 payments OK · 204 business errors in the window.'],
  ['One range, whole page', 'change the dashboard range and every panel below follows it.'],
  ['Headline honesty', '888 orders in 24 h at 82.5 % payment success — the good and the bad on the same row.'],
]);

/* ============================ 7 · order lanes ============================ */
shot('Order flow', 'Where New SIM and MNP orders actually stop', 5, [
  ['Two lanes, side by side', '851 New SIM orders · 37 MNP orders in the window.'],
  ['The drop is named, not implied', 'New SIM: 773 eligibility fail (91 %) · 65 no payment (8 %). MNP: 19 eligibility fail (51 %) · 9 no payment (24 %).'],
  ['Each box was signed off', 'the 12 definitions L2 reviewed in Session 1 are these boxes.'],
]);

/* ============================ 8 · one order ============================ */
shot2('Drill-down', 'One order, all the way down to the gateway', 3, 4, [
  ['Click any box', 'and you get the orders behind it, not a chart of them.'],
  ['Transaction timeline', 'every step of that single customer\'s order, in order, with what each call answered.'],
  ['The gateway beside it', 'endpoints active while that order moved — errors first: 533 calls / 61 errors on get-subscription-profile, p95 1,050' + NB + 'ms.'],
  ['This is the L2 view', 'the question on a bridge is never "how many" — it is "what happened to this one".'],
]);

/* ============================ 9 · payments outcomes ============================ */
shot('Payments', 'Outcome per payment — not per attempt', 6, [
  ['The distinction that changes the number', '490 success · 351 abandoned · 104 declined. Counting attempts would tell a different, wrong story.'],
  ['Retry is measured', '55 % retry-success in 24 h — customers who failed once and paid later.'],
  ['API outcomes above it', '784 success · 224 business error, so a payment dip can be matched to an API dip immediately.'],
]);

/* ============================ 10 · servicing ============================ */
shot('Servicing', 'Existing customers, not just new ones', 7, [
  ['Every servicing journey counted', '639 recharge · 123 advance postpaid · 115 voucher recharge · 71 renewal · 40 bill payment · 37 paid plan change.'],
  ['Per-hour shape', 'so a stalled journey shows as a flat line, not as a slightly smaller total.'],
  ['Latest transactions', 'the newest activity, live, with activation trends beside it.'],
]);

/* ============================ 11 · payments page ============================ */
shot('Payments', 'The gateway view: volume, failure, vendor, reason', 8, [
  ['The four numbers that matter', '945 transactions · 83.9K SAR · 83.3 % onboarding success · 17.5 % failure rate.'],
  ['Hourly success and volume', 'fail / pending / success split per hour — a gateway wobble is visible within the hour.'],
  ['By vendor', '935 salam · 10 apollo — partner traffic never hides inside our own.'],
  ['Decline reasons, code and message', 'grouped, so one bad reason cannot disappear into a total.'],
]);

/* ============================ 12 · declined drill ============================ */
shot('Payments', 'Every decline reason opens the payments behind it', 9, [
  ['Click a reason', '104 declined with no reason returned by the gateway, for 07:00 → 10:00 KSA.'],
  ['Named honestly', '"Unknown / not returned" — the console does not invent a reason the gateway never gave.'],
  ['Straight to the cases', 'the individual payments are one click away, not a report request.'],
]);

/* ============================ 13 · troubleshoot ============================ */
shot('Troubleshoot', 'The error control board — what is failing right now', 10, [
  ['Business and technical, separated', '5,189 failures in 21 h: 5,187 business (the API said no) and 2 technical (the API failed to answer).'],
  ['Per category', '3,213 eligibility · 1,344 payment/gateway · 450 Semati / MSISDN provisioning.'],
  ['Guided response on the board', 'the first move is on the screen, not in someone\'s head.'],
], 'That 5,187 / 2 split is the whole argument: an eligibility denial is a business outcome, not an outage — and the board now says so.');

/* ============================ 14 · UPG deep dive ============================ */
shot('Troubleshoot', 'Payments deep-dive: final outcomes, not attempts', 11, [
  ['The real distribution', '6,042 success (52 %) · 4,127 abandoned (36 %) · 1,342 declined (12 %) · 2 stuck · 0 fail-no-answer.'],
  ['Abandonment is the biggest number', 'and it is a customer behaviour, not a fault — which is why it is counted separately.'],
  ['14-day trend', 'abandonment % against decline %, so a real regression separates from normal noise.'],
  ['Every number is clickable', 'each one opens the cases behind it.'],
]);

/* ============================ 15 · gateway modal ============================ */
shot('Troubleshoot', 'The gateway\'s own record, beside ours', 12, [
  ['One invoice, every attempt', 'with the gateway payload as the gateway returned it.'],
  ['Totals per vendor', '11,194 UPG (salam) · 338 apollo.'],
  ['Sanitized', 'PAN and PII masked before display.'],
]);

/* ============================ 16 · transaction timeline ============================ */
shot('Troubleshoot', 'Why this one payment failed', 13, [
  ['The timeline of a single case', 'from the app call to the gateway answer, in sequence.'],
  ['Reason down to the message', 'not a status code on its own.'],
  ['Reachable from anywhere', 'every list in the console ends in this same view.'],
]);

/* ============================ 17 · case analyzer + Yusr ============================ */
shot('Troubleshoot', 'Case analyzer, and Yusr beside it', 16, [
  ['Paste a transaction id', 'and get the sequence, the fault and the explanation in one panel.'],
  ['Yusr answers in plain language', 'from the same data — with the next action, not a description of the failure.'],
  ['Categories stay in view', '132 Nafath / identity · 450 Semati · 2 payment stuck (unconfirmed).'],
]);

/* ============================ 18 · the -501 case ============================ */
{
  const s = pres.addSlide();
  header(s, 'A real case', 'What the customer saw — and what the console explained');
  s.addImage({ path: o('o14_phone'), x: 10.3, y: 1.5, w: 2.5, h: 4.79, shadow: shadow() });
  points(s, 0.55, 1.7, 9.4, [
    ['The complaint', 'a postpaid customer could not pay an August bill of 1,099.17 SAR. The app showed "Backend General Error · Error Code: -501".'],
    ['What -501 does not tell you', 'nothing. It is a generic backend error, and the app persisted no reason — the classic ticket that bounces between teams for days.'],
    ['What the console showed', 'the payment screen itself states the rule: "in the range of 5.0 to 1000". The bill was 1,099.17. It was above the configured maximum postpaid charge, so the backend refused it.'],
    ['Not a fault — a configuration limit', 'max_postpaid_charge = 1000. Nothing was broken; the cap was simply lower than the customer\'s bill.'],
    ['Why it matters here', 'the "Device ID" in the dialog is the trace id. That single link is what turns a screenshot from a customer into a case the console can answer.'],
  ], 1.02);
  footer(s);
  s.addNotes('Good story for the workshops: L1 can resolve this without escalating, once they know where the cap is stated.');
}

/* ============================ 19 · alerts ============================ */
shot('Alerts', '66 rules, each with its own guided response', 17, [
  ['Severity that means something', '0 P1 · 2 P2 · 0 P3 open · 95 resolved in 24 h.'],
  ['Measured response, not claimed', 'MTTA 27' + NB + 'm · MTTR 1.3' + NB + 'h over 30 days.'],
  ['Runbook, message and discussion', 'on the alert itself — the on-call does not go looking.'],
]);

/* ============================ 20 · alert rules ============================ */
shot('Alerts', 'Every threshold is yours to change', 18, [
  ['The full catalogue', '66 rules — 37 technical, 25 business.'],
  ['Editable in place', 'threshold and window on the rule, with the condition written out.'],
  ['This is what Session 2 reviewed', 'each rule ended the session KEEP, CHANGE or DELETE — and the changes are in here.'],
]);

/* ============================ 21 · metric charts ============================ */
shot('Alerts', 'The 48 metrics the rules are watching', 19, [
  ['What is breaching, right now', '2 breaching of 48 metrics.'],
  ['The metric, not just the alert', 'eligibility denial rate 54.2 % · abandoned onboarding orders 8,839 · activation business-failure rate 0.0 %.'],
  ['Semati excluded where it distorts', 'the activation metric says so on its own label.'],
]);

/* ============================ 22 · topology ============================ */
shot('Documentation', 'The whole estate on one page', 20, [
  ['Channels → core → BSS, government, vendors', 'every system the selfcare backend talks to.'],
  ['Grounded in the code', 'PostgreSQL 12 — 88 tables · 4.9 M payments; Sidekiq — 43 workers on 22 queues.'],
  ['The best first slide for a new joiner', 'and the reason this deck exists.'],
]);

/* ============================ 23 · topology 2 ============================ */
shot('Documentation', 'Topology 2 — every box linked to its source', 21, [
  ['38 components · 41 flows', 'for payments alone, read from selfcare-backend 2.34.1.'],
  ['Class and file, not a picture', 'select a component and you get the implementing class — Zatca::Client, and so on.'],
  ['Known failure cases attached', '3 recorded against this flow, so the map carries the operational history too.'],
]);

/* ============================ 24 · APIGW topology ============================ */
shot('Documentation', 'API gateway — the infrastructure as it really is', 22, [
  ['Real hosts, real addresses', 'APIGW DMS entry 172.31.43.61:3000 · app front 43.11–43.14 · app backend 43.136–43.139.'],
  ['The data tier', 'MaxScale proxy VIP 172.31.43.75 in front of the Clara MySQL cluster.'],
  ['Where the BSS sits', 'Optiva APPBSS 172.31.42.50–52 on :9340.'],
], 'Built from the DMS HLD and corrected against what the network actually answers — one host in the original document was not an MVNO host at all.');

/* ============================ 25 · journeys ============================ */
shot('Documentation', '24 journeys, step by step', 26, [
  ['Every channel', 'app, web, dealer (SDA), POSA and partner — 4 onboarding · 4 identity & activation · 3 dealer & partner · 4 payments & billing · 7 account & plan · 2 commerce.'],
  ['Each step shows its calls', 'what it invokes, and what happens on success.'],
  ['Failure mode toggle', 'switch to Failure to see where and why a journey breaks.'],
]);

/* ============================ 26 · journey contract ============================ */
shot('Documentation', 'Down to the request, response and error body', 27, [
  ['The actual contract', 'POST /api/onboarding/orders/::id/sim_type — request, 200 response, 422 error.'],
  ['Error codes in the open', 'the specific error value each failure returns.'],
  ['Log signature', 'what this step looks like in the logs — so you can find it at 2 a.m.'],
], 'This is enhancement item 2 from the review — "documentation depth, every API case in detail" — and it covers all 24 journeys.');

/* ============================ 27 · integrations ============================ */
shot('Documentation', 'Every external system, counted', 30, [
  ['32 external systems', '15 inbound callbacks, 43 Sidekiq workers on 22 queues.'],
  ['Read from the code, not from memory', 'release 2.34.1 — so the catalogue cannot drift from reality unnoticed.'],
  ['Who calls whom, and how', 'direction and mechanism for each one.'],
]);

/* ============================ 28 · API references ============================ */
{
  const s = pres.addSlide();
  header(s, 'Documentation', 'Three partner API references, imported into the console');
  const refs = [
    [23, 'OTO Courier API', '74 endpoints · 10 guides, imported 19 Aug. Linked directly from the delivery steps in the journeys.'],
    [24, 'Tap / UPG API', 'The payment-gateway reference — response codes, webhooks, Apple Pay payload format.'],
    [25, 'Salam Selfcare API', '28 sections, imported 19 Aug — including the Nafath v2 contract and its error codes.'],
  ];
  refs.forEach((r, i) => {
    const x = 0.55 + i * 4.15;
    s.addImage({ path: o(r[0]), x, y: 1.7, w: 3.9, h: 2.25, shadow: shadow() });
    s.addText(r[1], { x, y: 4.12, w: 3.9, h: 0.34, fontSize: 14, bold: true, color: INK, fontFace: HEAD, margin: 0 });
    s.addText(r[2], { x, y: 4.48, w: 3.9, h: 1.5, fontSize: 11.5, color: MUTED, fontFace: BODY, margin: 0, lineSpacing: 15 });
  });
  s.addText('Anything uploaded here also feeds Yusr\'s knowledge base — so an imported document becomes answerable in the chat.',
    { x: 0.55, y: 6.1, w: 11.9, h: 0.35, fontSize: 11, italic: true, color: MUTED, fontFace: BODY, margin: 0 });
  footer(s);
}

/* ============================ 29 · subscriber 360 ============================ */
shot('Subscriber 360', 'One customer, every line, every event', 'o28_safe', [
  ['Search by MSISDN or national ID', 'and get identity, plan, order state and status on one card.'],
  ['All lines, with history', '13 lines here, from Apr 2024 to Aug 2026 — completed, abandoned, cancelled, pending.'],
  ['Journey timeline', 'the most recent order\'s events; click any row for the full trace.'],
  ['Masked by default', 'the national ID reads *******450 unless you hold the unmask right.'],
]);

/* ============================ 30 · tickets ============================ */
shot2('Feedback loop', 'Raise a ticket without leaving the page', 32, 33, [
  ['From anywhere in the console', 'the "?" menu opens the form over whatever you were looking at.'],
  ['Screenshots attach', 'up to four, and they travel with the ticket.'],
  ['It becomes the backlog', 'Open → Under evaluation → In progress → Closed / Rejected, with a mail on each change.'],
  ['It is working', 'four tickets from L2 so far — three already closed.'],
]);

/* ============================ 31 · workbench ============================ */
shot('L2 Workbench', 'Who is using it, and how', 34, [
  ['Real adoption, measured', '3,198 events over 28 active days · 1,965 page views · 226 timeline opens · 180 searches.'],
  ['Governance is visible', '187 unmask events recorded · 0 restricted attempts · 0 exports.'],
  ['Four tabs', 'Activity · Incident replay · Test / what-if · Docs hub.'],
], 'Incident replay and Test / what-if let a rule be tried against a past window before it is trusted live.');

/* ============================ 32 · governance ============================ */
shot2('Governance', 'Who can see what — and where an alert goes', 37, 38, [
  ['Five roles', 'from read-only to super admin, with PII unmask as a separate right.'],
  ['Every reveal is audited', 'the 187 unmask events on the previous slide come from here.'],
  ['Escalation is configurable', 'Teams, Slack and WhatsApp fan-out to the on-call numbers, per severity.'],
  ['Secrets stay server-side', 'SMS credentials live in the server environment, never in the page.'],
]);

/* ============================ 33 · SLO + on-call ============================ */
shot2('Service levels', 'Targets, vendor health, and a view for a phone', 40, 39, [
  ['SLOs, met and breached', 'activation 99.8 % met · delivery 99.1 % met · plan change 93.9 % breached · eligibility 62.4 % breached · payments 84.2 % breached.'],
  ['The breach names the vendor', 'Semati provisioning at 61.0 % is not an internal fault — and the page says which side it is on.'],
  ['On-call view', 'one screen for a phone or a wall: status, open incidents and data freshness.'],
  ['Anomaly detection', 'seasonal baselines, so a normal Friday does not page anyone.'],
]);

/* ============================ 34 · Yusr ============================ */
shot('Yusr · يُسر', 'The assistant, measured like everything else', 41, [
  ['Used, not just installed', '46 chats · 15 in the last 24 h across 3 agents.'],
  ['Honest about speed', 'LLM latency 21.3' + NB + 's (p95 55.8' + NB + 's) · fallback 78.2' + NB + 's — the slow path is shown, not hidden.'],
  ['Rated by the people using it', '79 % helpful, 15 of 19 rated · 13 learned cases.'],
], 'Every thumbs-up teaches it a proven solution — which is why the rating buttons matter more than they look.');

/* ============================ 35 · close ============================ */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addText('WHERE THIS LEAVES US', { x: 0.7, y: 0.5, w: 6, h: 0.3, fontSize: 11, bold: true, color: '7FD3A6', charSpacing: 2, fontFace: BODY, margin: 0 });
  s.addText('Six months in, and the hard part is done', { x: 0.7, y: 0.85, w: 11.9, h: 0.6, fontSize: 32, bold: true, color: WHITE, fontFace: HEAD, margin: 0 });

  const cols = [
    ['What exists', ['24 journeys documented to the request body', '66 alert rules with guided responses',
      '32 integrations mapped from the code', 'A production replica the numbers can be traced to',
      'One place per question — no more three tools and a spreadsheet']],
    ['What it changed', ['Business outcomes no longer read as outages',
      'A decline has a reason, not just a code', 'A P1 has a timeline, not a reconstruction',
      'A customer complaint has a trace id', 'An SLO breach names the vendor behind it', 'Findings arrive as tickets, not as side chats']],
    ['What is next', ['L1 workshops — Mon 24 & Wed 26 August',
      'The DMS section, with the DMS L2 team', 'Latency alert calibration against real p95',
      'ServiceNow ticket raising from the console', 'Wallet-statement export for the DMS ticket queue', 'Whatever you put on the board']],
  ];
  cols.forEach((c, i) => {
    const x = 0.7 + i * 4.1;
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.75, w: 3.85, h: 4.05, fill: { color: '12513C' }, line: { color: '1C6B50' }, rectRadius: 0.08 });
    s.addText(c[0], { x: x + 0.28, y: 1.95, w: 3.3, h: 0.36, fontSize: 16, bold: true, color: '5FD39B', fontFace: HEAD, margin: 0 });
    s.addText(c[1].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < c[1].length - 1 } })),
      { x: x + 0.28, y: 2.42, w: 3.35, h: 3.3, fontSize: 13, color: 'DCEFE4', fontFace: BODY, margin: 0, paraSpaceAfter: 15, valign: 'top' });
  });
  s.addText('Console: https://salam.sa/digital-console/     ·     Every screen in this deck is live — please go and try to break it.',
    { x: 0.7, y: 6.16, w: 11.9, h: 0.35, fontSize: 12.5, bold: true, color: 'BFE3CF', fontFace: BODY, margin: 0 });
  footer(s, true);
}

pres.writeFile({ fileName: OUT }).then(() => console.log('wrote', OUT, '·', page, 'slides'));
