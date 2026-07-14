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

// ── ORIONS team — unlimited ──
export const INTERNAL = new Set([
  'rakan@orions.agency',
  'rakan.suwanphakdee@gmail.com',
]);

// ── invited people (outside the team) — add emails here then redeploy ──
export const INVITED = new Set([
  'namfonn2369@gmail.com',
  'rommaneeya.karom@gmail.com',
]);

// monthly token cap for invitees (fair-use, guards cost) · ORIONS team = unlimited
export const MONTHLY_CAP = parseInt(process.env.MONTHLY_CAP || '', 10) || 8_000_000;

export function isAllowed(email) {
  const e = (email || '').toLowerCase();
  // PLAN_MAP is the source of truth for paying customers — a mapped email is allowed
  // even if it was never added to INVITED (avoids locking out someone you just billed).
  return INTERNAL.has(e) || INVITED.has(e) || Object.prototype.hasOwnProperty.call(PLAN_MAP, e);
}
export function capFor(email) {
  return INTERNAL.has((email || '').toLowerCase()) ? Infinity : MONTHLY_CAP;
}

// ── plans: per-plan document caps + engine gating (guards token cost) ──
// A "document" = one Summing run. `refine` gates the priciest engine (Norrsken · mode "mastering").
// The monthly token cap above is the ultimate backstop regardless of plan.
// One clean monthly allowance — no hidden weekly wall (week caps are Infinity, so a
// customer gets the full monthly number the site advertises, usable whenever they like).
// refineMonth caps the priciest engine (Norrsken · Fable) at "one Refine per document",
// which bounds the worst-case cost without feeling stingy. The monthly doc cap is what
// actually protects margin; the weekly cap never did, so it's gone.
export const PLANS = {
  basic:     { docs: 20,  week: Infinity, refine: false, refineMonth: 0,   refineWeek: Infinity },
  pro:       { docs: 60,  week: Infinity, refine: true,  refineMonth: 60,  refineWeek: Infinity },
  director:  { docs: 120, week: Infinity, refine: true,  refineMonth: 120, refineWeek: Infinity },
  unlimited: { docs: Infinity, week: Infinity, refine: true, refineMonth: Infinity, refineWeek: Infinity },
};
// email → plan name. Add paying customers here as they subscribe (same pattern as INVITED).
export const PLAN_MAP = {
  // 'someone@studio.com': 'basic',
};
// invited users not explicitly mapped get a generous default (no lockout before billing exists)
const DEFAULT_PLAN = 'director';

export function planFor(email) {
  const e = (email || '').toLowerCase();
  if (INTERNAL.has(e)) return { name: 'unlimited', ...PLANS.unlimited };
  const p = PLAN_MAP[e] || DEFAULT_PLAN;
  return { name: p, ...(PLANS[p] || PLANS.director) };
}

// Monday-anchored week key (UTC) for the weekly guard
function weekKey() {
  const d = new Date();
  const back = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// Usage boost (credit top-up) — a one-time Stripe payment adds extra documents +
// Refines for the CURRENT month (scoped so it can't be hoarded across months).
export const BOOST = { docs: 15, refines: 15 };

// month-scoped extras from purchased boosts
function extrasFor(d, month) {
  const ok = d.extraMonth === month;
  return { docs: ok ? (d.extraDocs || 0) : 0, refines: ok ? (d.extraRefines || 0) : 0 };
}

// Pure: credit `packs` boosts onto a usage-data object. Idempotent per Stripe session id —
// both /api/confirm and the webhook may try to apply the same purchase.
export function applyBoost(d, sid, packs = 1) {
  const sids = Array.isArray(d.boostSids) ? d.boostSids : [];
  if (sid && sids.includes(sid)) return d; // already credited
  const n = Math.max(1, Math.min(10, parseInt(packs, 10) || 1));
  const month = new Date().toISOString().slice(0, 7);
  const ex = extrasFor(d, month);
  return {
    ...d, extraMonth: month,
    extraDocs: ex.docs + BOOST.docs * n, extraRefines: ex.refines + BOOST.refines * n,
    boostSids: [...sids, sid].filter(Boolean).slice(-20),
  };
}

// Read-only document-quota check (no write). Returns {ok:true} or {ok:false, scope, cap}.
// The counter is only bumped AFTER a document actually succeeds (see applyDocBump), so a
// failed/aborted Summing never consumes a document. Caller must fail-open on throw.
export async function checkDocQuota(email, plan) {
  if (!plan || (plan.docs === Infinity && plan.week === Infinity)) return { ok: true };
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekKey();
  const d = await readUsageData(email);
  const dMonth = d.docMonth === month ? (d.docCount || 0) : 0;
  const dWeek  = d.docWeek === wk ? (d.docWeekCount || 0) : 0;
  const cap = plan.docs + extrasFor(d, month).docs; // plan + purchased boosts
  if (dMonth >= cap) return { ok: false, scope: 'month', cap };
  if (dWeek  >= plan.week) return { ok: false, scope: 'week',  cap: plan.week };
  return { ok: true };
}

// Pure: apply one document increment to a usage-data object, handling month/week rollover.
// Merge this into the same write that records token usage so the two don't clobber each other.
export function applyDocBump(d) {
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekKey();
  const dMonth = d.docMonth === month ? (d.docCount || 0) : 0;
  const dWeek  = d.docWeek === wk ? (d.docWeekCount || 0) : 0;
  return { ...d, docMonth: month, docCount: dMonth + 1, docWeek: wk, docWeekCount: dWeek + 1 };
}

// Read-only Refine (Norrsken · Fable) quota check — the priciest engine, capped to
// protect margin. Returns {ok:true} or {ok:false, scope, cap}. Fail-open on throw.
export async function checkRefineQuota(email, plan) {
  const rm = plan ? plan.refineMonth : Infinity, rw = plan ? plan.refineWeek : Infinity;
  if (rm === Infinity && rw === Infinity) return { ok: true };
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekKey();
  const d = await readUsageData(email);
  const rMonth = d.refMonth === month ? (d.refCount || 0) : 0;
  const rWeek  = d.refWeek === wk ? (d.refWeekCount || 0) : 0;
  const cap = rm + extrasFor(d, month).refines; // plan + purchased boosts
  if (rMonth >= cap) return { ok: false, scope: 'month', cap };
  if (rWeek  >= rw) return { ok: false, scope: 'week',  cap: rw };
  return { ok: true };
}

// Snapshot for /api/access — everything the client needs to draw an abstract meter
// (percentage + reset date), without exposing raw plan numbers to the UI.
export async function usageSnapshot(email, plan) {
  const month = new Date().toISOString().slice(0, 7);
  const d = await readUsageData(email);
  const ex = extrasFor(d, month);
  const docsUsed = d.docMonth === month ? (d.docCount || 0) : 0;
  const refsUsed = d.refMonth === month ? (d.refCount || 0) : 0;
  const docCap = plan && Number.isFinite(plan.docs) ? plan.docs + ex.docs : null;
  const refCap = plan && Number.isFinite(plan.refineMonth) ? plan.refineMonth + ex.refines : null;
  // first day of next month (UTC) — when the allowance refreshes
  const now = new Date();
  const resetsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return {
    pct: docCap ? Math.min(100, Math.round(docsUsed / docCap * 100)) : null,
    refinePct: refCap ? Math.min(100, Math.round(refsUsed / refCap * 100)) : null,
    boosted: ex.docs > 0,
    resetsOn,
  };
}

// Pure: apply one Refine increment (month/week rollover). Merge into the usage write.
export function applyRefineBump(d) {
  const month = new Date().toISOString().slice(0, 7);
  const wk = weekKey();
  const rMonth = d.refMonth === month ? (d.refCount || 0) : 0;
  const rWeek  = d.refWeek === wk ? (d.refWeekCount || 0) : 0;
  return { ...d, refMonth: month, refCount: rMonth + 1, refWeek: wk, refWeekCount: rWeek + 1 };
}

const usageRow = email => 'usage:' + email;

export async function readUsageData(email) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(usageRow(email))}&select=data`, { headers: svcHeaders });
    if (!r.ok) console.error('readUsageData: Supabase read failed', r.status, '— metering may under-count (fail-open)');
    const rows = r.ok ? await r.json() : [];
    return (rows[0] && rows[0].data) || {};
  } catch (e) { console.error('readUsageData threw:', e?.message || e); return {}; }
}

export async function readUsage(email) {
  const month = new Date().toISOString().slice(0, 7);
  const d = await readUsageData(email);
  return { month, used: d.month === month ? (d.used || 0) : 0 };
}

export async function writeUsageRow(email, data) {
  try {
    const resp = await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: usageRow(email), data, updated_at: new Date().toISOString() }),
    });
    if (!resp.ok) console.error('writeUsageRow: usage NOT recorded', resp.status, '— cap may be under-counting');
  } catch (e) { console.error('writeUsageRow threw (usage NOT recorded):', e?.message || e); }
}

// ── auth: verify Supabase JWT ──
export async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const r = await fetch(`${SB.url}/auth/v1/user`, { headers: { apikey: SB.key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.email ? { email: u.email.toLowerCase(), id: u.id } : null;
  } catch (e) { return null; }
}
