import { runApiEngine } from '../../lib/apiengine.js';

// POST /api/v1/think   Authorization: Bearer vsk_live_...
// Body: { document: string }  →  { pushes, usage }
// Ø Think — a senior creative-director provocation pass: 3–6 pushes to make the work
// braver, each tied to an exact quote from the document. `pushes` is markdown bullets.
export default async function handler(req, res) {
  const out = await runApiEngine(req, res, {
    taskKey: 'think',
    openai: 'gpt-5.6-sol',
    fallback: 'claude-opus-4-8',
    maxTokens: 4096,
    buildContent: (b) => (b.document || '').trim() || null,
  });
  if (out) res.status(200).json({ pushes: out.text, usage: out.usage });
}
