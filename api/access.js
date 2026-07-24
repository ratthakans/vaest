import { verifyUser, usageSnapshot, readUsageData } from '../lib/plans.js';
import { kvConfigured } from '../lib/ratelimit.js';
import { resolveAccess } from '../lib/billing.js';

// Access check — the client calls this after login to pick the right screen:
//   allowed:false → show the plan picker (paywall)
//   allowed:true  → open the app with the right plan + usage meter
// Usage is reported as an abstract meter (percentage + reset date) — raw plan numbers
// stay server-side so the product speaks in "usage", not internal document counts.
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }

  // the sub row (resolveAccess) and the usage row are independent — read them together, then
  // hand the usage row to whichever branch below needs it (no second/third round-trip)
  const [access, ud] = await Promise.all([resolveAccess(user.email), readUsageData(user.email).catch(() => ({}))]);
  const internal = access.internal;
  const month = new Date().toISOString().slice(0, 7);

  let usage = null;
  if (!internal && access.allowed) {
    try { usage = await usageSnapshot(user.email, access.plan, ud); } catch (e) {}
  } else if (!internal) {
    // free tier — expose the Galdr allowance as the same abstract % so the app's rail
    // meter works before there's a plan
    try {
      const used = ud.month === month ? (ud.used || 0) : 0;
      const FREE_CAP = parseInt(process.env.FREE_MONTHLY_CAP || '', 10) || 150_000; // must match api/chat.js — the rail meter reads this
      const now = new Date();
      usage = {
        pct: Math.min(100, Math.round(used / FREE_CAP * 100)),
        resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10),
      };
    } catch (e) {}
  }
  const p = access.plan;
  res.status(200).json({
    allowed: access.allowed,
    internal,
    email: user.email,
    source: access.source,            // internal | stripe | comp | invite | lapsed | none
    status: access.status || null,    // Stripe subscription status when source=stripe/lapsed
    canManage: !!access.customerId,   // has a Stripe customer → can open the billing portal
    usage,                            // { pct, refinePct, boosted, resetsOn } or null
    plan: p ? {
      name: p.name,
      refine: p.refine,               // false only on Basic
    } : null,
    // Engine wiring — ORIONS team only, booleans, never a key value. Three engines now, all on
    // Anthropic (Galdr = Sonnet, Odin = Opus, Norrsken = Fable) plus Gemini for the tiny `tag`
    // label. odin true ⇒ the Anthropic key that powers all three is present; galdr's Gemini key
    // only affects topic labels. The old cross-provider Mimir(OpenAI)→Odin fallback is gone.
    engines: internal ? {
      odin: !!process.env.ANTHROPIC_API_KEY,   // powers Galdr · Odin · Norrsken (all Anthropic)
      galdr: !!process.env.GEMINI_API_KEY,      // Gemini — the `tag` topic-label call only
      kv: kvConfigured(), // rate limits distributed (true) vs per-instance in-memory (false)
    } : undefined,
  });
}
