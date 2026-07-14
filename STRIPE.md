# VÆST × Stripe — setup & operations

Self-serve subscriptions (Basic / Pro / Director), a customer portal, and webhook-driven
plan enforcement. Team is billed per-seat (same prices × quantity); Business is sales-led
via Stripe Invoicing. **Access model: pay to activate, OR request an invite for comp/trial.**

## Architecture

```
Marketing card  ──/app?plan=pro──▶  app boot  ──POST /api/checkout──▶  Stripe Checkout (hosted)
                                                                              │ pays
Stripe  ──event──▶  POST /api/stripe-webhook  ──writes──▶  Supabase  sub:<email>
                                                                │
Every request ──▶ resolveAccess(email) reads sub:<email> ──▶ plan + gating (chat.js / access.js)
Settings ▸ Manage billing ──POST /api/portal──▶  Stripe Billing Portal
```

- **Source of truth for a plan = the `sub:<email>` row**, written only by the webhook (service key).
- Code allowlists still work: `INTERNAL` = unlimited, `INVITED` / `PLAN_MAP` = comp/trial.
- No paid sub and not invited → the app shows the **plan picker** (paywall) instead of the app.

## One-time setup

### 1. Create products & prices (THB, monthly)

**Option A — script (needs Node):**
```bash
STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.mjs
```
It prints the three `STRIPE_PRICE_*=price_...` lines. Re-runnable (reuses what it tagged).

**Option B — Stripe Dashboard (no Node):** Products → **Add product**, three times:
| Product | Price | Billing |
|---|---|---|
| VÆST Basic | ฿390 | Recurring · monthly · THB |
| VÆST Pro | ฿1,490 | Recurring · monthly · THB |
| VÆST Director | ฿3,490 | Recurring · monthly · THB |

Open each price and copy its **API ID** (`price_…`) → these become
`STRIPE_PRICE_BASIC` / `_PRO` / `_DIRECTOR`.

### 2. Add env vars in Vercel → Project → Settings → Environment Variables
| Var | Value | Secret? |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` then `sk_live_…` | 🔒 yes |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (from step 3) | 🔒 yes |
| `STRIPE_PRICE_BASIC` / `_PRO` / `_DIRECTOR` | from step 1 | no |

> Never put the secret key in code or git — only in Vercel env. Price ids are not secret.

### 3. Create the webhook endpoint
Stripe Dashboard → Developers → Webhooks → **Add endpoint**
- URL: `https://vaest.orions.agency/api/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`
- Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET` in Vercel.

### 4. Enable the Customer Portal
Stripe Dashboard → Settings → Billing → Customer portal → activate (allow plan switch + cancel).

### 5. Redeploy
Push or redeploy so Vercel installs `stripe` and picks up the env vars.

## Test (Stripe test mode)
1. Log into `/app` with a test account (not on any allowlist) → you should see the **plan picker**.
2. Click a plan → Stripe Checkout → pay with `4242 4242 4242 4242`, any future date, any CVC.
3. Return to `/app?checkout=success` → “activating…” → app opens on that plan.
4. Confirm `sub:<email>` exists in Supabase and `/api/access` returns `allowed:true` + the plan.
5. Settings ▸ **Manage billing** → portal → cancel → `customer.subscription.deleted` fires →
   next `/api/access` returns `allowed:false` (paywall). 

Local webhook testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`.

## Go live
Swap to `sk_live_…`, re-run step 1 with the live key, update the price env vars, create a
**live** webhook endpoint, update `STRIPE_WEBHOOK_SECRET`, redeploy.

## Follow-ups (not yet built)
- **Team seat provisioning** — billing supports per-seat quantity, but assigning seats to
  teammate emails / a team-admin screen is still to build. Team checkout currently grants the
  buyer's own account the plan.
- **Business invoicing** — send custom hosted invoices via the Stripe API (Invoicing product).
- **Marketing Team CTA** — the pricing page's Team toggle still points to “talk to us”.
- `DEFAULT_PLAN` in `lib/plans.js` is still `director` (used only for `INVITED` comp accounts).
