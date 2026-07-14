import { readUsageData, writeUsageRow, applyBoost } from '../lib/plans.js';
import { getStripe, planForPrice, readSub, writeSub } from '../lib/billing.js';

// Stripe posts events here. We MUST verify the signature against the raw request
// body, so Vercel's JSON body parser is disabled and we read the stream ourselves.
export const config = { api: { bodyParser: false } };

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// Turn a Stripe Subscription object into our compact store row and persist it.
async function upsertFromSubscription(stripe, sub, evCreated) {
  let email = sub.metadata && sub.metadata.email;
  if (!email && sub.customer) {
    try { const c = await stripe.customers.retrieve(sub.customer); email = c && !c.deleted ? c.email : null; } catch (e) {}
  }
  if (!email) { console.error('webhook: subscription with no resolvable email', sub.id); return; }
  email = email.toLowerCase();

  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price && item.price.id;
  const plan = planForPrice(priceId) || (sub.metadata && sub.metadata.plan) || null;

  // out-of-order guard: ignore an event older than the one we last applied to this sub
  const prev = await readSub(email);
  if (prev && prev.subId === sub.id && prev.evAt && evCreated && evCreated < prev.evAt) {
    return;
  }

  await writeSub(email, {
    plan,
    status: sub.status,                                   // active | trialing | past_due | canceled | …
    customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || (prev && prev.customerId) || null,
    subId: sub.id,
    priceId: priceId || null,
    quantity: (item && item.quantity) || 1,
    kind: (sub.metadata && sub.metadata.kind) || 'individual',
    currentPeriodEnd: sub.current_period_end || null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    evAt: evCreated || null,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const stripe = await getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) { console.error('webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing'); res.status(503).end(); return; }

  let event;
  try {
    const raw = await readRaw(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error('webhook signature verification failed:', e?.message || e);
    res.status(400).json({ error: 'bad signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        // one-time usage boost → credit extras (idempotent per session id, so /api/confirm
        // and this webhook can both fire without double-crediting)
        if (s.mode === 'payment' && s.metadata && s.metadata.boost) {
          const email = ((s.metadata && s.metadata.email) || s.client_reference_id || '').toLowerCase();
          if (email && s.payment_status === 'paid') {
            const packs = parseInt(s.metadata.packs, 10) || 1;
            const d = await readUsageData(email);
            const next = applyBoost(d, s.id, packs);
            if (next !== d) await writeUsageRow(email, next);
          }
          break;
        }
        if (s.mode === 'subscription' && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          // carry the session's email/plan onto the subscription metadata if Stripe hasn't yet
          if (!sub.metadata) sub.metadata = {};
          if (!sub.metadata.email && s.metadata && s.metadata.email) sub.metadata.email = s.metadata.email;
          if (!sub.metadata.plan && s.metadata && s.metadata.plan) sub.metadata.plan = s.metadata.plan;
          await upsertFromSubscription(stripe, sub, event.created);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(stripe, event.data.object, event.created);
        break;
      }
      default:
        // ignore everything else
        break;
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('webhook handler error:', e?.message || e);
    // 500 tells Stripe to retry — safe because writes are idempotent by email
    res.status(500).json({ error: 'handler failed' });
  }
}
