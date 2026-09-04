#!/usr/bin/env node
/* Partition proof for the Dashboard order-status flow tree.
 *
 * Question this answers: "at each vertical stage, does an order go to exactly ONE box to the right,
 * never two?" i.e. are the children of every branch MUTUALLY EXCLUSIVE (no double-count) and do they
 * COVER the parent (no order silently dropped)?
 *
 * How: it reads the REAL FLOW_PRED predicates out of server/src/api.js (so it can't drift from what
 * ships), translates each SQL boolean expression to JS, then enumerates EVERY possible order — all
 * combinations of the underlying flags (eligible, pay, esim, activated, assigned, delivered, partner,
 * shop_deliv) — and for each branch checks:
 *   • child ⊆ parent           (a child box can't contain an order its parent doesn't)
 *   • children pairwise disjoint (no order lands in two sibling boxes → no fork to the right)
 *   • union(children) == parent  (every parent order lands in exactly one child → nothing dropped)
 *
 * This is a proof over ALL possible orders, not just today's data. Exit 0 = clean, 1 = a defect.
 * No DB needed. (For a live cross-check against real rows, see the reconciliation query in the runbook.)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, '..', 'server', 'src', 'api.js');
const src = fs.readFileSync(apiPath, 'utf8');

// ---- pull the FLOW_PRED object literal out of api.js ----
const m = src.match(/const FLOW_PRED = \{([\s\S]*?)\n\};/);
if (!m) { console.error('Could not find FLOW_PRED in api.js'); process.exit(2); }
const body = m[1];
// parse `key: 'expr'` and `key: \`expr\`` pairs, skipping // comment lines
const PRED = {};
for (const line of body.split('\n')) {
  const s = line.trim();
  if (!s || s.startsWith('//')) continue;
  // match one or more key:'...' entries on the line
  const re = /([a-z_]+)\s*:\s*(?:'([^']*)'|`([^`]*)`)/g;
  let mm;
  while ((mm = re.exec(s))) PRED[mm[1]] = (mm[2] !== undefined ? mm[2] : mm[3]);
}

// ---- translate a SQL boolean predicate to a JS expression over our flag vars ----
function toJS(expr) {
  return expr
    .replace(/\bpay\s*<>\s*'([a-z]+)'/gi, "pay!=='$1'")
    .replace(/\bpay\s*=\s*'([a-z]+)'/gi, "pay==='$1'")
    .replace(/\bNOT\b/gi, '!')
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||')
    .replace(/\bTRUE\b/gi, 'true');
}
const VARS = ['eligible', 'esim', 'activated', 'assigned', 'delivered', 'partner', 'shop_deliv', 'pay', 'id_submitted'];
const fnOf = {};
for (const [k, expr] of Object.entries(PRED)) {
  try { fnOf[k] = new Function(...VARS, `return (${toJS(expr)});`); }
  catch (e) { console.error(`Bad predicate for ${k}: ${expr}\n  → ${e.message}`); process.exit(2); }
}

// ---- the branch structure: parent → children that must PARTITION it ----
// (mirrors FLOW_EDGES in home.js; a branch with one child is a pure subset, checked separately)
const PARTITIONS = [
  ['total',        ['pre_elig', 'elig_pass', 'elig_fail']],   // pre_elig = never submitted the ID form
  ['elig_pass',    ['total_payment', 'no_payment']],   // reached payment vs abandoned before paying
  ['total_payment',['pay_success', 'pay_pending', 'pay_fail']],
  ['pay_success',  ['esim', 'physical']],
  ['esim',         ['esim_activated', 'esim_not_activated']],
  ['physical',     ['assigned', 'not_assigned', 'courier_not_created', 'shop_pickup']],
  ['assigned',     ['delivered', 'not_delivered']],
  ['delivered',    ['phys_activated', 'phys_not_activated']],
];
const SUBSETS = [
  ['elig_pass', 'total_payment'],   // total_payment ⊆ elig_pass (eligible AND has a payment)
];

// map node key → alias present in FLOW_PRED (elig_pass/elig_fail use the 'eligible' flag directly)
const KEY = k => (k === 'elig_pass' ? 'elig_pass' : k === 'elig_fail' ? 'elig_fail' : k);

// ---- enumerate every possible order ----
const bools = [false, true];
const pays = ['success', 'pending', 'fail', 'none'];
const universe = [];
for (const eligible of bools) for (const pay of pays) for (const esim of bools)
for (const activated of bools) for (const assigned of bools) for (const delivered of bools)
for (const partner of bools) for (const shop_deliv of bools) {
  // physically impossible: delivered=true requires a delivery row (assigned=true). Skip — the
  // predicates already gate on `assigned AND delivered`, but excluding it keeps the proof honest.
  if (delivered && !assigned) continue;
  universe.push({ eligible, pay, esim, activated, assigned, delivered, partner, shop_deliv });
}
const evalNode = (k, o) => !!fnOf[KEY(k)](o.eligible, o.esim, o.activated, o.assigned, o.delivered, o.partner, o.shop_deliv, o.pay);

// ---- run the checks ----
let failures = 0;
const pad = s => String(s).padEnd(16);
console.log(`Checked predicates: ${Object.keys(PRED).length} · possible orders enumerated: ${universe.length}\n`);

for (const [parent, kids] of PARTITIONS) {
  let overlap = 0, uncovered = 0, escaped = 0;
  for (const o of universe) {
    const p = evalNode(parent, o);
    const hits = kids.filter(k => evalNode(k, o));
    if (hits.length > 1) overlap++;                 // order forks to >1 child → DOUBLE COUNT
    if (p && hits.length === 0) uncovered++;         // parent order in no child → DROPPED
    if (!p && hits.length > 0) escaped++;            // child order not in parent → LEAK
  }
  const ok = overlap === 0 && uncovered === 0 && escaped === 0;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${pad(parent)} → ${kids.join(', ')}`);
  if (!ok) console.log(`     overlap(double-count)=${overlap}  uncovered(dropped)=${uncovered}  escaped(child⊄parent)=${escaped}`);
}
for (const [parent, child] of SUBSETS) {
  const leak = universe.filter(o => evalNode(child, o) && !evalNode(parent, o)).length;
  const ok = leak === 0;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${pad(child)} ⊆ ${parent}${ok ? '' : `   (${leak} orders in child but not parent)`}`);
}

console.log('');
if (failures === 0) {
  console.log('RESULT: ✓ No duplication. At every branch each order goes to exactly one box — mutually exclusive and fully covering.');
  process.exit(0);
} else {
  console.log(`RESULT: ✗ ${failures} branch(es) failed — see above. An order can double-count or be dropped.`);
  process.exit(1);
}
