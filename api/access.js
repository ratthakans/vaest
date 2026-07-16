import { verifyUser, usageSnapshot } from '../lib/plans.js';
import { resolveAccess } from '../lib/billing.js';

// Access check — the client calls this after login to pick the right screen:
//   allowed:false → show the plan picker (paywall)
//   allowed:true  → open the app with the right plan + usage meter
// Usage is reported as an abstract meter (percentage + reset date) — raw plan numbers
// stay server-side so the product speaks in "usage", not internal document counts.
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }

  const access = await resolveAccess(user.email);
  const internal = access.internal;

  let usage = null;
  if (!internal && access.allowed) {
    try { usage = await usageSnapshot(user.email, access.plan); } catch (e) {}
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
    // Engine wiring — ORIONS team only, booleans, never a key value. Every engine falls back
    // silently on a missing/bad key (Mimir→Odin, Galdr→Haiku), which is right for customers but
    // means an unwired engine looks identical to a working one from the outside. This is the
    // only way to tell "Ø Think runs on Mimir" from "Ø Think has been quietly running on Odin".
    engines: internal ? {
      odin: !!process.env.ANTHROPIC_API_KEY,
      mimir: !!process.env.OPENAI_API_KEY,
      galdr: !!process.env.GEMINI_API_KEY,
    } : undefined,
  });
}
