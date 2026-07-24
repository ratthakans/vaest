import { runApiEngine } from '../../lib/apiengine.js';

// POST /api/v1/present   Authorization: Bearer vsk_live_...
// Body: { document: string }  →  { slides, usage }
// Present (Norrsken) — the apex mind reshapes the document into a tight deck; a deck is
// judgment (what to cut), and nothing downstream audits it, so the critic/writer law holds.
// `slides` is a parsed array of slide objects (cover / content / quote / close); on the
// rare parse miss, `raw` holds the model text so the caller can recover.
export default async function handler(req, res) {
  const out = await runApiEngine(req, res, {
    taskKey: 'present',
    model: 'claude-fable-5',
    fallback: 'claude-opus-5',
    maxTokens: 8192,
    buildContent: (b) => (b.document || '').trim() || null,
  });
  if (!out) return;
  let slides = null;
  try { slides = JSON.parse(out.text.replace(/^```json\s*|\s*```$/g, '').trim()); }
  catch (e) { const m = out.text.match(/\[[\s\S]*\]/); if (m) { try { slides = JSON.parse(m[0]); } catch (e2) {} } }
  if (Array.isArray(slides)) res.status(200).json({ slides, usage: out.usage });
  else res.status(200).json({ slides: null, raw: out.text, usage: out.usage });
}
