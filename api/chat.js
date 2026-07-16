import { capFor, readUsage, readUsageData, writeUsageRow, verifyUser, checkDocQuota, applyDocBump, checkRefineQuota, applyRefineBump } from '../lib/plans.js';
import { resolveAccess } from '../lib/billing.js';
import { rateLimit } from '../lib/ratelimit.js';
import { streamOpenAI } from '../lib/openai.js';

// Lazy-load the Anthropic SDK — the Idea chat (Galdr = Gemini) never needs it, so a cold
// start on that hot path doesn't pay to import/parse the SDK. ANTHROPIC_API_KEY from env.
let _anthropic = null;
// exported so api/v1/*.js (the public API surface) can reuse the same client/prompts
// instead of re-declaring them — one source of truth for the engine text.
export async function getAnthropic() {
  if (!_anthropic) { const mod = await import('@anthropic-ai/sdk'); const Anthropic = mod.default || mod; _anthropic = new Anthropic(); }
  return _anthropic;
}

// VÆST 1.4 — Galdr (Idea/sandbox) = Gemini Flash · Odin (write) = Opus 4.8 · Mimir (Ø Think) = GPT-5.6 Sol
// · Norrsken (Refine) = Fable 5 · Skadi (Present) = Sonnet 5
//
// Critic vs writer: Mimir and Norrsken only ever *propose* (Think pushes / Refine points) — they never
// write into the canvas. Every mode that puts words in the document (summing, apply, improve, edit) stays
// on Odin, so one document keeps one voice. Mimir is deliberately a different model family from Odin:
// the point of Ø Think is a second opinion the author wouldn't have reached on its own.
const GEMINI_MODEL = 'gemini-flash-latest';
export const ROUTE = {
  idea:      { gemini: true, fallback: 'claude-haiku-4-5-20251001', max: 4096 },
  tag:       { gemini: true, fallback: 'claude-haiku-4-5-20251001', max: 16 },
  summing:   { model: 'claude-opus-4-8' },
  improve:   { model: 'claude-opus-4-8' },
  edit:      { model: 'claude-opus-4-8' },
  apply:     { model: 'claude-opus-4-8' },
  think:        { openai: 'gpt-5.6-sol', fallback: 'claude-opus-4-8' },
  sectionthink: { openai: 'gpt-5.6-sol', fallback: 'claude-opus-4-8', max: 2048 },
  mastering: { model: 'claude-fable-5', fallback: 'claude-opus-4-8' },
  present:   { model: 'claude-sonnet-5', max: 8192, fallback: 'claude-opus-4-8' },
};

// ── Persona ~30% ORIONS ──
// Base = a standard, helpful Claude · a creative-director lens as seasoning, not theatre
export const BASE = `You are VÆST — the idea-crystallizing instrument of the studio ORIONS.Agency.

Work like a sharp professional: clear, readable, natural. No role-play, no announcing yourself, never cold.
Always carried (about 30% of your instinct) is a creative director's lens:
- Understand the emotional, art and aesthetic dimensions of the work, and keep them in mind when summarizing or advising.
- When you see a chance to make the work sharper or more tasteful, offer it naturally — offer, never force.
- Avoid clichés and empty marketing jargon.

Mirror the user's language: Thai question → Thai answer, English question → English answer. When sources are mixed, follow the language the user themselves writes in — never switch to English just because the sources are English. Use clean markdown: clear headings, short paragraphs, tables/lists when they speed understanding.`;

export const TASK = {
  idea: `${BASE}

# CURRENT TASK: IDEA — the sandbox. You are a generous creative sparring partner.
- Riff freely and go long when the spark deserves it: open 3–6 angles, take the two strongest further, explain the thinking behind each so the user can build on it.
- Raw pasted material (other models' output, prompts, scraps) is welcome: react to it, keep the good part, kill the weak part, say why.
- End with one sharp question or a concrete next move when it helps.
- Markdown lists and short paragraphs; stay lively, never a wall of corporate prose.`,
  tag: `# TASK: TOPIC LABEL. Read the note and reply with ONLY a 1–3 word topic label naming what it's about (e.g. "Naming", "Visual direction", "Pricing", "Launch plan"). Match the note's language. No quotes, no punctuation, no explanation — just the label.`,
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
  sectionthink: `${BASE}

# CURRENT TASK: Ø THINK (SECTION) — a Senior Creative Director provocation pass over ONE section.
You get the document's title for context and one section's heading + body. Push only that section: the sharper cultural angle, the safe choice worth bending, the idea it stops one step short of.
Propose 2–3 pushes. Format each as: "- **short title** {{a short exact quote from the section this relates to}} — the push, 1–2 lines, concrete."
The {{quote}} must be 3–8 words copied verbatim from the section body. Never propose changes to other sections. Only bullets — no intro, no outro.`,
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

// Anthropic requires a user-first, strictly-alternating thread; the chat client can
// legitimately produce assistant-first windows (context slicing) or user,user pairs
// (a send that failed mid-stream). Normalize here so every client stays valid.
function normalizeRoles(messages) {
  const out = [];
  for (const m of messages) {
    if (!out.length && m.role !== 'user') continue;            // drop leading assistant turns
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {                        // merge same-role runs
      if (typeof prev.content === 'string' && typeof m.content === 'string') prev.content += '\n\n' + m.content;
      else {
        const blocks = c => typeof c === 'string' ? [{ type: 'text', text: c }] : c;
        prev.content = blocks(prev.content).concat(blocks(m.content));
      }
    } else out.push({ role: m.role, content: m.content });
  }
  return out.length ? out : [{ role: 'user', content: String(messages[messages.length - 1]?.content || '…') }];
}

async function streamAnthropic(res, model, base, dynamic, messages, maxTokens) {
  const params = { model, max_tokens: maxTokens, messages: normalizeRoles(messages) };
  // system as blocks: the static persona/task prefix is cache-marked (free hits within the 5-min window);
  // the dynamic part (tone / project voice) rides in a second block
  const system = [{ type: 'text', text: base, cache_control: { type: 'ephemeral' } }];
  if (dynamic) system.push({ type: 'text', text: dynamic });
  params.system = system;
  const anthropic = await getAnthropic();
  const stream = anthropic.messages.stream(params);
  let inTok = 0, outTok = 0;
  for await (const ev of stream) {
    if (ev.type === 'message_start' && ev.message?.usage) inTok = ev.message.usage.input_tokens || 0;
    if (ev.type === 'message_delta' && ev.usage) outTok = ev.usage.output_tokens || outTok;
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { res.__wrote = true; res.write(ev.delta.text); }
  }
  return { inTok, outTok };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // 1) auth
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'Not signed in, or your session expired' }); return; }

  // sync validation first — fail fast before any I/O
  const { mode = 'summing', messages = [], system = '' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: 'messages required' }); return; }
  // reject unknown modes — otherwise an unknown mode falls back to ROUTE.summing (Opus)
  // while skipping the document counter, and the Refine gate keys off literal mode strings.
  if (!Object.prototype.hasOwnProperty.call(ROUTE, mode)) { res.status(400).json({ error: 'unknown mode' }); return; }
  // burst guard — 12 calls/min/user (distributed when KV is connected, else per-instance)
  if (await rateLimit('chat:' + user.email, 12, 60)) { res.status(429).json({ error: 'Too fast — give it a few seconds and try again' }); return; }

  // the two independent reads run in parallel — shaves a Supabase round-trip off time-to-first-token
  const [access, u] = await Promise.all([resolveAccess(user.email), readUsage(user.email)]);
  // access = active paid subscription, comp/invite, or internal. Otherwise → paywall.
  if (!access.allowed) { res.status(402).json({ error: 'Choose a plan to start using VÆST', paywall: true }); return; }
  // monthly fair-use token cap (invisible — guards against runaway cost · ORIONS team unlimited)
  const cap = capFor(user.email);
  if (u.used >= cap) {
    res.status(429).json({ error: `Fair-use limit reached this month (${Math.round(u.used/1000)}K tokens) — ping the ORIONS team` });
    return;
  }

  // ── per-plan limits ── engine gating + document caps.
  // 429 is used for all of these so the client shows a toast (403 triggers the "not invited" screen).
  const plan = access.plan;
  // Refine (mode "mastering") = the priciest engine (Fable). Allowed if the plan includes it
  // OR the user has purchased credit refines (works even on Basic). One check handles both;
  // consumes plan allowance first, then credit. Check before streaming, bump on success.
  // Fail-open on error so a counter glitch never blocks a paid user's Refine.
  const countsRefine = mode === 'mastering';
  if (countsRefine) {
    try {
      const q = await checkRefineQuota(user.email, plan);
      if (!q.ok) {
        const msg = q.planHasRefine
          ? 'This month’s Refine allowance is used up — it refreshes on the 1st. Add a usage credit pack in Settings, or upgrade.'
          : 'Refine unlocks on Pro — or add a usage credit pack in Settings to use it now.';
        res.status(429).json({ error: msg });
        return;
      }
    } catch (e) { console.error('refine-cap check failed (allowing):', e?.message || e); }
  }
  // a "document" = one Summing. Check the plan allowance (then credit) BEFORE streaming,
  // but only bump the counter after the document actually succeeds (see the success path),
  // so a failed/aborted Summing never burns usage.
  // Fail-open: any counter error allows the request, so a bug never blocks Summing.
  const countsDoc = mode === 'summing';
  if (countsDoc) {
    try {
      const q = await checkDocQuota(user.email, plan);
      if (!q.ok) {
        res.status(429).json({ error: 'You’ve reached this month’s usage limit — it refreshes on the 1st. Add a usage credit pack in Settings, or upgrade for more.' });
        return;
      }
    } catch (e) { console.error('doc-cap check failed (allowing):', e?.message || e); }
  }

  const route = ROUTE[mode] || ROUTE.summing;
  const base = TASK[mode] || TASK.summing;
  const maxTok = route.max || 8192;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  // engine names only — provider/model ids never reach the client
  const ENGINE = { idea: 'GALDR', tag: 'GALDR', mastering: 'NORRSKEN', present: 'SKADI', think: 'MIMIR', sectionthink: 'MIMIR' };
  res.setHeader('X-Engine', ENGINE[mode] || 'ODIN');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    let usage;
    if (route.gemini) {
      // Idea sandbox → Gemini Flash, but never let a Gemini hiccup break the flow: fall back to Haiku
      try { usage = await streamGemini(res, base, system || '', messages, maxTok); }
      catch (ge) { usage = await streamAnthropic(res, route.fallback, base, system || '', messages, 2048); usage.model = route.fallback; }
    } else if (route.openai) {
      // Ø Think → Mimir. Any OpenAI problem (no key, outage, rate limit) falls back to Odin so the
      // feature never hard-fails — but only if nothing streamed yet, so we never double up text.
      try {
        usage = await streamOpenAI(res, route.openai, base, system || '', messages, maxTok);
      } catch (oe) {
        if (res.__wrote || !route.fallback) throw oe;
        console.error('mimir failed, falling back to odin:', oe?.message || oe);
        usage = await streamAnthropic(res, route.fallback, base, system || '', messages, maxTok);
        usage.model = route.fallback;
      }
    } else {
      // Specialty models (NORRSKEN·Fable, Present·Sonnet) fall back to Opus if the model
      // is ever unavailable — but only if nothing has streamed yet, so we never double up text.
      try {
        usage = await streamAnthropic(res, route.model, base, system || '', messages, maxTok);
        usage.model = route.model;
      } catch (me) {
        if (res.__wrote || !route.fallback) throw me;
        usage = await streamAnthropic(res, route.fallback, base, system || '', messages, maxTok);
        usage.model = route.fallback;
      }
    }
    const { inTok, outTok } = usage;
    // single read-modify-write: record token usage and, only now that the document
    // succeeded, bump the document counter — merged so the two don't clobber each other.
    const d0 = await readUsageData(user.email);
    let nextData = { ...d0, month: u.month, used: (d0.month === u.month ? (d0.used || 0) : 0) + inTok + outTok };
    if (countsDoc) nextData = applyDocBump(nextData, plan.docs);
    if (countsRefine) nextData = applyRefineBump(nextData, plan.refineMonth);
    await writeUsageRow(user.email, nextData);
    // cost bucket only (galdr/mimir/norrsken/odin) — never the underlying model id.
    // Keyed off the model that actually ran, so a Mimir→Odin fallback is billed as Odin.
    const mid = String(usage.model || route.model || '');
    const bucket = /fable/.test(mid) ? 'norrsken' : /^gpt/.test(mid) ? 'mimir'
      : /gemini|haiku|sonnet/.test(mid) ? 'galdr' : 'odin';
    res.write(`\n[[USAGE]]${inTok},${outTok},${bucket}`); // lets the client show per-document cost
    res.end();
  } catch (e) {
    // sanitize — upstream errors can carry provider/model names; the client gets a neutral line
    console.error('chat error:', e?.message || e);
    res.write('\n[[ERROR]] The engine hit a snag — try again in a moment');
    res.end();
  }
}
