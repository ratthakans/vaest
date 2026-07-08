import Anthropic from '@anthropic-ai/sdk';

// ANTHROPIC_API_KEY มาจาก Vercel env เท่านั้น
const anthropic = new Anthropic();

// Supabase — ใช้ตรวจ auth token + เก็บเครดิต (publishable key ฝั่ง frontend-safe)
const SB = {
  url: 'https://yyhqcqlylnoukmovrpwo.supabase.co',
  key: 'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM',
};
// ── Plans — limit รายสัปดาห์ (soft, จำนวนเอกสารใหม่/Summing) + เพดาน token รายเดือน (hard, fair-use) ──
const PLANS = {
  solo:    { label: 'Solo',    wk: 10,       moTok: 1_500_000 },
  studio:  { label: 'Studio',  wk: 40,       moTok: 6_000_000 },
  agency:  { label: 'Agency',  wk: 200,      moTok: 25_000_000 },
  internal:{ label: 'ORIONS',  wk: Infinity, moTok: Infinity },
};
const DEFAULT_PLAN = 'solo';
// อีเมลทีม ORIONS → ไม่จำกัด
const INTERNAL = new Set(['rakan@orions.agency', 'rakan.suwanphakdee@gmail.com']);
function planOf(email, data) {
  if (INTERNAL.has(email)) return 'internal';
  const p = data && data.plan;
  return PLANS[p] ? p : DEFAULT_PLAN;
}
// สัปดาห์เริ่มวันจันทร์ (UTC) — คืนคีย์ YYYY-MM-DD ของวันจันทร์
function weekKey() {
  const now = Date.now();
  const d = new Date(now);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(now - dow * 86400000);
  return mon.toISOString().slice(0, 10);
}

// VÆST 1.0 — ทุกงานแก้เอกสาร = Opus 4.8 · เฉพาะ Refined (ตรวจทั้งฉบับ) = Fable 5
const ROUTE = {
  summing:   { model: 'claude-opus-4-8' },
  improve:   { model: 'claude-opus-4-8' },
  edit:      { model: 'claude-opus-4-8' },
  apply:     { model: 'claude-opus-4-8' },
  mastering: { model: 'claude-fable-5' },
};

// ── Persona ~30% ORIONS ──
// ฐาน = Claude มาตรฐาน ชัดเจน เป็นประโยชน์ · เติมมุมมอง creative director เป็นเครื่องปรุง ไม่ใช่บทละคร
const BASE = `คุณคือ VÆST — ผู้ช่วยตกผลึกไอเดียของสตูดิโอ ORIONS.Agency

ทำงานแบบมืออาชีพมาตรฐาน: ชัดเจน อ่านง่าย เป็นธรรมชาติ ไม่เล่นบทบาท ไม่ประกาศตัวตน ไม่เย็นชา
สิ่งที่ติดตัวเสมอ (ประมาณ 30% ของนิสัย) คือมุมมองแบบ creative director:
- เข้าใจมิติ emotional, art, aesthetic ของงาน และคำนึงถึงเสมอเวลาสรุปหรือเสนอแนะ
- เมื่อเห็นโอกาสทำให้งานคมขึ้นหรือมีรสนิยมขึ้น ให้เสนออย่างเป็นธรรมชาติ — เสนอ ไม่ยัดเยียด
- เลี่ยงคำ cliché และ jargon การตลาดที่ว่างเปล่า

ตอบตามภาษาของผู้ใช้ (ไทยเป็นหลัก) ใช้ markdown ให้อ่านง่าย: หัวข้อชัด ย่อหน้าสั้น ใช้ตาราง/ลิสต์เมื่อช่วยให้เข้าใจเร็วขึ้น`;

const TASK = {
  summing: `${BASE}

# งานตอนนี้: SUMMING — ตกผลึกบรีฟ + แหล่งข้อมูลหลายชุด เป็นเอกสารเดียวที่ใช้ทำงานต่อได้จริง
- เขียนเป็น markdown: ขึ้นต้นด้วย "# ชื่อเอกสาร" แล้วแบ่ง section ด้วย "## "
- โครงยืดหยุ่นตามเนื้อหาจริง — ไม่ต้องฝืนโครงตายตัว แต่ถ้าบริบทเป็นงานสร้างสรรค์ ให้ครอบคลุมแก่นความคิด/ทิศทาง และแนวทางลงมือ (ขั้นตอน, สิ่งส่งมอบ)
- กระชับ อ่านง่าย แต่ละ section มีประเด็นเดียวชัดๆ`,
  improve: `${BASE}

# งานตอนนี้: IMPROVE — เกลา section เดียวให้ดีขึ้น
รับหัวข้อ + เนื้อของ section หนึ่ง (พร้อมบริบทเอกสาร) แล้วปรับให้คมขึ้น ชัดขึ้น อ่านง่ายขึ้น
ตอบกลับเป็น "เนื้อ section ที่ปรับแล้ว" เท่านั้น (markdown) — ห้ามใส่หัวข้อ ## ซ้ำ ห้ามอธิบายว่าปรับอะไร`,
  edit: `${BASE}

# งานตอนนี้: EDIT — เกลาข้อความสั้นๆ ที่ผู้ใช้ไฮไลต์ในเอกสาร
รับ "คำสั่ง" + "ข้อความที่เลือก" (พร้อมบริบทย่อหน้ารอบข้าง) แล้วส่งกลับ "เฉพาะข้อความที่เกลาแล้ว" เท่านั้น
- คงภาษาเดิม (ไทย/อังกฤษ) และแก่นความหมาย
- ตอบเป็นข้อความล้วนๆ — ห้ามมีคำอธิบาย ห้ามใส่เครื่องหมายคำพูดครอบ ห้ามขึ้นหัวข้อ ห้ามขึ้นบรรทัดว่าง
- ความยาวใกล้เคียงของเดิม (เว้นแต่คำสั่งให้สั้น/ยาวขึ้น) · ใช้ **ตัวหนา**/*เอียง* ได้ถ้าเหมาะ แต่อย่าเกินจำเป็น`,
  apply: `${BASE}

# งานตอนนี้: APPLY — ปรับเอกสารตามข้อเสนอที่ผู้ใช้ approve แล้ว
รับเอกสารเต็ม + ข้อเสนอ แล้วปรับเฉพาะที่เกี่ยวข้องให้ทั้งฉบับยังสอดคล้องกัน
ตอบกลับเป็น markdown เต็มฉบับเท่านั้น (คง "# ชื่อ" และโครง "## " เดิม) — ห้ามอธิบายว่าปรับอะไร`,
  mastering: `${BASE}

# งานตอนนี้: MASTERING — final recheck ทั้งฉบับ
อ่านทั้งเอกสาร ตรวจว่าแต่ละส่วนสอดคล้องกัน: โทนเดียวกัน ไม่ขัดแย้งกันเอง ไม่ตกหล่นประเด็นสำคัญ
เสนอจุดปรับ 2–5 จุดที่ทำให้ดีขึ้นจริง (ความสอดคล้อง, ความชัด, มุม emotional/aesthetic ที่พลาดไป)
ตอบเป็น markdown: แต่ละจุดขึ้นด้วย "- " ตามด้วย **หัวข้อสั้น** แล้วอธิบาย 1–2 บรรทัดว่าปรับยังไง`,
};

// ── auth: ตรวจ Supabase JWT → คืน user (หรือ null) ──
async function verifyUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const r = await fetch(`${SB.url}/auth/v1/user`, {
      headers: { apikey: SB.key, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.email ? { email: u.email.toLowerCase(), id: u.id } : null;
  } catch (e) { return null; }
}

// ── credit: อ่าน/เขียน usage (เก็บใน vaest_state แถว email = "usage:<email>") ──
const sbHeaders = { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json' };
async function readUsage(email) {
  const month = new Date().toISOString().slice(0, 7), week = weekKey();
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent('usage:' + email)}&select=data`, { headers: sbHeaders });
    const rows = r.ok ? await r.json() : [];
    const d = (rows[0] && rows[0].data) || {};
    return {
      month, week,
      used: d.month === month ? (d.used || 0) : 0,   // token เดือนนี้ (hard)
      wkCount: d.week === week ? (d.wkCount || 0) : 0, // เอกสารสัปดาห์นี้ (soft)
      plan: planOf(email, d),
    };
  } catch (e) { return { month, week, used: 0, wkCount: 0, plan: planOf(email, null) }; }
}
async function writeUsage(email, u) {
  try {
    await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: 'usage:' + email, data: {
        month: u.month, used: u.used, week: u.week, wkCount: u.wkCount, plan: u.plan, limit: u.moTok,
      }, updated_at: new Date().toISOString() }),
    });
  } catch (e) { /* best-effort */ }
}

async function streamAnthropic(res, model, system, messages, maxTokens) {
  const params = { model, max_tokens: maxTokens, messages };
  if (system) params.system = system;
  const stream = anthropic.messages.stream(params);
  let inTok = 0, outTok = 0;
  for await (const ev of stream) {
    if (ev.type === 'message_start' && ev.message?.usage) inTok = ev.message.usage.input_tokens || 0;
    if (ev.type === 'message_delta' && ev.usage) outTok = ev.usage.output_tokens || outTok;
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') res.write(ev.delta.text);
  }
  return { inTok, outTok };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // 1) auth
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ หรือเซสชันหมดอายุ' }); return; }

  const { mode = 'summing', messages = [], system = '' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages required' }); return; }

  // 2) usage + plan
  const u = await readUsage(user.email);
  const plan = PLANS[u.plan];
  const isNewDoc = mode === 'summing';                   // เอกสารใหม่ = นับ weekly
  const wkAfter = u.wkCount + (isNewDoc ? 1 : 0);

  // hard cap — token รายเดือนตามแพลน
  if (u.used >= plan.moTok) {
    res.status(429).json({ error: `เครดิตเดือนนี้ของแพลน ${plan.label} หมดแล้ว (${Math.round(u.used/1000)}K tokens) — อัปเกรดแพลน หรือรอต้นเดือนหน้า` });
    return;
  }

  const route = ROUTE[mode] || ROUTE.summing;
  const base = TASK[mode] || TASK.summing;
  const sys = base + (system ? '\n\n' + system : '');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Model', route.model);
  res.setHeader('X-Plan', u.plan);
  res.setHeader('X-Credit-Used', String(u.used));
  res.setHeader('X-Credit-Limit', plan.moTok === Infinity ? '0' : String(plan.moTok));
  res.setHeader('X-Week-Used', String(wkAfter));
  res.setHeader('X-Week-Limit', plan.wk === Infinity ? '0' : String(plan.wk));
  res.setHeader('X-Week-Over', (isNewDoc && wkAfter > plan.wk) ? '1' : '0'); // soft — เตือน ไม่บล็อก
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const { inTok, outTok } = await streamAnthropic(res, route.model, sys, messages, 8192);
    await writeUsage(user.email, { month: u.month, week: u.week, used: u.used + inTok + outTok, wkCount: wkAfter, plan: u.plan, moTok: plan.moTok });
    res.end();
  } catch (e) {
    res.write('\n[[ERROR]] ' + (e?.message || 'server error'));
    res.end();
  }
}
