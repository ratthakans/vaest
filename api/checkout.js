import { verifyUser } from '../lib/plans.js';
import { getStripe, PRICES, TEAM_PRICES, SELF_SERVE_PLANS, readSub } from '../lib/billing.js';

// Create a Stripe Checkout Session (subscription mode) for the signed-in user.
// Body: { plan: 'basic'|'pro'|'director', kind?: 'individual'|'team', seats?: number }
// Returns { url } to redirect the browser to Stripe's hosted checkout.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'sign in first' }); return; }

  const stripe = await getStripe();
  if (!stripe) { res.status(503).json({ error: 'billing not configured' }); return; }

  const { plan, kind = 'individual', seats } = req.body || {};

  // ── usage boost: one-time top-up that credits extra usage for the current month ──
  if (plan === 'boost') {
    const boostPrice = process.env.STRIPE_PRICE_BOOST || '';
    if (!boostPrice) { res.status(503).json({ error: 'boost not configured' }); return; }
    const origin2 = req.headers.origin || 'https://vaest.orions.agency';
    try {
      const sub = await readSub(user.email);
      const customerField = sub && sub.customerId ? { customer: sub.customerId } : { customer_email: user.email };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: boostPrice, quantity: 1 }],
        ...customerField,
        client_reference_id: user.email,
        metadata: { email: user.email, boost: '1' },
        success_url: `${origin2}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin2}/app?checkout=cancel`,
      });
      res.status(200).json({ url: session.url });
    } catch (e) {
      console.error('boost checkout error:', e?.message || e);
      res.status(500).json({ error: 'could not start checkout' });
    }
    return;
  }

  if (!SELF_SERVE_PLANS.has(plan)) { res.status(400).json({ error: 'unknown plan' }); return; }

  const isTeam = kind === 'team';
  // Team is the same per-unit price billed by quantity; a dedicated per-seat price is optional.
  const priceId = isTeam ? (TEAM_PRICES[plan] || PRICES[plan]) : PRICES[plan];
  if (!priceId) { res.status(503).json({ error: `no price configured for ${kind} ${plan}` }); return; }
  const quantity = isTeam ? Math.max(2, Math.min(500, parseInt(seats, 10) || 2)) : 1;

  const origin = req.headers.origin || 'https://vaest.orions.agency';

  try {
    // reuse the customer we stored from a prior sub, else let Checkout create one by email
    const sub = await readSub(user.email);
    const customerField = sub && sub.customerId
      ? { customer: sub.customerId }
      : { customer_email: user.email };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity }],
      ...customerField,
      client_reference_id: user.email,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      // metadata on BOTH the session and the subscription so the webhook can always
      // recover the account email and plan regardless of which event fires first.
      metadata: { email: user.email, plan, kind },
      subscription_data: { metadata: { email: user.email, plan, kind } },
      success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancel#access`,
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout error:', e?.message || e);
    res.status(500).json({ error: 'could not start checkout' });
  }
}
