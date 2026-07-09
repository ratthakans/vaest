// VÆST — invite-only. allowlist อยู่ในโค้ด (ปลอดภัยสุด · แก้แล้ว redeploy)

export const SB = {
  url: 'https://yyhqcqlylnoukmovrpwo.supabase.co',
  key: 'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM',
};

// ── ทีม ORIONS — ไม่จำกัด ──
export const INTERNAL = new Set([
  'rakan@orions.agency',
  'rakan.suwanphakdee@gmail.com',
]);

// ── รายชื่อที่ได้รับเชิญ (นอกทีม) — เพิ่มอีเมลที่นี่แล้ว redeploy ──
export const INVITED = new Set([
  // 'someone@example.com',
]);

// เพดาน token/เดือน สำหรับผู้รับเชิญ (fair-use กันค่าใช้จ่ายพุ่ง) · ทีม ORIONS = ไม่จำกัด
export const MONTHLY_CAP = parseInt(process.env.MONTHLY_CAP || '', 10) || 8_000_000;

export function isAllowed(email) {
  const e = (email || '').toLowerCase();
  return INTERNAL.has(e) || INVITED.has(e);
}
export function capFor(email) {
  return INTERNAL.has((email || '').toLowerCase()) ? Infinity : MONTHLY_CAP;
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
  const month = new Date().toISOString().slice(0, 7);
  const d = await readUsageData(email);
  return { month, used: d.month === month ? (d.used || 0) : 0 };
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
