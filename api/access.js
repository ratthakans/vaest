import { verifyUser, isAllowed, INTERNAL, capFor, readUsage } from '../lib/plans.js';

// access check (invite-only) — client calls after login to show the right screen + quota
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }
  const internal = INTERNAL.has(user.email);
  let used = 0, cap = null;
  if (!internal) {
    try { used = (await readUsage(user.email)).used; } catch (e) {}
    const c = capFor(user.email);
    cap = Number.isFinite(c) ? c : null;
  }
  res.status(200).json({
    allowed: isAllowed(user.email),
    internal,
    email: user.email,
    used, cap,
  });
}
