import { verifyUser, capFor, readUsage, readUsageData } from '../lib/plans.js';
import { resolveAccess } from '../lib/billing.js';

// Access check — the client calls this after login to pick the right screen:
//   allowed:false → show the plan picker (paywall)
//   allowed:true  → open the app with the right plan + quota
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }

  const access = await resolveAccess(user.email);
  const internal = access.internal;

  let used = 0, cap = null, docsUsed = 0, refinesUsed = 0;
  if (!internal) {
    try { used = (await readUsage(user.email)).used; } catch (e) {}
    const c = capFor(user.email);
    cap = Number.isFinite(c) ? c : null;
    try {
      const d = await readUsageData(user.email);
      const month = new Date().toISOString().slice(0, 7);
      docsUsed = d.docMonth === month ? (d.docCount || 0) : 0;
      refinesUsed = d.refMonth === month ? (d.refCount || 0) : 0;
    } catch (e) {}
  }

  const p = access.plan;
  res.status(200).json({
    allowed: access.allowed,
    internal,
    email: user.email,
    source: access.source,            // internal | stripe | comp | invite | lapsed | none
    status: access.status || null,    // Stripe subscription status when source=stripe/lapsed
    canManage: !!access.customerId,    // has a Stripe customer → can open the billing portal
    used, cap, docsUsed, refinesUsed,
    plan: p ? {
      name: p.name,
      refine: p.refine,                                  // false only on Basic
      docs: Number.isFinite(p.docs) ? p.docs : null,     // null = unlimited (JSON can't carry Infinity)
      refineMonth: Number.isFinite(p.refineMonth) ? p.refineMonth : null,
    } : null,
  });
}
