// VÆST — invite-only. allowlist lives in code (most secure · edit then redeploy)

export const SB = {
  url: 'https://yyhqcqlylnoukmovrpwo.supabase.co',
  key: 'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM',
};

// Service-role key (server-only, bypasses RLS) for privileged rows: usage:% and errlog:%.
// These must NOT be writable by the public key, or a client could forge its own usage
// counter and defeat the fair-use cap. Falls back to the publishable key if the env isn't
// set yet, so nothing breaks before you add it — the hardening kicks in once it's present.
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SB.key;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY is unset — with RLS applied, usage metering and ALL caps will silently fail (falling back to the public key, which RLS blocks on usage:/errlog: rows).');
export const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

// Every Supabase call carries a timeout so a hung upstream can never pin the function until
// Vercel's max duration (billed, with the user staring at a spinner). One shared wrapper so
// the budget lives in one place.
const SB_TIMEOUT_MS = 10_000;
export function sbFetch(path, opts = {}) {
  const { timeoutMs, ...rest } = opts;
  return fetch(`${SB.url}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs || SB_TIMEOUT_MS) });
}
// Generic vaest_state row helpers — one source of truth for the read/upsert/delete shape that
// used to be copy-pasted across plans/billing/apikeys/share/log. readRow returns the row's
// `data`, or null if absent/failed (fail-open — each caller applies its own default: `|| {}`,
// `|| { keys: [] }`, …). writeRow/deleteRow return true on success so callers can surface failures.
export async function readRow(key) {
  try {
    const r = await sbFetch(`/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}&select=data`, { headers: svcHeaders });
    if (!r.ok) { console.error('readRow failed', key, r.status); return null; }
    const rows = await r.json();
    return (rows[0] && rows[0].data) || null;
  } catch (e) { console.error('readRow threw', key, e?.message || e); return null; }
}
export async function writeRow(key, data) {
  try {
    const r = await sbFetch(`/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: key, data, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) console.error('writeRow failed', key, r.status);
    return r.ok;
  } catch (e) { console.error('writeRow threw', key, e?.message || e); return false; }
}
export async function deleteRow(key) {
  try { const r = await sbFetch(`/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: svcHeaders }); return r.ok; }
  catch (e) { console.error('deleteRow threw', key, e?.message || e); return false; }
}

// ── ORIONS team — unlimited ──
export const INTERNAL = new Set([
  'rakan@orions.agency',
  'rakan.suwanphakdee@gmail.com',
]);
// the whole studio domain is the team — any @orions.agency address is internal (unlimited,
// sees the cost/margin tools). Individual emails above cover team members on other domains.
const INTERNAL_DOMAIN = '@orions.agency';
export function isInternal(email) {
  const e = (email || '').toLowerCase();
  return INTERNAL.has(e) || e.endsWith(INTERNAL_DOMAIN);
}

// ── invited people (outside the team) — add emails here then redeploy ──
export const INVITED = new Set([
  'namfonn2369@gmail.com',
  'rommaneeya.karom@gmail.com',
]);

// monthly token cap for invitees (fair-use, guards cost) · ORIONS team = unlimited
export const MONTHLY_CAP = parseInt(process.env.MONTHLY_CAP || '', 10) || 8_000_000;
export function capFor(email) {
  return isInternal(email) ? Infinity : MONTHLY_CAP;
}

// ── plans: per-plan document caps + engine gating (guards token cost) ──
// A "document" = one Summing run. `refine` gates the priciest engine (Norrsken · mode "mastering").
// The monthly token cap above is the ultimate backstop regardless of plan.
// One clean monthly allowance (resets on the 1st, UTC) — the full number the site
// advertises, usable whenever. refineMonth caps the priciest engine (Norrsken · Fable)
// at "one Refine per document", bounding worst-case cost without feeling stingy.
// Purchased credit (see BOOST) extends both beyond the plan and carries across months.
// capTokens = the invisible monthly fair-use token ceiling, scaled to what the plan's
// price can absorb. It's the backstop for the modes that don't count as documents
// (improve/apply/edit/sectionthink): with one flat 8M cap, a Basic (฿390) account could
// legally burn ~฿4,300 of Opus through uncounted edits. Sized at ~3× heavy legitimate
// use of the full allowance, so a real customer never feels it.
// spendCap = the hard COST ceiling per month, ฿ — 70% of what the plan actually EARNS, so the
// worst-case margin can never drop below 30% regardless of which engines a customer leans on
// (doc/token caps approximate behaviour; this one measures actual baht).
//
// It is 70% of NET, not of the sticker price. The caps used to read 0.70 × 390 — but ORIONS
// Creative Co., Ltd. is VAT-registered and Stripe Tax does not support Thailand, so nothing is
// added at checkout: ฿390 charged is ฿390 received, and Thai law treats that as VAT-inclusive.
// ฿25.51 of it belongs to the Revenue Department before it is ever revenue. Capping spend at
// 70% of the gross therefore allowed 74.9% of the real income — a 25.1% floor while the file
// claimed 30%. Each boost pack extends it by BOOST_SPEND on the same net basis.
// floor, not round: rounding a ceiling UPWARD breaks the very floor it exists to guarantee.
// At ฿1,490 the rounded cap came to 975, which is 70.017% of net — over the line the whole
// law is about. Two of the four plans did it. A cap always rounds toward the house.
const VAT = 1.07;
const cap = price => Math.floor(0.70 * price / VAT);   // ฿390 → 255 · ฿1,490 → 974 · ฿3,490 → 2,283
export const PLANS = {
  basic:     { docs: 20,  refine: false, refineMonth: 0,   capTokens: 1_500_000, spendCap: cap(390) },
  pro:       { docs: 60,  refine: true,  refineMonth: 60,  capTokens: 4_000_000, spendCap: cap(1490) },
  director:  { docs: 120, refine: true,  refineMonth: 120, capTokens: 8_000_000, spendCap: cap(3490) },
  unlimited: { docs: Infinity, refine: true, refineMonth: Infinity, capTokens: Infinity, spendCap: Infinity },
};
export const PACK_PRICE = 490;          // ฿ per credit pack — server-side truth; the client renders this
export const BOOST_SPEND = cap(490);    // ฿320 — same net basis, so top-ups hold the floor too

// ฿ per 1M tokens (in/out) per cost bucket — server-side truth for spend metering.
// galdr is rated at Haiku, NOT Flash: the free-tier Idea chat moved onto Haiku (Flash misspelled
// Thai), so the Haiku path is now the common case, not the rare fallback it was rated as. Leaving
// it at Flash-class would have understated real spend on every free-tier reply, and the 70% spend
// cap only guarantees the 30% margin floor if the meter is telling the truth. The remaining Flash
// traffic in this bucket is `tag` (16 output tokens), so over-rating it costs nothing.
export const RATES = {
  odin:     { in: 180, out: 900  },   // Opus 4.8    $5/$25 @ ฿36
  norrsken: { in: 360, out: 1800 },   // Fable 5     $10/$50
  mimir:    { in: 180, out: 1080 },   // GPT-5.6 Sol $5/$30
  sonnet:   { in: 108, out: 540  },   // Sonnet 5    $3/$15  — paid Idea chat (deeper than Flash)
  galdr:    { in: 36,  out: 180  },   // Haiku 4.5   $1/$5
};
export function costTHB(bucket, inTok, outTok) {
  const r = RATES[bucket] || RATES.odin;                       // unknown bucket → price as Opus (safe side)
  return (inTok * r.in + outTok * r.out) / 1_000_000;
}
// Monthly spend so far (฿). Same usage row as everything else.
export function spendThisMonth(d) {
  return d.spendMonth === monthKey() ? (d.spendTHB || 0) : 0;
}
// Pure: add a call's cost onto the usage-data object.
export function applySpend(d, thb) {
  const month = monthKey();
  const cur = d.spendMonth === month ? (d.spendTHB || 0) : 0;
  return { ...d, spendMonth: month, spendTHB: +(cur + thb).toFixed(4) };
}
// The month's spend ceiling: plan cap + what this month's boost packs paid for.
export function spendCapFor(plan, d) {
  const base = plan && Number.isFinite(plan.spendCap) ? plan.spendCap : Infinity;
  if (!Number.isFinite(base)) return Infinity;
  const packs = d.packMonth === monthKey() ? (d.packCount || 0) : 0;
  return base + packs * BOOST_SPEND;
}
// email → plan name. Add paying customers here as they subscribe (same pattern as INVITED).
export const PLAN_MAP = {
  // 'someone@studio.com': 'basic',
};
// invited users not explicitly mapped get a generous default (no lockout before billing exists)
const DEFAULT_PLAN = 'director';

export function planFor(email) {
  const e = (email || '').toLowerCase();
  if (isInternal(e)) return { name: 'unlimited', ...PLANS.unlimited };
  const p = PLAN_MAP[e] || DEFAULT_PLAN;
  return { name: p, ...(PLANS[p] || PLANS.director) };
}

// Usage credit (top-up) — a one-time Stripe payment adds a PERSISTENT balance of
// documents + Refines that carries across months and is spent only once the monthly
// plan allowance runs out, so credit never expires. Capped at MAX_PACKS_PER_MONTH
// purchases/month (beyond that, upgrading the plan is the better deal).
export const BOOST = { docs: 15, refines: 15 }; // one credit pack
export const MAX_PACKS_PER_MONTH = 3;

const monthKey = () => new Date().toISOString().slice(0, 7);

// Pure: credit `packs` onto a usage-data object. Idempotent per Stripe session id —
// both /api/confirm and the webhook may try to apply the same purchase.
export function applyBoost(d, sid, packs = 1) {
  const sids = Array.isArray(d.boostSids) ? d.boostSids : [];
  if (sid && sids.includes(sid)) return d; // already credited
  const n = Math.max(1, Math.min(10, parseInt(packs, 10) || 1));
  const month = monthKey();
  const pUsed = d.packMonth === month ? (d.packCount || 0) : 0;
  return {
    ...d,
    creditDocs: (d.creditDocs || 0) + BOOST.docs * n,        // persistent — no month scope
    creditRefines: (d.creditRefines || 0) + BOOST.refines * n,
    packMonth: month, packCount: pUsed + n,                  // enforce the monthly purchase cap
    boostSids: [...sids, sid].filter(Boolean).slice(-40),
  };
}

// How many more packs may be purchased this month.
export function packsLeft(d) {
  const used = d.packMonth === monthKey() ? (d.packCount || 0) : 0;
  return Math.max(0, MAX_PACKS_PER_MONTH - used);
}

// Read-only document check — monthly plan allowance first, then the persistent credit
// balance. Bumped only AFTER a Summing succeeds (applyDocBump), so a failed run is free.
export async function checkDocQuota(email, plan, pre) {
  if (!plan || plan.docs === Infinity) return { ok: true };
  const d = pre || await readUsageData(email); // callers on the hot path pass their one read
  const used = d.docMonth === monthKey() ? (d.docCount || 0) : 0;
  if (used < plan.docs) return { ok: true };          // within plan allowance
  if ((d.creditDocs || 0) > 0) return { ok: true };   // on purchased credit
  return { ok: false };
}

// Pure: apply one document — consume the monthly plan allowance first, else one credit.
// Merge into the same write that records token usage so the two don't clobber each other.
export function applyDocBump(d, planDocs) {
  const month = monthKey();
  const used = d.docMonth === month ? (d.docCount || 0) : 0;
  const cap = Number.isFinite(planDocs) ? planDocs : Infinity;
  if (used < cap) return { ...d, docMonth: month, docCount: used + 1 };
  return { ...d, creditDocs: Math.max(0, (d.creditDocs || 0) - 1) };
}

// Read-only Refine (Norrsken · Fable — priciest engine) check: plan allowance first,
// then credit. Credit refines work even on Basic (a pay-per-use unlock). Returns
// {ok:true} or {ok:false, canBuy} — canBuy:false means the plan itself excludes Refine
// and there's no credit, so "add a credit pack to use it now" is the right nudge.
export async function checkRefineQuota(email, plan, pre) {
  const rm = plan ? plan.refineMonth : Infinity;
  if (rm === Infinity) return { ok: true };
  const d = pre || await readUsageData(email);
  const used = d.refMonth === monthKey() ? (d.refCount || 0) : 0;
  if (used < rm) return { ok: true };                    // within plan allowance
  if ((d.creditRefines || 0) > 0) return { ok: true };   // on purchased credit
  return { ok: false, planHasRefine: !!(plan && plan.refine) };
}

// Snapshot for /api/access — everything the client needs to draw an abstract meter
// (percentage + reset date), without exposing raw plan numbers to the UI.
export async function usageSnapshot(email, plan, pre) {
  const month = monthKey();
  const d = pre || await readUsageData(email); // reuse a usage row already read this request
  const docsUsed = d.docMonth === month ? (d.docCount || 0) : 0;
  const refsUsed = d.refMonth === month ? (d.refCount || 0) : 0;
  const docCap = plan && Number.isFinite(plan.docs) ? plan.docs : null;
  const refCap = plan && Number.isFinite(plan.refineMonth) ? plan.refineMonth : null;
  // first day of next month (UTC) — when the monthly allowance refreshes (credit carries over)
  const now = new Date();
  const resetsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  // the meter reports whichever ceiling is nearer — documents used or real spend — so the
  // one abstract number never reads 60% while the spend cap is about to say "limit reached"
  const docPct = docCap ? Math.min(100, Math.round(docsUsed / docCap * 100)) : null;
  const sCap = spendCapFor(plan, d);
  const spendPct = Number.isFinite(sCap) && sCap > 0 ? Math.min(100, Math.round(spendThisMonth(d) / sCap * 100)) : null;
  return {
    pct: docPct === null && spendPct === null ? null : Math.max(docPct || 0, spendPct || 0),
    refinePct: refCap ? Math.min(100, Math.round(refsUsed / refCap * 100)) : null,
    boosted: (d.creditDocs || 0) > 0 || (d.creditRefines || 0) > 0,  // credit remaining
    packsLeft: packsLeft(d),                                          // caps the top-up UI
    packPrice: PACK_PRICE,                                            // ฿/pack — client renders, never hardcodes
    resetsOn,
  };
}

// Pure: apply one Refine — consume the monthly plan allowance first, else one credit.
export function applyRefineBump(d, planRefines) {
  const month = monthKey();
  const used = d.refMonth === month ? (d.refCount || 0) : 0;
  const cap = Number.isFinite(planRefines) ? planRefines : Infinity;
  if (used < cap) return { ...d, refMonth: month, refCount: used + 1 };
  return { ...d, creditRefines: Math.max(0, (d.creditRefines || 0) - 1) };
}

const usageRow = email => 'usage:' + email;

export async function readUsageData(email) {
  return (await readRow(usageRow(email))) || {};
}

export async function writeUsageRow(email, data) {
  await writeRow(usageRow(email), data);
}

// ── The usage row is contended: /api/chat's post-stream metering and applyBoost (from
// /api/confirm and the Stripe webhook) both read-modify-write it. Blind last-writer-wins let
// a metering write clobber a credit pack that had just been paid for — permanently, because
// it also wiped boostSids, the thing that makes applyBoost idempotent. Money taken, credit
// gone, no way to re-apply.
//
// updateUsage() re-reads, re-applies the caller's change, and commits only if the revision
// it read is still current (vaest_usage_cas takes the row lock and refuses a stale write);
// a lost race simply retries. All business logic stays in `mutate` — the DB only arbitrates.
export async function updateUsage(email, mutate, tries = 4) {
  const key = usageRow(email);
  for (let i = 0; i < tries; i++) {
    const cur = (await readRow(key)) || {};
    const rev = Number(cur.rev || 0);
    const next = await mutate({ ...cur });
    if (!next) return cur;                        // mutate opted out
    const { rev: _drop, ...clean } = next;        // the DB owns `rev`
    try {
      const r = await sbFetch('/rest/v1/rpc/vaest_usage_cas', {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: key, p_rev: rev, p_next: clean }),
      });
      if (r.ok) {
        const outRev = Number(await r.json());
        if (outRev > 0) return { ...clean, rev: outRev };
        continue;                                 // -1 → someone else won; re-read and retry
      }
      // RPC unavailable (not deployed / permissions) — fall back to the old write rather
      // than dropping the caller's change entirely
      console.error('usage CAS rpc failed', r.status);
      await writeRow(key, clean);
      return clean;
    } catch (e) {
      console.error('usage CAS threw', e?.message || e);
      await writeRow(key, clean);
      return clean;
    }
  }
  console.error('usage CAS gave up after', tries, 'tries', key);
  return null;
}

// ── auth: verify Supabase JWT ──
export async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const r = await sbFetch(`/auth/v1/user`, { headers: { apikey: SB.key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.email) return null;
    // Whether the address was ever proved to belong to this person. Google/OAuth sign-ins are
    // verified by the provider; email+password is verified only by clicking the confirm link.
    // The free tier spends real money, so it keys off this — see api/chat.js.
    const verified = !!(u.email_confirmed_at || u.confirmed_at
      || (u.user_metadata && u.user_metadata.email_verified === true));
    return { email: u.email.toLowerCase(), id: u.id, verified };
  } catch (e) { return null; }
}
