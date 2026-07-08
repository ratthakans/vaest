import Stripe from 'stripe';
import { verifyUser, readUsageData } from '../lib/plans.js';

const KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = KEY ? new Stripe(KEY) : null;
const SITE = process.env.SITE_URL || 'https://vaest-orions.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!stripe) { res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Stripe' }); return; }

  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }); return; }

  const d = await readUsageData(user.email);
  if (!d.stripeCustomer) { res.status(400).json({ error: 'ยังไม่มีการสมัครสมาชิก' }); return; }

  try {
    const s = await stripe.billingPortal.sessions.create({
      customer: d.stripeCustomer,
      return_url: `${SITE}/app`,
    });
    res.status(200).json({ url: s.url });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'เปิด portal ไม่สำเร็จ' });
  }
}
