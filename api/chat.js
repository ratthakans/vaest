import Anthropic from '@anthropic-ai/sdk';
import { isAllowed, capFor, readUsage, readUsageData, writeUsageRow, verifyUser } from '../lib/plans.js';

// ANTHROPIC_API_KEY มาจาก Vercel env เท่านั้น
const anthropic = new Anthropic();

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

  // invite-only — ต้องอยู่ใน allowlist
  if (!isAllowed(user.email)) { res.status(403).json({ error: 'บัญชีนี้ยังไม่ได้รับเชิญให้ใช้ VÆST' }); return; }

  const { mode = 'summing', messages = [], system = '' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages required' }); return; }

  // fair-use token cap ต่อเดือน (มองไม่เห็น — กันค่าใช้จ่ายพุ่ง · ทีม ORIONS ไม่จำกัด)
  const u = await readUsage(user.email);
  const cap = capFor(user.email);
  if (u.used >= cap) {
    res.status(429).json({ error: `ใช้งานเดือนนี้ถึงเพดาน fair-use แล้ว (${Math.round(u.used/1000)}K tokens) — ทักทีม ORIONS ได้เลย` });
    return;
  }

  const route = ROUTE[mode] || ROUTE.summing;
  const base = TASK[mode] || TASK.summing;
  const sys = base + (system ? '\n\n' + system : '');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Model', route.model);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const { inTok, outTok } = await streamAnthropic(res, route.model, sys, messages, 8192);
    const d0 = await readUsageData(user.email);
    await writeUsageRow(user.email, { ...d0, month: u.month, used: u.used + inTok + outTok });
    res.write(`\n[[USAGE]]${inTok},${outTok},${route.model}`); // ให้ client ดู cost รายเอกสารได้
    res.end();
  } catch (e) {
    res.write('\n[[ERROR]] ' + (e?.message || 'server error'));
    res.end();
  }
}
