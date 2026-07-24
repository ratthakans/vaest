import { runApiEngine } from '../../lib/apiengine.js';

// POST /api/v1/think   Authorization: Bearer vsk_live_...
// Body: { document: string }  →  { pushes, usage }
// Ø Think — Galdr's provocation pass: 3–6 pushes to make the work braver, each tied to an exact
// quote from the document. Runs on Sonnet — a different mind from Odin (Opus), who wrote the doc,
// so the second opinion is genuinely independent. `pushes` is markdown bullets.
export default async function handler(req, res) {
  const out = await runApiEngine(req, res, {
    taskKey: 'think',
    model: 'claude-sonnet-5',
    fallback: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    buildContent: (b) => (b.document || '').trim() || null,
  });
  if (out) res.status(200).json({ pushes: out.text, usage: out.usage });
}
