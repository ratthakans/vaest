import { verifyUser, isAllowed, INTERNAL, capFor, readUsage, readUsageData, planFor } from '../lib/plans.js';

// access check (invite-only) — client calls after login to show the right screen, quota + plan
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }
  const internal = INTERNAL.has(user.email);
  let used = 0, cap = null, docsUsed = 0;
  if (!internal) {
    try { used = (await readUsage(user.email)).used; } catch (e) {}
    const c = capFor(user.email);
    cap = Number.isFinite(c) ? c : null;
    try {
      const d = await readUsageData(user.email);
      const month = new Date().toISOString().slice(0, 7);
      docsUsed = d.docMonth === month ? (d.docCount || 0) : 0;
    } catch (e) {}
  }
  const p = planFor(user.email);
  res.status(200).json({
    allowed: isAllowed(user.email),
    internal,
    email: user.email,
    used, cap, docsUsed,
    plan: {
      name: p.name,
      refine: p.refine,                                  // false only on Basic
      docs: Number.isFinite(p.docs) ? p.docs : null,     // null = unlimited (JSON can't carry Infinity)
    },
  });
}
