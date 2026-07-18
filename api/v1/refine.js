import { runApiEngine } from '../../lib/apiengine.js';

// POST /api/v1/refine   Authorization: Bearer vsk_live_...
// Body: { document: string }  →  { notes, usage }
// Refined (Norrsken) — a holistic audit for inconsistency, redundancy and broken logic.
// 2–5 fix-it notes, each tied to an exact quote. `notes` is markdown bullets.
export default async function handler(req, res) {
  const out = await runApiEngine(req, res, {
    taskKey: 'mastering',
    model: 'claude-fable-5',
    maxTokens: 4096,
    countsRefine: true,
    buildContent: (b) => (b.document || '').trim() || null,
  });
  if (out) res.status(200).json({ notes: out.text, usage: out.usage });
}
