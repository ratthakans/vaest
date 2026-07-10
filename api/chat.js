import Anthropic from '@anthropic-ai/sdk';
import { isAllowed, capFor, readUsage, readUsageData, writeUsageRow, verifyUser } from '../lib/plans.js';

// ANTHROPIC_API_KEY comes from Vercel env only
const anthropic = new Anthropic();

// VÆST 1.2 — IDEA (sandbox) = Gemini Flash · THINK/write = Opus 4.8 · REFINE = Fable 5 · PRESENT = Sonnet 5
const GEMINI_MODEL = 'gemini-flash-latest';
const ROUTE = {
  idea:      { gemini: true, fallback: 'claude-haiku-4-5-20251001', max: 4096 },
  summing:   { model: 'claude-opus-4-8' },
  improve:   { model: 'claude-opus-4-8' },
  edit:      { model: 'claude-opus-4-8' },
  apply:     { model: 'claude-opus-4-8' },
  think:     { model: 'claude-opus-4-8' },
  mastering: { model: 'claude-fable-5' },
  present:   { model: 'claude-sonnet-5', max: 8192 },
};

// ── Persona ~30% ORIONS ──
// Base = a standard, helpful Claude · a creative-director lens as seasoning, not theatre
const BASE = `You are VÆST — the idea-crystallizing instrument of the studio ORIONS.Agency.

Work like a sharp professional: clear, readable, natural. No role-play, no announcing yourself, never cold.
Always carried (about 30% of your instinct) is a creative director's lens:
- Understand the emotional, art and aesthetic dimensions of the work, and keep them in mind when summarizing or advising.
- When you see a chance to make the work sharper or more tasteful, offer it naturally — offer, never force.
- Avoid clichés and empty marketing jargon.

Mirror the user's language: Thai question → Thai answer, English question → English answer. When sources are mixed, follow the language the user themselves writes in — never switch to English just because the sources are English. Use clean markdown: clear headings, short paragraphs, tables/lists when they speed understanding.`;

const TASK = {
  idea: `${BASE}

# CURRENT TASK: IDEA — the sandbox. You are a generous creative sparring partner.
- Riff freely and go long when the spark deserves it: open 3–6 angles, take the two strongest further, explain the thinking behind each so the user can build on it.
- Raw pasted material (other models' output, prompts, scraps) is welcome: react to it, keep the good part, kill the weak part, say why.
- End with one sharp question or a concrete next move when it helps.
- Markdown lists and short paragraphs; stay lively, never a wall of corporate prose.`,
  present: `${BASE}

# CURRENT TASK: PRESENT — turn the document into presentation slides.
Read the whole document and reshape it into a tight deck. Return ONLY a JSON array (no prose, no code fence) of slide objects:
[{"kind":"cover","title":"...","subtitle":"..."},
 {"kind":"content","title":"Section title","bullets":["short point","short point","short point"],"note":"one-line takeaway (optional)"},
 {"kind":"quote","quote":"a single strong line pulled from the work","by":"optional attribution"},
 {"kind":"close","title":"closing line","subtitle":"optional"}]
Rules: 6–12 slides total. One cover, one close. Bullets are 3–6 words each, max 5 per slide — compress, don't copy sentences. Keep the document's language. Titles are sharp and sentence-case.`,
  think: `${BASE}

# CURRENT TASK: Ø THINK — a Senior Creative Director provocation pass over the document.
Read the whole canvas like a CD reviewing a junior's deck: not proofreading — pushing. Find what would make the work braver and more shareable:
- missing cultural hooks or tensions, safe choices that could be bent (e.g. minimalist → a brutalist clash), unclaimed naming/copy angles, places where the idea stops one step too early.
Propose 3–6 pushes. Format each as: "- **short title** {{a short exact quote from the document this relates to}} — the push, 1–2 lines, concrete."
The {{quote}} must be 3–8 words copied verbatim from the document. Only bullets — no intro, no outro.`,
  summing: `${BASE}

# CURRENT TASK: SUMMING — crystallize the brief + multiple sources into one working document.
- Write in markdown: start with "# Document title", then split sections with "## ".
- Let the structure follow the real content — don't force a fixed template. For creative work, cover the core idea/direction and the way to execute it (steps, deliverables).
- Concise and readable; each section makes one clear point.
- If the work clearly spans multiple distinct deliverables (e.g. brand identity vs copywriting vs event visual), split them: put a line \`===CANVAS: Short Title===\` before each part, and give every part its own "# title" + "## " sections. Only split when the dimensions are genuinely separate — otherwise return one document with no marker.`,
  improve: `${BASE}

# CURRENT TASK: IMPROVE — refine one section.
You get a heading + a section's body (with document context). Make it sharper, clearer, easier to read.
Return ONLY the refined section body (markdown) — no repeated ## heading, no explanation of what you changed.`,
  edit: `${BASE}

# CURRENT TASK: EDIT — refine a short piece of text the user highlighted.
You get an "instruction" + the "selected text" (with surrounding paragraph context). Return ONLY the refined text.
- Keep the original language and core meaning.
- Return plain text only — no explanation, no surrounding quotes, no heading, no blank lines.
- Keep length close to the original (unless the instruction says shorter/longer) · use **bold**/*italic* only where it helps.`,
  apply: `${BASE}

# CURRENT TASK: APPLY — revise the document per a suggestion the user approved.
You get the full document + the suggestion. Adjust only what's relevant while keeping the whole piece consistent.
Return the FULL markdown document only (keep the "# title" and "## " structure) — no explanation of changes.`,
  mastering: `${BASE}

# CURRENT TASK: REFINED — a holistic audit of the whole document, bird's-eye.
Read the entire canvas and hunt three things: INCONSISTENCY (tone or claims that contradict across sections), REDUNDANCY (repeated words, ideas that circle), LOGIC (does the flow actually hold up).
Propose 2–5 genuinely improving points.
Format each as: "- **short title** {{a short exact quote from the document where the problem lives}} — 1–2 lines on how to fix it."
The {{quote}} must be 3–8 words copied verbatim from the document. Only bullets — no intro, no outro.`,
};

// sliding-window burst guard (per warm serverless instance)
const _hits = new Map();
function rateLimited(email) {
  const now = Date.now();
  const arr = (_hits.get(email) || []).filter(t => now - t < 60_000);
  if (arr.length >= 12) { _hits.set(email, arr); return true; }
  arr.push(now); _hits.set(email, arr);
  if (_hits.size > 500) _hits.clear(); // memory backstop
  return false;
}

// Gemini (Idea sandbox) — streamed via SSE, rough token estimate. Throws on any error so the caller can fall back.
async function streamGemini(res, base, dynamic, messages, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no-gemini-key');
  const sys = base + (dynamic ? '\n\n' + dynamic : '');
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('\n') }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 1.0 },
    }),
  });
  if (!r.ok || !r.body) throw new Error('gemini-http-' + r.status);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const js = line.slice(5).trim(); if (js === '[DONE]') continue;
      try {
        const d = JSON.parse(js);
        const t = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (t) { out += t; res.write(t); }
      } catch (e) {}
    }
  }
  if (!out) throw new Error('gemini-empty');
  const inTok = Math.ceil(JSON.stringify(contents).length / 4), outTok = Math.ceil(out.length / 4);
  return { inTok, outTok, model: GEMINI_MODEL };
}

async function streamAnthropic(res, model, base, dynamic, messages, maxTokens) {
  const params = { model, max_tokens: maxTokens, messages };
  // system as blocks: the static persona/task prefix is cache-marked (free hits within the 5-min window);
  // the dynamic part (tone / project voice) rides in a second block
  const system = [{ type: 'text', text: base, cache_control: { type: 'ephemeral' } }];
  if (dynamic) system.push({ type: 'text', text: dynamic });
  params.system = system;
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
  if (!user) { res.status(401).json({ error: 'Not signed in, or your session expired' }); return; }

  // invite-only — must be on the allowlist
  if (!isAllowed(user.email)) { res.status(403).json({ error: 'This account is not invited to VÆST' }); return; }

  // burst guard — 12 calls/min/user (per warm instance; coarse but real)
  if (rateLimited(user.email)) { res.status(429).json({ error: 'Too fast — give it a few seconds and try again' }); return; }

  const { mode = 'summing', messages = [], system = '' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages required' }); return; }

  // monthly fair-use token cap (invisible — guards against runaway cost · ORIONS team unlimited)
  const u = await readUsage(user.email);
  const cap = capFor(user.email);
  if (u.used >= cap) {
    res.status(429).json({ error: `Fair-use limit reached this month (${Math.round(u.used/1000)}K tokens) — ping the ORIONS team` });
    return;
  }

  const route = ROUTE[mode] || ROUTE.summing;
  const base = TASK[mode] || TASK.summing;
  const maxTok = route.max || 8192;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Model', route.gemini ? GEMINI_MODEL : route.model);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    let usage;
    if (route.gemini) {
      // Idea sandbox → Gemini Flash, but never let a Gemini hiccup break the flow: fall back to Haiku
      try { usage = await streamGemini(res, base, system || '', messages, maxTok); }
      catch (ge) { usage = await streamAnthropic(res, route.fallback, base, system || '', messages, 2048); usage.model = route.fallback; }
    } else {
      usage = await streamAnthropic(res, route.model, base, system || '', messages, maxTok);
      usage.model = route.model;
    }
    const { inTok, outTok } = usage;
    const d0 = await readUsageData(user.email);
    await writeUsageRow(user.email, { ...d0, month: u.month, used: u.used + inTok + outTok });
    res.write(`\n[[USAGE]]${inTok},${outTok},${usage.model}`); // lets the client show per-document cost
    res.end();
  } catch (e) {
    res.write('\n[[ERROR]] ' + (e?.message || 'server error'));
    res.end();
  }
}
