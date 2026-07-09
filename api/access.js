import { verifyUser, isAllowed, INTERNAL } from '../lib/plans.js';

// เช็คสิทธิ์เข้าใช้ (invite-only) — client เรียกตอน login เพื่อโชว์หน้าถูกต้อง
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ allowed: false, error: 'unauthorized' }); return; }
  res.status(200).json({
    allowed: isAllowed(user.email),
    internal: INTERNAL.has(user.email),
    email: user.email,
  });
}
