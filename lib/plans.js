// VÆST — แหล่งความจริงของแผน/โควตา + helper คุยกับ Supabase (ใช้ร่วมกันทุก endpoint)

export const SB = {
  url: 'https://yyhqcqlylnoukmovrpwo.supabase.co',
  key: 'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM',
};

// limit รายสัปดาห์ (soft, จำนวนเอกสารใหม่/Summing) + เพดาน token รายเดือน (hard, fair-use)
// stripeKey = lookup_key ของ Price ใน Stripe · amount = สตางค์ (THB ×100)
export const PLANS = {
  solo:     { label: 'Solo',   wk: 10,       moTok: 1_500_000,  amount: 59000,  stripeKey: 'vaest_solo' },
  studio:   { label: 'Studio', wk: 40,       moTok: 6_000_000,  amount: 190000, stripeKey: 'vaest_studio' },
  agency:   { label: 'Agency', wk: 200,      moTok: 25_000_000, amount: 590000, stripeKey: 'vaest_agency' },
  internal: { label: 'ORIONS', wk: Infinity, moTok: Infinity,   amount: 0,      stripeKey: null },
};
export const PAID_PLANS = ['solo', 'studio', 'agency'];
export const DEFAULT_PLAN = 'solo';
export const INTERNAL = new Set(['rakan@orions.agency', 'rakan.suwanphakdee@gmail.com']);

export function planOf(email, data) {
  if (INTERNAL.has(email)) return 'internal';
  const p = data && data.plan;
  return PLANS[p] ? p : DEFAULT_PLAN;
}
export function planByLookupKey(key) {
  return PAID_PLANS.find(p => PLANS[p].stripeKey === key) || DEFAULT_PLAN;
}

// สัปดาห์เริ่มวันจันทร์ (UTC) → คีย์ YYYY-MM-DD
export function weekKey() {
  const now = Date.now();
  const dow = (new Date(now).getUTCDay() + 6) % 7;
  return new Date(now - dow * 86400000).toISOString().slice(0, 10);
}

const sbHeaders = { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json' };
const usageRow = email => 'usage:' + email;

export async function readUsageData(email) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(usageRow(email))}&select=data`, { headers: sbHeaders });
    const rows = r.ok ? await r.json() : [];
    return (rows[0] && rows[0].data) || {};
  } catch (e) { return {}; }
}

export async function readUsage(email) {
  const month = new Date().toISOString().slice(0, 7), week = weekKey();
  const d = await readUsageData(email);
  return {
    month, week,
    used: d.month === month ? (d.used || 0) : 0,
    wkCount: d.week === week ? (d.wkCount || 0) : 0,
    plan: planOf(email, d),
  };
}

export async function writeUsageRow(email, data) {
  try {
    await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: usageRow(email), data, updated_at: new Date().toISOString() }),
    });
  } catch (e) { /* best-effort */ }
}

// merge บางฟิลด์ลง usage row โดยไม่ทับของเดิม (สำหรับ webhook ตั้งแผน)
export async function patchUsage(email, patch) {
  const d = await readUsageData(email);
  await writeUsageRow(email, { ...d, ...patch });
}

// ── auth: ตรวจ Supabase JWT ──
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
