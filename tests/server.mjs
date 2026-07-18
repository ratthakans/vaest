// Server-side unit tests — the billing / quota / margin math in lib/plans.js.
// These pure functions gate real money (spend cap, credit, the 30%-margin floor) and had
// ZERO coverage; the client tests in unit.mjs never touch them. Run with the others:
//   node tests/server.mjs   (wired into `npm test`)
import assert from 'node:assert/strict';
import {
  PLANS, PACK_PRICE, BOOST_SPEND, BOOST, MAX_PACKS_PER_MONTH, RATES,
  costTHB, applySpend, spendCapFor, spendThisMonth, planFor, isInternal,
  applyBoost, applyDocBump, applyRefineBump, packsLeft, checkDocQuota, checkRefineQuota,
} from '../lib/plans.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }

const M = new Date().toISOString().slice(0, 7); // current month key, as plans.js computes it

console.log('\nlib/plans.js — margin law (CLAUDE.md law #5)\n');

// The one law that guards the whole business model: spendCap = 70% of the plan price, so
// quality-first routing can never dip the margin below 30%. Canonical THB prices live in
// Stripe; encode them here so any future spendCap edit that breaks the ratio fails loudly.
const PRICE = { basic: 390, pro: 1490, director: 3490 };
t('every paid plan keeps spendCap === round(0.70 × price)', () => {
  for (const [name, price] of Object.entries(PRICE)) {
    assert.equal(PLANS[name].spendCap, Math.round(0.70 * price), name + ' spendCap drifted from the 30% floor');
  }
});
t('credit pack keeps the same 70% floor (BOOST_SPEND === round(0.70 × PACK_PRICE))', () => {
  assert.equal(BOOST_SPEND, Math.round(0.70 * PACK_PRICE));
});
t('unlimited plan has no finite spend cap', () => assert.equal(PLANS.unlimited.spendCap, Infinity));

console.log('\nlib/plans.js — cost metering\n');

t('costTHB rates in+out tokens per the bucket table', () => {
  // 1M in + 1M out on odin (Opus) = 180 + 900 = ฿1080
  assert.equal(costTHB('odin', 1_000_000, 1_000_000), RATES.odin.in + RATES.odin.out);
  assert.equal(costTHB('galdr', 1_000_000, 0), RATES.galdr.in);
});
t('costTHB prices an unknown bucket as Opus (safe side, never under-bills)', () => {
  assert.equal(costTHB('mystery', 1_000_000, 0), RATES.odin.in);
});
t('applySpend accumulates within the month', () => {
  const d1 = applySpend({}, 10);
  assert.equal(d1.spendMonth, M);
  assert.equal(applySpend(d1, 5).spendTHB, 15);
});
t('spendThisMonth resets when the stored month is stale', () => {
  assert.equal(spendThisMonth({ spendMonth: '2000-01', spendTHB: 999 }), 0);
  assert.equal(spendThisMonth({ spendMonth: M, spendTHB: 42 }), 42);
});

console.log('\nlib/plans.js — spend ceiling + packs\n');

t('spendCapFor = plan base + this month’s packs × BOOST_SPEND', () => {
  assert.equal(spendCapFor(PLANS.basic, {}), PLANS.basic.spendCap);
  assert.equal(spendCapFor(PLANS.basic, { packMonth: M, packCount: 2 }), PLANS.basic.spendCap + 2 * BOOST_SPEND);
});
t('spendCapFor ignores packs bought in a previous month', () => {
  assert.equal(spendCapFor(PLANS.basic, { packMonth: '2000-01', packCount: 9 }), PLANS.basic.spendCap);
});
t('spendCapFor on unlimited stays Infinity', () => assert.equal(spendCapFor(PLANS.unlimited, {}), Infinity));

console.log('\nlib/plans.js — credit packs (applyBoost)\n');

t('applyBoost credits docs + refines and counts the pack', () => {
  const d = applyBoost({}, 'cs_1', 1);
  assert.equal(d.creditDocs, BOOST.docs);
  assert.equal(d.creditRefines, BOOST.refines);
  assert.equal(d.packCount, 1);
});
t('applyBoost is idempotent per Stripe session id', () => {
  const d1 = applyBoost({}, 'cs_dup', 1);
  const d2 = applyBoost(d1, 'cs_dup', 1); // webhook + confirm both fire
  assert.equal(d2, d1); // unchanged reference → no double credit
});
t('packsLeft caps the monthly top-up at MAX_PACKS_PER_MONTH', () => {
  assert.equal(packsLeft({}), MAX_PACKS_PER_MONTH);
  assert.equal(packsLeft({ packMonth: M, packCount: MAX_PACKS_PER_MONTH }), 0);
});

console.log('\nlib/plans.js — document + refine consumption\n');

t('applyDocBump spends the plan allowance first, then credit', () => {
  const withinPlan = applyDocBump({ docMonth: M, docCount: 5 }, 20);
  assert.equal(withinPlan.docCount, 6);
  const onCredit = applyDocBump({ docMonth: M, docCount: 20, creditDocs: 3 }, 20);
  assert.equal(onCredit.creditDocs, 2); // plan exhausted → one credit consumed
});
t('applyRefineBump spends the plan allowance first, then credit', () => {
  const withinPlan = applyRefineBump({ refMonth: M, refCount: 1 }, 60);
  assert.equal(withinPlan.refCount, 2);
  const onCredit = applyRefineBump({ refMonth: M, refCount: 60, creditRefines: 2 }, 60);
  assert.equal(onCredit.creditRefines, 1);
});

console.log('\nlib/plans.js — quota gates (pre-read row, no network)\n');

t('checkDocQuota: within allowance → ok, exhausted+no credit → blocked, credit → ok', async () => {
  assert.equal((await checkDocQuota('x', PLANS.basic, { docMonth: M, docCount: 5 })).ok, true);
  assert.equal((await checkDocQuota('x', PLANS.basic, { docMonth: M, docCount: 20 })).ok, false);
  assert.equal((await checkDocQuota('x', PLANS.basic, { docMonth: M, docCount: 20, creditDocs: 1 })).ok, true);
  assert.equal((await checkDocQuota('x', PLANS.unlimited, {})).ok, true); // infinite plan never gated
});
t('checkRefineQuota: Basic (no plan refine) exhausted reports planHasRefine:false', async () => {
  const q = await checkRefineQuota('x', PLANS.basic, { refMonth: M, refCount: 0 });
  assert.equal(q.ok, false);           // Basic has refineMonth 0 → immediately over
  assert.equal(q.planHasRefine, false); // → nudge is "unlock on Pro / add credit"
  const onCredit = await checkRefineQuota('x', PLANS.basic, { refMonth: M, refCount: 0, creditRefines: 1 });
  assert.equal(onCredit.ok, true);     // pay-per-use credit works even on Basic
});

console.log('\nlib/plans.js — access resolution\n');

t('isInternal treats the whole @orions.agency domain as team', () => {
  assert.equal(isInternal('anyone@orions.agency'), true);
  assert.equal(isInternal('ANYONE@Orions.Agency'), true); // case-insensitive
  assert.equal(isInternal('someone@gmail.com'), false);
});
t('planFor: internal → unlimited, outsider → finite default', () => {
  assert.equal(planFor('dev@orions.agency').name, 'unlimited');
  assert.equal(Number.isFinite(planFor('stranger@example.com').spendCap), true); // never Infinity for outsiders
});

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
if (fail) process.exit(1);
