// VÆST eval harness — runs real briefs through the production pipeline and
// checks the output contract + prints a taste rubric for manual scoring.
//
// Usage:
//   VAEST_EMAIL=you@x.com VAEST_PASSWORD=... npm run eval          # all briefs
//   VAEST_EMAIL=... VAEST_PASSWORD=... npm run eval -- thai-rebrand # one brief
//
// Costs real tokens (Opus). Run before shipping prompt/model changes.

const API = process.env.VAEST_API || 'https://vaest.orions.agency';
const SB = { url: 'https://yyhqcqlylnoukmovrpwo.supabase.co', key: 'sb_publishable_baZ9N1npPznt4zjsOJ69_w_kGEHq7aM' };

const BRIEFS = [
  {
    id: 'thai-rebrand',
    brief: 'รีแบรนด์ร้านกาแฟย่านอารีย์ โทนอบอุ่นแต่ไม่เชย กลุ่มเป้าหมายครีเอทีฟ 25–40 ต้องการโลโก้ เมนู และป้ายหน้าร้าน',
    checks: { lang: 'th', minSections: 3 },
    rubric: ['ตัดสินใจแทนลูกค้า ไม่ใช่เสนอ 10 ทางเลือก', 'มีเหตุผลเชิง taste ไม่ใช่แค่ checklist', 'ไม่มี marketing jargon กลวงๆ'],
  },
  {
    id: 'en-campaign',
    brief: 'Launch campaign for a Thai specialty coffee brand entering Singapore. Audience: young professionals. Budget modest, channels: social + one OOH moment. We need a big idea and a 6-week plan.',
    checks: { lang: 'en', minSections: 3 },
    rubric: ['One clear big idea, not a list of tactics', 'The OOH moment is genuinely shareable', 'Timeline is realistic for the budget'],
  },
  {
    id: 'quotation',
    brief: 'ทำใบเสนอราคา + สรุปแนวทางเว็บไซต์ให้บริษัทที่ปรึกษาการเงิน กลุ่มลูกค้า expat และคนไทย ต้องดูน่าเชื่อถือมาก มีระบบนัดหมาย',
    checks: { lang: 'th', minSections: 4 },
    rubric: ['โครงราคา/ขอบเขตชัดพอจะเซ็นได้', 'มีมุม trust ที่เกินพื้นฐาน', 'ภาษาเหมาะกับลูกค้าการเงิน'],
  },
  {
    id: 'multi-canvas',
    brief: 'งานใหญ่: รีแบรนด์บริษัท + ทำ copywriting platform + ออกแบบ event เปิดตัว สามส่วนนี้ทีมแยกกันทำ ช่วยแยกเอกสารให้ด้วย',
    checks: { expectSplit: true },
    rubric: ['แต่ละ canvas ยืนได้ด้วยตัวเอง', 'ทิศทางสามส่วนสอดคล้องเป็นแบรนด์เดียว'],
  },
  {
    id: 'messy-input',
    brief: 'ลูกค้าบอกว่า "อยากได้อะไรที่ wow แต่ minimal แล้วก็ต้อง luxury แต่เข้าถึงง่าย งบไม่เยอะ" ทำ direction ร้านอาหาร fine dining ให้หน่อย',
    checks: { lang: 'th', minSections: 3 },
    rubric: ['กล้าชี้ความขัดแย้งในบรีฟและ "เลือก" ให้', 'แปลงคำลอยๆ เป็นการตัดสินใจที่จับต้องได้'],
  },
];

async function login() {
  const email = process.env.VAEST_EMAIL, password = process.env.VAEST_PASSWORD;
  if (!email || !password) { console.error('Set VAEST_EMAIL and VAEST_PASSWORD'); process.exit(1); }
  const r = await fetch(`${SB.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SB.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!d.access_token) { console.error('Login failed:', d.error_description || d.msg); process.exit(1); }
  return d.access_token;
}

async function summing(token, brief) {
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ mode: 'summing', messages: [{ role: 'user', content: '# Brief\n' + brief }] }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const full = await r.text();
  const u = full.indexOf('[[USAGE]]');
  return { md: (u >= 0 ? full.slice(0, u) : full).trim(), usage: u >= 0 ? full.slice(u + 9).trim() : '' };
}

const isThai = t => ((t.match(/[฀-๿]/g) || []).length / Math.max(t.length, 1)) > 0.15;

(async () => {
  const only = process.argv[2];
  const briefs = only ? BRIEFS.filter(b => b.id === only) : BRIEFS;
  if (!briefs.length) { console.error('Unknown brief id. Available:', BRIEFS.map(b => b.id).join(', ')); process.exit(1); }
  const token = await login();
  let hard = 0;

  for (const b of briefs) {
    console.log('\n━━━ ' + b.id + ' ━━━');
    const t0 = Date.now();
    let out;
    try { out = await summing(token, b.brief); }
    catch (e) { console.log('  ✗ CALL FAILED —', e.message); hard++; continue; }
    const { md } = out;
    const secs = Math.round((Date.now() - t0) / 1000);

    // hard checks (contract)
    const c = b.checks || {};
    const results = [];
    if (c.expectSplit) results.push(['splits into canvases', /^===\s*CANVAS:/m.test(md)]);
    else {
      results.push(['has # title', /^#\s+.+/m.test(md)]);
      results.push([`≥ ${c.minSections} sections`, (md.match(/^##\s+/gm) || []).length >= (c.minSections || 2)]);
    }
    if (c.lang === 'th') results.push(['answers in Thai', isThai(md)]);
    if (c.lang === 'en') results.push(['answers in English', !isThai(md)]);

    results.forEach(([name, ok]) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name); if (!ok) hard++; });
    console.log(`  · ${md.length} chars · ${secs}s · ${out.usage}`);

    // taste rubric — human judgment, printed for review
    console.log('  RUBRIC (score 1–5 each):');
    b.rubric.forEach(r => console.log('    ☐ ' + r));
    console.log('  ── first 400 chars ──');
    console.log('  ' + md.slice(0, 400).replace(/\n/g, '\n  '));
  }

  console.log('\n' + (hard ? `✗ ${hard} hard-check failure(s)` : '✓ all hard checks passed') + ' · rubric scores are yours to judge\n');
  process.exit(hard ? 1 : 0);
})();
