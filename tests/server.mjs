// Server-side unit tests — the billing / quota / margin math in lib/plans.js.
// These pure functions gate real money (spend cap, credit, the 30%-margin floor) and had
// ZERO coverage; the client tests in unit.mjs never touch them. Run with the others:
//   node tests/server.mjs   (wired into `npm test`)
import assert from 'node:assert/strict';
import {
  PLANS, PACK_PRICE, BOOST_SPEND, BOOST, MAX_PACKS_PER_MONTH, RATES,
  costTHB, applySpend, spendCapFor, spendThisMonth, planFor, isInternal,
  applyBoost, applyDocBump, applyRefineBump, packsLeft, checkDocQuota, checkRefineQuota,
  creditSpendOf,
} from '../lib/plans.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }

const M = new Date().toISOString().slice(0, 7); // current month key, as plans.js computes it

console.log('\nlib/plans.js — margin law (CLAUDE.md law #5)\n');

// The one law that guards the whole business model: spendCap = 70% of what a plan EARNS, so
// quality-first routing can never dip the margin below 30%. Canonical THB prices live in
// Stripe; encode them here so any future spendCap edit that breaks the ratio fails loudly.
//
// Prices are VAT-inclusive (Stripe Tax has no Thailand support, so nothing is added at
// checkout and Thai law reads the charge as tax-inclusive). This test measured the ratio
// against the GROSS and so certified a 30% floor that was really 25.1% — the assertion passed
// on arithmetic nobody had checked against how the money actually arrives.
const PRICE = { basic: 390, pro: 1490, director: 3490 };
const VAT = 1.07;
t('every paid plan keeps spendCap === floor(0.70 × net price)', () => {
  for (const [name, price] of Object.entries(PRICE)) {
    assert.equal(PLANS[name].spendCap, Math.floor(0.70 * price / VAT), name + ' spendCap drifted from the 30% floor');
  }
});
t('the floor is measured on money actually kept, not on the sticker', () => {
  // guards the mistake itself: gross-based caps would pass the line above if VAT were dropped
  for (const [name, price] of Object.entries(PRICE)) {
    const net = price / VAT;
    assert.ok(PLANS[name].spendCap / net <= 0.70 + 1e-9, name + ' spends more than 70% of real income');
  }
});
t('credit pack keeps the same 70% floor on net (BOOST_SPEND)', () => {
  assert.equal(BOOST_SPEND, Math.floor(0.70 * PACK_PRICE / VAT));
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

console.log('\nSeats — a Team plan is the same plan billed by quantity\n');

const { scaleForSeats } = await import('../lib/billing.js');

t('ten seats grant ten seats’ worth, not one', () => {
  const one = { name: 'pro', ...PLANS.pro };
  const ten = scaleForSeats(one, 10);
  assert.equal(ten.docs, PLANS.pro.docs * 10);
  assert.equal(ten.capTokens, PLANS.pro.capTokens * 10);
  assert.equal(ten.spendCap, PLANS.pro.spendCap * 10);
  assert.equal(ten.refineMonth, PLANS.pro.refineMonth * 10);
  assert.equal(ten.seats, 10);
});

t('seats scale the margin law with the revenue, not past it', () => {
  // spendCap is 70% of net. Ten seats earn ten times, so the ceiling must be ten times — no more.
  const ten = scaleForSeats({ name: 'pro', ...PLANS.pro }, 10);
  assert.equal(ten.spendCap / (PLANS.pro.spendCap * 10), 1);
});

t('refine stays an unlock, never an amount', () => {
  assert.equal(scaleForSeats({ name: 'basic', ...PLANS.basic }, 8).refine, false);
  assert.equal(scaleForSeats({ name: 'pro', ...PLANS.pro }, 8).refine, true);
});

t('unlimited stays unlimited and one seat is untouched', () => {
  assert.equal(scaleForSeats({ name: 'unlimited', ...PLANS.unlimited }, 20).docs, Infinity);
  const one = { name: 'pro', ...PLANS.pro };
  assert.deepEqual(scaleForSeats(one, 1), one);
  assert.deepEqual(scaleForSeats(one, undefined), one);
});

console.log('\nCredit — the headroom outlives the month it was bought in\n');

t('a pack bought on the 31st still works on the 1st', () => {
  // The bug: headroom was keyed on packMonth, so it evaporated at midnight while the documents it
  // paid for remained. Simulate the rollover by dating the pack to last month.
  const bought = applyBoost({}, 'cs_1', 1);
  const nextMonth = { ...bought, packMonth: '1999-01', spendMonth: '1999-01', spendTHB: 0 };
  const cap = spendCapFor(PLANS.basic, nextMonth);
  assert.equal(cap, PLANS.basic.spendCap + BOOST_SPEND);
  assert.ok(nextMonth.creditDocs > 0, 'the documents persist, so the headroom must too');
});

t('headroom is drawn down only by spend above the plan’s own ceiling', () => {
  const base = PLANS.basic.spendCap;
  let d = applyBoost({}, 'cs_2', 1);
  assert.equal(creditSpendOf(d), BOOST_SPEND);
  d = applySpend(d, base - 10, base);                       // still inside the plan
  assert.equal(creditSpendOf(d), BOOST_SPEND, 'plan-funded spend must not touch credit');
  d = applySpend(d, 30, base);                              // 20 of this lands above the cap
  assert.equal(Math.round(creditSpendOf(d)), BOOST_SPEND - 20);
});

t('spending it all takes the ceiling back to the plan', () => {
  const base = PLANS.basic.spendCap;
  let d = applyBoost({}, 'cs_3', 1);
  d = applySpend(d, base + BOOST_SPEND, base);
  assert.equal(creditSpendOf(d), 0);
  assert.equal(spendCapFor(PLANS.basic, d), base);
});

t('rows written before the balance existed are read, not stranded', () => {
  const legacy = { packMonth: M, packCount: 2 };             // bought this month, pre-migration shape
  assert.equal(creditSpendOf(legacy), 2 * BOOST_SPEND);
});

console.log('\nOrigin — a header is a claim, not a fact\n');

const { safeOrigin, subIsActive } = await import('../lib/billing.js');

t('an origin we did not authorise never becomes a redirect target', () => {
  // The sign-up confirmation mail lands on this URL and Supabase appends the session tokens to it,
  // so an attacker-supplied Origin would have mailed a stranger a link handing over their own new
  // session. It was held shut only by a Supabase dashboard setting this code cannot see or set.
  const at = o => safeOrigin({ headers: { origin: o } });
  assert.equal(at('https://evil.example'), 'https://vaest.orions.agency');
  assert.equal(at('https://vaest.orions.agency.evil.com'), 'https://vaest.orions.agency');
  assert.equal(at(''), 'https://vaest.orions.agency');
  assert.equal(at('https://vaest.orions.agency'), 'https://vaest.orions.agency');
  assert.equal(at('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(at('https://vaest-orions-x1y2-ratthakans.vercel.app'), 'https://vaest-orions-x1y2-ratthakans.vercel.app');
});

t('a paying customer keeps access when the plan name cannot be resolved', () => {
  // planForPrice returns null when STRIPE_PRICE_* drifts from the dashboard. Access used to hinge
  // on the plan name, so a config change nobody could see revoked a live, paid subscription.
  assert.equal(subIsActive({ status: 'active', plan: null }), true);
  assert.equal(subIsActive({ status: 'past_due', plan: undefined }), true);
  assert.equal(subIsActive({ status: 'canceled', plan: 'pro' }), false);
  assert.equal(subIsActive(null), false);
});

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
if (fail) process.exit(1);
