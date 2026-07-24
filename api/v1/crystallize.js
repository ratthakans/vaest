import { runApiEngine } from '../../lib/apiengine.js';

// POST /api/v1/crystallize   Authorization: Bearer vsk_live_...
// Body: { brief: string, context?: string }  →  { document, usage }
// A messy brief (+ optional extra source) becomes one sharp, sectioned document.
// Counts against your plan's monthly document allowance.
export default async function handler(req, res) {
  const out = await runApiEngine(req, res, {
    taskKey: 'summing',
    model: 'claude-opus-5',
    maxTokens: 8192,
    countsDoc: true,
    buildContent: (b) => {
      const brief = (b.brief || '').trim();
      if (!brief) return null;
      return b.context ? `${brief}\n\n---\nAdditional context:\n${b.context}` : brief;
    },
  });
  if (out) res.status(200).json({ document: out.text, usage: out.usage });
}
