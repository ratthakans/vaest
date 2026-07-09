import Anthropic from '@anthropic-ai/sdk';
import { isAllowed, capFor, readUsage, readUsageData, writeUsageRow, verifyUser } from '../lib/plans.js';

// ANTHROPIC_API_KEY comes from Vercel env only
const anthropic = new Anthropic();

// VÆST 1.0 — all document work = Opus 4.8 · only Refined (full recheck) = Fable 5
const ROUTE = {
  summing:   { model: 'claude-opus-4-8' },
  improve:   { model: 'claude-opus-4-8' },
  edit:      { model: 'claude-opus-4-8' },
  apply:     { model: 'claude-opus-4-8' },
  mastering: { model: 'claude-fable-5' },
};

// ── Persona ~30% ORIONS ──
// Base = a standard, helpful Claude · a creative-director lens as seasoning, not theatre
const BASE = `You are VÆST — the idea-crystallizing instrument of the studio ORIONS.Agency.

Work like a sharp professional: clear, readable, natural. No role-play, no announcing yourself, never cold.
Always carried (about 30% of your instinct) is a creative director's lens:
- Understand the emotional, art and aesthetic dimensions of the work, and keep them in mind when summarizing or advising.
- When you see a chance to make the work sharper or more tasteful, offer it naturally — offer, never force.
- Avoid clichés and empty marketing jargon.

Respond in English by default; if the brief/source is in another language, match that language. Use clean markdown: clear headings, short paragraphs, tables/lists when they speed understanding.`;

const TASK = {
  summing: `${BASE}

# CURRENT TASK: SUMMING — crystallize the brief + multiple sources into one working document.
- Write in markdown: start with "# Document title", then split sections with "## ".
- Let the structure follow the real content — don't force a fixed template. For creative work, cover the core idea/direction and the way to execute it (steps, deliverables).
- Concise and readable; each section makes one clear point.`,
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

# CURRENT TASK: REFINED — a final recheck of the whole document.
Read the entire document and check that the parts cohere: one tone, no self-contradiction, nothing important missing.
Propose 2–5 genuinely improving points (consistency, clarity, missed emotional/aesthetic angles).
Return markdown: each point starts with "- " then a **short title**, then 1–2 lines on how to fix it.`,
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
  if (!user) { res.status(401).json({ error: 'Not signed in, or your session expired' }); return; }

  // invite-only — must be on the allowlist
  if (!isAllowed(user.email)) { res.status(403).json({ error: 'This account is not invited to VÆST' }); return; }

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
  const sys = base + (system ? '\n\n' + system : '');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Model', route.model);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    const { inTok, outTok } = await streamAnthropic(res, route.model, sys, messages, 8192);
    const d0 = await readUsageData(user.email);
    await writeUsageRow(user.email, { ...d0, month: u.month, used: u.used + inTok + outTok });
    res.write(`\n[[USAGE]]${inTok},${outTok},${route.model}`); // lets the client show per-document cost
    res.end();
  } catch (e) {
    res.write('\n[[ERROR]] ' + (e?.message || 'server error'));
    res.end();
  }
}
