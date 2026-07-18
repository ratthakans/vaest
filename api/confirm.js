import { verifyUser, readUsageData, writeUsageRow, applyBoost } from '../lib/plans.js';
import { getStripe, planForPrice, writeSub } from '../lib/billing.js';

// Confirm a just-completed Checkout Session and activate the subscription immediately
// on the redirect back from Stripe — so access is granted without needing a webhook.
// (The webhook remains the source of truth for later changes like cancellations/renewals,
// but is optional for launch: this covers the pay → activate happy path.)
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'sign in first' }); return; }

  const stripe = await getStripe();
  if (!stripe) { res.status(503).json({ error: 'billing not configured' }); return; }

  const sessionId = (req.body && req.body.session_id) || '';
  if (!/^cs_/.test(sessionId)) { res.status(400).json({ error: 'bad session id' }); return; }

  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    // the session must belong to this signed-in account
    const owner = ((s.metadata && s.metadata.email) || s.client_reference_id || '').toLowerCase();
    if (owner !== user.email) { res.status(403).json({ error: 'not your session' }); return; }
    // money must actually have moved. A session can be status:'complete' while payment_status
    // is still 'unpaid' (PromptPay / delayed settlement) — activating then would grant access
    // before payment clears. Require a paid (or no-payment-required, e.g. 100%-off / trial)
    // status; anything else is `pending` and the client retries confirm until it clears.
    const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
    if (!paid) {
      res.status(200).json({ activated: false, pending: true });
      return;
    }

    // one-time usage boost → credit extra usage for this month (idempotent per session)
    if (s.mode === 'payment' && s.metadata && s.metadata.boost) {
      const packs = parseInt(s.metadata.packs, 10) || 1;
      const d = await readUsageData(user.email);
      const next = applyBoost(d, s.id, packs);
      if (next !== d) await writeUsageRow(user.email, next);
      res.status(200).json({ activated: true, boosted: true });
      return;
    }

    const sub = s.subscription;
    if (!sub || typeof sub === 'string') { res.status(200).json({ activated: false }); return; }

    const item = sub.items && sub.items.data && sub.items.data[0];
    const priceId = item && item.price && item.price.id;
    const plan = planForPrice(priceId) || (s.metadata && s.metadata.plan) || null;

    await writeSub(user.email, {
      plan,
      status: sub.status,
      customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || (typeof s.customer === 'string' ? s.customer : null),
      subId: sub.id,
      priceId: priceId || null,
      quantity: (item && item.quantity) || 1,
      kind: (s.metadata && s.metadata.kind) || 'individual',
      currentPeriodEnd: sub.current_period_end || (item && item.current_period_end) || null, // moved onto the item in Stripe's 2025+ API versions
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      evAt: Math.floor(Date.now() / 1000),
    });
    res.status(200).json({ activated: true, plan });
  } catch (e) {
    console.error('confirm error:', e?.message || e);
    res.status(500).json({ error: 'could not confirm' });
  }
}
