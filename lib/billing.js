import { readRow, writeRow, PLANS, INTERNAL, INVITED, PLAN_MAP, isInternal } from './plans.js';
import { ownerOf } from './team.js';

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

// ── where we are allowed to send someone back to ────────────────────────────
// `req.headers.origin` is supplied by the caller, and four endpoints used it verbatim to build a
// URL a user would later land on. Three are redirect targets after Stripe (annoying). The fourth
// is the confirmation link in the sign-up email, and Supabase appends the session tokens to it —
// so a request carrying `Origin: https://evil.example` would mail a stranger a link that hands
// their new session to whoever asked. That was held shut only by Supabase's own redirect
// allowlist: a dashboard setting this code neither sets nor can see.
//
// An origin is a claim, not a fact. This is the list of places we will send anyone.
const ALLOWED_ORIGINS = new Set([
  'https://vaest.orions.agency',
  'https://vaest-orions.vercel.app',
  'http://localhost:3000',
  'http://localhost:3300',
]);
export function safeOrigin(req) {
  const o = (req && req.headers && req.headers.origin) || '';
  if (ALLOWED_ORIGINS.has(o)) return o;
  // Vercel preview deployments are ours and change name every push, so match them by shape.
  if (/^https:\/\/vaest-orions-[a-z0-9-]+\.vercel\.app$/.test(o)) return o;
  if (o) console.error('rejected origin', o, '— falling back to production');
  return 'https://vaest.orions.agency';
}

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
  return readRow(subRow(email));
}

export async function writeSub(email, data) {
  return writeRow(subRow(email), data);
}

// A paid subscription counts only if Stripe says it's in an access-granting status.
//
// Note what is NOT required here: a plan name. Stripe saying `active` means a card was charged,
// and that fact does not become less true because a price id fell out of STRIPE_PRICE_*. Access
// used to hinge on `sub.plan`, so an env drift revoked a paying customer's account silently — the
// one failure mode where the person harmed has done nothing wrong and cannot see the cause.
export function subIsActive(sub) {
  return !!(sub && ACTIVE_STATUS.has(sub.status));
}

// Lazy re-verification — makes the webhook optional for correctness, not just onboarding.
// During a paid period we trust the stored row (zero API calls). Once the known period has
// ended (renewal/cancel boundary) we re-check the subscription straight from Stripe, so a
// cancellation or failed renewal revokes access even with no webhook configured. Throttled,
// and fail-open on any transient error so a Stripe blip never locks out a paying customer.
async function maybeRefreshSub(email, sub) {
  if (!sub || !sub.subId) return sub;
  const nowSec = Math.floor(Date.now() / 1000);
  const periodOver = !sub.currentPeriodEnd || nowSec >= sub.currentPeriodEnd;
  if (!periodOver) return sub;                                   // still inside the paid period
  if (sub.lastVerify && nowSec - sub.lastVerify < 3600) return sub; // re-check at most hourly
  const stripe = await getStripe();
  if (!stripe) return sub;                                       // no key → keep stored (fail-open)
  try {
    const fresh = await stripe.subscriptions.retrieve(sub.subId);
    const item = fresh.items && fresh.items.data && fresh.items.data[0];
    const priceId = (item && item.price && item.price.id) || sub.priceId;
    const updated = {
      ...sub,
      plan: planForPrice(priceId) || sub.plan,
      status: fresh.status,
      priceId: priceId || null,
      quantity: (item && item.quantity) || sub.quantity || 1,
      currentPeriodEnd: fresh.current_period_end || (item && item.current_period_end) || null,
      cancelAtPeriodEnd: !!fresh.cancel_at_period_end,
      lastVerify: nowSec,
    };
    await writeSub(email, updated);
    return updated;
  } catch (err) {
    if (err && (err.statusCode === 404 || err.code === 'resource_missing')) {
      const gone = { ...sub, status: 'canceled', lastVerify: nowSec };
      await writeSub(email, gone);
      return gone;
    }
    console.error('sub re-verify failed (keeping stored):', err?.message || err);
    return sub;                                                  // transient → fail-open
  }
}

// A Team subscription is the same plan billed by quantity — so a 10-seat Pro pays ten times and,
// until now, received exactly one seat's entitlements. `quantity` was written to the sub row by
// the webhook and by /api/confirm, read back by maybeRefreshSub, and then used by nothing: not
// docs, not capTokens, not spendCap. The customer paying the most got the least, and hit
// "usage limit reached" roughly ten times sooner than the individual on the same plan.
//
// It also broke law #5 in the direction nobody notices: spendCap is 70% of what a plan EARNS, and
// with ten seats the plan earns ten times as much, so a fixed cap was quietly holding margin far
// ABOVE 30% by refusing to deliver what had been paid for. Scaling the quantitative entitlements
// restores both the promise and the law. `refine` stays a boolean — it is an unlock, not an amount
// — and Infinity stays Infinity.
export function scaleForSeats(plan, seats) {
  const n = Math.max(1, Math.min(500, parseInt(seats, 10) || 1));
  if (n === 1 || !plan) return plan;
  const mul = v => (Number.isFinite(v) ? v * n : v);
  return { ...plan, seats: n, docs: mul(plan.docs), refineMonth: mul(plan.refineMonth),
           capTokens: mul(plan.capTokens), spendCap: mul(plan.spendCap) };
}

// ── the resolver every API route uses ──
// Precedence: internal → own active sub → a team whose owner has one → PLAN_MAP → INVITED → wall.
//
// Every branch also returns `meterKey`: the account whose usage row this request bills against.
// For everyone except a team member that is themselves. For a team member it is the OWNER, so a
// ten-seat plan is ten times one allowance shared by ten people — not ten separate allowances, and
// not (as it would have been the moment seats became reachable) ten times the allowance each.
export async function resolveAccess(email) {
  const e = (email || '').toLowerCase();
  if (isInternal(e)) return { allowed: true, internal: true, source: 'internal', meterKey: e, plan: { name: 'unlimited', ...PLANS.unlimited } };

  let sub = await readSub(e);
  sub = await maybeRefreshSub(e, sub);
  if (subIsActive(sub)) {
    // An unresolvable plan resolves to the cheapest paid tier, not to nothing. It is the smallest
    // thing that can be true of someone Stripe says is paying, and it is recoverable — the next
    // webhook with a mapped price corrects it. Being locked out is not recoverable by the user.
    if (!sub.plan || !PLANS[sub.plan]) console.error('resolveAccess: unmapped plan', sub.plan, 'for', e, '— granting basic; fix STRIPE_PRICE_*');
    const p = PLANS[sub.plan] || PLANS.basic;
    return { allowed: true, internal: false, source: 'stripe', status: sub.status, meterKey: e, owner: e,
             seats: Math.max(1, parseInt(sub.quantity, 10) || 1),
             plan: scaleForSeats({ name: sub.plan, ...p }, sub.quantity), customerId: sub.customerId || null };
  }

  // On someone else's team. The plan, the seats and the pool are all the owner's; this person just
  // has a way in — which until now no amount of paying could buy them.
  const owner = await ownerOf(e);
  if (owner) {
    let osub = await maybeRefreshSub(owner, await readSub(owner));
    if (subIsActive(osub)) {
      const p = PLANS[osub.plan] || PLANS.basic;
      return { allowed: true, internal: false, source: 'team', status: osub.status, meterKey: owner, owner,
               seats: Math.max(1, parseInt(osub.quantity, 10) || 1),
               plan: scaleForSeats({ name: osub.plan, ...p }, osub.quantity), customerId: null };
    }
  }

  // comp / trial via code allowlists (no Stripe sub yet)
  if (Object.prototype.hasOwnProperty.call(PLAN_MAP, e)) {
    const name = PLAN_MAP[e];
    return { allowed: true, internal: false, source: 'comp', meterKey: e, plan: { name, ...(PLANS[name] || PLANS.director) },
             customerId: (sub && sub.customerId) || null };
  }
  if (INVITED.has(e)) {
    return { allowed: true, internal: false, source: 'invite', meterKey: e, plan: { name: 'director', ...PLANS.director },
             customerId: (sub && sub.customerId) || null };
  }

  // no sub, not invited → paywall. Surface a canceled/lapsed sub so the client can nudge.
  return { allowed: false, internal: false, source: sub ? 'lapsed' : 'none', meterKey: e,
           status: sub ? sub.status : null, plan: null, customerId: (sub && sub.customerId) || null };
}
