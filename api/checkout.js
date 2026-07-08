import Stripe from 'stripe';
import { PLANS, PAID_PLANS, verifyUser, readUsageData } from '../lib/plans.js';

// STRIPE_SECRET_KEY (test: sk_test_…) มาจาก Vercel env เท่านั้น
const KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = KEY ? new Stripe(KEY) : null;
const SITE = process.env.SITE_URL || 'https://vaest-orions.vercel.app';

// หา Price ตาม lookup_key ถ้าไม่มีก็สร้าง (Product+Price) — จะได้ไม่ต้อง hardcode price id
async function priceFor(planId) {
  const P = PLANS[planId];
  const found = await stripe.prices.list({ lookup_keys: [P.stripeKey], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await stripe.prices.create({
    currency: 'thb',
    unit_amount: P.amount,
    recurring: { interval: 'month' },
    lookup_key: P.stripeKey,
    product_data: { name: `VÆST ${P.label}` },
  });
  return price.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!stripe) { res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Stripe (STRIPE_SECRET_KEY)' }); return; }

  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' }); return; }

  const planId = (req.body && req.body.plan) || '';
  if (!PAID_PLANS.includes(planId)) { res.status(400).json({ error: 'แผนไม่ถูกต้อง' }); return; }

  try {
    const price = await priceFor(planId);
    const d = await readUsageData(user.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.email,
      customer: d.stripeCustomer || undefined,
      customer_email: d.stripeCustomer ? undefined : user.email,
      subscription_data: { metadata: { email: user.email, plan: planId } },
      metadata: { email: user.email, plan: planId },
      allow_promotion_codes: true,
      success_url: `${SITE}/app?checkout=success`,
      cancel_url: `${SITE}/app?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'สร้าง checkout ไม่สำเร็จ' });
  }
}
