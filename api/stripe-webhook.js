import Stripe from 'stripe';
import { planByLookupKey, patchUsage, DEFAULT_PLAN } from '../lib/plans.js';

// ต้องอ่าน raw body เพื่อ verify signature — ปิด bodyParser
export const config = { api: { bodyParser: false } };

const KEY = process.env.STRIPE_SECRET_KEY || '';
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = KEY ? new Stripe(KEY) : null;

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// อ่านแผนจาก subscription (lookup_key ของ price = source of truth)
function planFromSub(sub) {
  const lk = sub?.items?.data?.[0]?.price?.lookup_key;
  return lk ? planByLookupKey(lk) : (sub?.metadata?.plan || DEFAULT_PLAN);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!stripe || !WHSEC) { res.status(503).json({ error: 'stripe not configured' }); return; }

  let event;
  try {
    const buf = await rawBody(req);
    event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], WHSEC);
  } catch (e) {
    res.status(400).send(`Webhook signature error: ${e.message}`);
    return;
  }

  try {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const email = (o.metadata && o.metadata.email) || o.client_reference_id;
      const plan = (o.metadata && o.metadata.plan) || DEFAULT_PLAN;
      if (email) await patchUsage(email.toLowerCase(), {
        plan, stripeCustomer: o.customer || null, stripeSub: o.subscription || null, status: 'active',
      });
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const email = o.metadata && o.metadata.email;
      const active = ['active', 'trialing', 'past_due'].includes(o.status);
      if (email) await patchUsage(email.toLowerCase(), {
        plan: active ? planFromSub(o) : DEFAULT_PLAN, stripeSub: o.id, status: o.status,
      });
    } else if (event.type === 'customer.subscription.deleted') {
      const email = o.metadata && o.metadata.email;
      if (email) await patchUsage(email.toLowerCase(), { plan: DEFAULT_PLAN, status: 'canceled' });
    }
    res.status(200).json({ received: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'handler error' });
  }
}
