import { capFor, readUsage, readUsageData, writeUsageRow, checkDocQuota, applyDocBump } from '../../lib/plans.js';
import { resolveAccess } from '../../lib/billing.js';
import { verifyApiKey } from '../../lib/apikeys.js';
import { getAnthropic, TASK } from '../chat.js';

// ── Public API v1 — Crystallize ─────────────────────────────────────────────
// POST /api/v1/crystallize   Authorization: Bearer vsk_live_...
// Body: { brief: string, context?: string }
// Returns: { document: string, usage: { input_tokens, output_tokens } }
//
// v1 scope, intentionally: no file uploads (text only), no streaming (buffered JSON),
// no engine choice (Crystallize/Summing only — Think/Refine/Present come later once this
// shape is proven). API access draws from the SAME monthly plan/credit allowance as the
// web app — there is no separate metered API pricing yet; a paid VÆST plan is the gate.
// Rate limiting below is in-memory per warm instance (same caveat as the app's chat
// endpoint) — fine for early access, needs a distributed limiter before wider GA.

const _hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const arr = (_hits.get(key) || []).filter(t => now - t < 60_000);
  if (arr.length >= 12) { _hits.set(key, arr); return true; }
  arr.push(now); _hits.set(key, arr);
  if (_hits.size > 500) _hits.clear();
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  const auth = await verifyApiKey(req);
  if (!auth) { res.status(401).json({ error: 'Missing or invalid API key — pass Authorization: Bearer vsk_live_...' }); return; }

  const { brief = '', context = '' } = req.body || {};
  if (!brief || !brief.trim()) { res.status(400).json({ error: 'brief is required' }); return; }
  if (rateLimited(auth.email)) { res.status(429).json({ error: 'Too fast — max 12 requests/min, try again shortly' }); return; }

  const [access, u] = await Promise.all([resolveAccess(auth.email), readUsage(auth.email)]);
  if (!access.allowed) { res.status(402).json({ error: 'An active VÆST plan is required for API access' }); return; }
  const cap = capFor(auth.email);
  if (u.used >= cap) { res.status(429).json({ error: 'Fair-use limit reached this month' }); return; }

  const plan = access.plan;
  try {
    const q = await checkDocQuota(auth.email, plan);
    if (!q.ok) { res.status(429).json({ error: 'Monthly usage limit reached — add a credit pack or upgrade your plan' }); return; }
  } catch (e) { console.error('api/v1 doc-cap check failed (allowing):', e?.message || e); }

  try {
    const anthropic = await getAnthropic();
    const userContent = context ? `${brief}\n\n---\nAdditional context:\n${context}` : brief;
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      system: [{ type: 'text', text: TASK.summing, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
    const document = (resp.content || []).map(b => b.text || '').join('');
    const inTok = resp.usage?.input_tokens || 0, outTok = resp.usage?.output_tokens || 0;

    const d0 = await readUsageData(auth.email);
    let nextData = { ...d0, month: u.month, used: (d0.month === u.month ? (d0.used || 0) : 0) + inTok + outTok };
    nextData = applyDocBump(nextData, plan.docs);
    await writeUsageRow(auth.email, nextData);

    res.status(200).json({ document, usage: { input_tokens: inTok, output_tokens: outTok } });
  } catch (e) {
    console.error('api/v1/crystallize error:', e?.message || e);
    res.status(500).json({ error: 'The engine hit a snag — try again in a moment' });
  }
}
