import { SB, svcHeaders, PLANS, INTERNAL, INVITED, PLAN_MAP } from './plans.js';

// ── Stripe billing layer ───────────────────────────────────────────────────
// Subscriptions are the source of truth for a customer's plan. Stripe webhooks
// write a `sub:<email>` row in Supabase (service key); resolveAccess() reads it.
// The code allowlists (INTERNAL / INVITED / PLAN_MAP) remain for comp + trials.
//
// Secrets live in Vercel env only — never commit them:
//   STRIPE_SECRET_KEY        sk_test_… then sk_live_…
//   STRIPE_WEBHOOK_SECRET    whsec_…  (from the webhook endpoint you create)
// Price ids are NOT secret; set them after running scripts/stripe-setup.mjs:
//   STRIPE_PRICE_BASIC / _PRO / _DIRECTOR  (monthly, THB)
// Optional: STRIPE_PRICE_TEAM_BASIC / _TEAM_PRO / _TEAM_DIRECTOR (per-seat)

// Lazily import the Stripe SDK so a missing/broken `stripe` dependency can never take down
// the core endpoints (/api/access, /api/chat) that import this module only for resolveAccess.
let _stripe = null;
export async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('⚠️ STRIPE_SECRET_KEY is unset — billing endpoints will fail'); return null; }
  if (!_stripe) {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    _stripe = new Stripe(key); // account-default API version
  }
  return _stripe;
}

// plan name → Stripe price id (monthly, individual)
export const PRICES = {
  basic:    process.env.STRIPE_PRICE_BASIC || '',
  pro:      process.env.STRIPE_PRICE_PRO || '',
  director: process.env.STRIPE_PRICE_DIRECTOR || '',
};
// per-seat prices for Team (same tiers, billed by quantity)
export const TEAM_PRICES = {
  basic:    process.env.STRIPE_PRICE_TEAM_BASIC || '',
  pro:      process.env.STRIPE_PRICE_TEAM_PRO || '',
  director: process.env.STRIPE_PRICE_TEAM_DIRECTOR || '',
};
// reverse map: any known price id → plan name (built lazily so env is read at call time)
export function planForPrice(priceId) {
  for (const [name, id] of Object.entries(PRICES)) if (id && id === priceId) return name;
  for (const [name, id] of Object.entries(TEAM_PRICES)) if (id && id === priceId) return name;
  return null;
}

export const SELF_SERVE_PLANS = new Set(['basic', 'pro', 'director']);
// statuses that still grant access (past_due keeps access through Stripe dunning/grace)
const ACTIVE_STATUS = new Set(['active', 'trialing', 'past_due']);

// ── subscription store (Supabase row 'sub:<email>', service key) ──
const subRow = email => 'sub:' + (email || '').toLowerCase();

export async function readSub(email) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(subRow(email))}&select=data`, { headers: svcHeaders });
    if (!r.ok) { console.error('readSub failed', r.status); return null; }
    const rows = await r.json();
    return (rows[0] && rows[0].data) || null;
  } catch (e) { console.error('readSub threw:', e?.message || e); return null; }
}

export async function writeSub(email, data) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: subRow(email), data, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) console.error('writeSub failed', r.status);
    return r.ok;
  } catch (e) { console.error('writeSub threw:', e?.message || e); return false; }
}

// A paid subscription counts only if Stripe says it's in an access-granting status.
export function subIsActive(sub) {
  return !!(sub && sub.plan && ACTIVE_STATUS.has(sub.status));
}

// ── the resolver every API route uses ──
// Precedence: internal (unlimited) → active paid sub → PLAN_MAP comp → INVITED comp → paywall.
export async function resolveAccess(email) {
  const e = (email || '').toLowerCase();
  if (INTERNAL.has(e)) return { allowed: true, internal: true, source: 'internal', plan: { name: 'unlimited', ...PLANS.unlimited } };

  const sub = await readSub(e);
  if (subIsActive(sub)) {
    const p = PLANS[sub.plan] || PLANS.basic;
    return { allowed: true, internal: false, source: 'stripe', status: sub.status,
             plan: { name: sub.plan, ...p }, customerId: sub.customerId || null };
  }

  // comp / trial via code allowlists (no Stripe sub yet)
  if (Object.prototype.hasOwnProperty.call(PLAN_MAP, e)) {
    const name = PLAN_MAP[e];
    return { allowed: true, internal: false, source: 'comp', plan: { name, ...(PLANS[name] || PLANS.director) },
             customerId: (sub && sub.customerId) || null };
  }
  if (INVITED.has(e)) {
    return { allowed: true, internal: false, source: 'invite', plan: { name: 'director', ...PLANS.director },
             customerId: (sub && sub.customerId) || null };
  }

  // no sub, not invited → paywall. Surface a canceled/lapsed sub so the client can nudge.
  return { allowed: false, internal: false, source: sub ? 'lapsed' : 'none',
           status: sub ? sub.status : null, plan: null, customerId: (sub && sub.customerId) || null };
}
