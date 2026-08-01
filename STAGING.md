# Staging — the missing half

Production is currently the only place VÆST runs. Local secrets pulled from Vercel come back as
`[SENSITIVE]` placeholders, there is no staging deploy, and `npm run eval` used to default at
production. So every change went from an editor to live customers with nothing exercising it in
between, and "does it still work?" could only be answered after shipping.

CI (`.github/workflows/ci.yml`) now covers everything that can be checked without secrets — syntax,
unit maths, billing arithmetic, the SSRF guard and its reachability, the structural audit. What it
cannot do is sign in, pay, or call an engine. That needs an environment, and creating one needs
dashboard access, so the four steps below are yours.

---

## ⚠️ Read this first

Vercel already builds a Preview deployment for every non-`main` branch — **and by default a Preview
inherits Production environment variables.** The Stripe key in this project is a live key.

That means a preview deploy today can take a real payment from a real card, and can write to the
real Supabase. Until step 2 is done, treat every preview URL as production.

---

## 1 · A staging branch

```bash
git checkout -b staging && git push -u origin staging
```

Vercel builds it automatically. The URL appears in the deployment list.

## 2 · Preview-scoped environment variables

Vercel → Project → Settings → Environment Variables. For each of these, add a **Preview**-scoped
value so it overrides the Production one:

| Variable | Preview value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` — the single most important line here |
| `STRIPE_WEBHOOK_SECRET` | the test-mode endpoint's `whsec_…` |
| `STRIPE_PRICE_*` | the price ids from **test** mode (different ids, same plans) |
| `SUPABASE_SERVICE_ROLE_KEY` | a second Supabase project's key — see step 3 |
| `ANTHROPIC_API_KEY` | a separate key, so staging spend is visible on its own line |
| `GEMINI_API_KEY` | same reasoning |

Leave `KV_*` unset on Preview: the in-memory limiter is the right choice for a low-traffic branch.

## 3 · A second Supabase project

Staging must not read or write customer rows. Create a second project, run `supabase-rls.sql`
against it, and put its URL and publishable key behind an env lookup rather than the constants in
`lib/plans.js` and `js/app.js` — they are hardcoded today, which is the one code change this
requires and the reason it is step 3 and not step 1.

## 4 · Point the eval at it

```bash
VAEST_API=https://<staging-url> VAEST_EMAIL=… VAEST_PASSWORD=… npm run eval
```

The harness now defaults to `localhost` and warns loudly if you aim it at production.

---

## What good looks like when this is done

- Push a branch → CI runs the suite → a preview deploys with test billing and its own data
- Sign up, subscribe with `4242 4242 4242 4242`, crystallize, refine, share, export — the whole
  path, on a URL no customer will ever see
- `npm run eval` scores Thai and English briefs against the staging engines before a prompt change
  reaches anyone
- Only then does `staging` merge into `main`

Nothing in that list is exotic. Its absence is the single largest reason the product reads as
unfinished: not that the work is missing, but that nobody could ever walk the whole thing through
before a customer did.
