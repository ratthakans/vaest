#!/usr/bin/env node
// One-time Stripe product/price setup for VÆST.
//
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.mjs
//
// Creates the three monthly THB subscription prices (Basic/Pro/Director) and
// prints the env lines to paste into Vercel. Safe to re-run: it looks up an
// existing product by its lookup metadata before creating a new one.
// NOTE: THB is a 2-decimal currency in Stripe — amounts are in satang (÷100).

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('Set STRIPE_SECRET_KEY first (use your TEST key: sk_test_…)'); process.exit(1); }
const stripe = new Stripe(key);

const PLANS = [
  { plan: 'basic',    name: 'VÆST Basic',    baht: 390 },
  { plan: 'pro',      name: 'VÆST Pro',      baht: 1490 },
  { plan: 'director', name: 'VÆST Director', baht: 3490 },
];

async function findProduct(planKey) {
  // reuse a product we tagged before, so re-runs don't pile up duplicates
  const list = await stripe.products.search({ query: `metadata['vaest_plan']:'${planKey}'` });
  return list.data[0] || null;
}
async function findPrice(productId, amount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return prices.data.find(p => p.unit_amount === amount && p.currency === 'thb' && p.recurring?.interval === 'month') || null;
}

const out = [];
for (const { plan, name, baht } of PLANS) {
  const amount = baht * 100; // satang
  let product = await findProduct(plan);
  if (!product) {
    product = await stripe.products.create({ name, metadata: { vaest_plan: plan } });
    console.log(`created product ${product.id} — ${name}`);
  } else {
    console.log(`reusing product ${product.id} — ${name}`);
  }
  let price = await findPrice(product.id, amount);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: 'thb',
      recurring: { interval: 'month' },
      metadata: { vaest_plan: plan },
    });
    console.log(`created price   ${price.id} — ฿${baht}/mo`);
  } else {
    console.log(`reusing price   ${price.id} — ฿${baht}/mo`);
  }
  out.push([plan.toUpperCase(), price.id]);
}

console.log('\n── Paste these into Vercel → Project → Settings → Environment Variables ──\n');
for (const [P, id] of out) console.log(`STRIPE_PRICE_${P}=${id}`);
console.log('\n(Team reuses these same prices, billed by seat quantity — no extra setup needed.)');
