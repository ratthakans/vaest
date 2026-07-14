import { verifyUser } from '../lib/plans.js';
import { getStripe, readSub } from '../lib/billing.js';

// Open a Stripe Billing Portal session so the customer can manage their own
// subscription (change plan, update card, cancel). Auth required.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'sign in first' }); return; }

  const stripe = await getStripe();
  if (!stripe) { res.status(503).json({ error: 'billing not configured' }); return; }

  const sub = await readSub(user.email);
  if (!sub || !sub.customerId) { res.status(404).json({ error: 'no subscription to manage' }); return; }

  const origin = req.headers.origin || 'https://vaest.orions.agency';
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.customerId,
      return_url: `${origin}/app`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('portal error:', e?.message || e);
    res.status(500).json({ error: 'could not open billing portal' });
  }
}
