import { capFor, readUsage, readUsageData, writeUsageRow, checkDocQuota, applyDocBump } from './plans.js';
import { resolveAccess } from './billing.js';
import { verifyApiKey } from './apikeys.js';
import { rateLimit } from './ratelimit.js';
import { callOpenAI } from './openai.js';
import { getAnthropic, TASK } from '../api/chat.js';

// Shared runner for every public API engine endpoint (/api/v1/*). Handles API-key auth,
// plan gating, usage metering, the model call, and error shaping — one source of truth so
// the endpoints are thin and can never drift on auth/billing. Returns { text, usage } on
// success, or null after already sending an error response (caller just returns).
//
// opts: { taskKey, model | openai, fallback?, maxTokens, buildContent(body)→string|null, countsDoc? }
// Pass `openai` instead of `model` to run the endpoint on OpenAI, with `fallback` naming the
// Anthropic model to use if OpenAI is unreachable (or its key isn't set).

async function callAnthropic(model, system, content, maxTokens) {
  const anthropic = await getAnthropic();
  const resp = await anthropic.messages.create({
    model, max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  });
  return {
    text: (resp.content || []).map(b => b.text || '').join(''),
    inTok: resp.usage?.input_tokens || 0,
    outTok: resp.usage?.output_tokens || 0,
  };
}

export async function runApiEngine(req, res, opts) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return null; }

  const auth = await verifyApiKey(req);
  if (!auth) { res.status(401).json({ error: 'Missing or invalid API key — pass Authorization: Bearer vsk_live_...' }); return null; }

  const content = opts.buildContent(req.body || {});
  if (!content) { res.status(400).json({ error: 'required input is missing or empty' }); return null; }

  if (await rateLimit('api:' + auth.email, 12, 60)) { res.status(429).json({ error: 'Too fast — max 12 requests/min, try again shortly' }); return null; }

  const [access, u] = await Promise.all([resolveAccess(auth.email), readUsage(auth.email)]);
  if (!access.allowed) { res.status(402).json({ error: 'An active VÆST plan is required for API access' }); return null; }
  const cap = capFor(auth.email);
  if (u.used >= cap) { res.status(429).json({ error: 'Fair-use limit reached this month' }); return null; }

  const plan = access.plan;
  if (opts.countsDoc) {
    try { const q = await checkDocQuota(auth.email, plan); if (!q.ok) { res.status(429).json({ error: 'Monthly usage limit reached — add a credit pack or upgrade your plan' }); return null; } }
    catch (e) { console.error('api doc-cap check failed (allowing):', e?.message || e); }
  }

  try {
    const sys = TASK[opts.taskKey], maxTok = opts.maxTokens || 4096;
    let out;
    if (opts.openai) {
      try { out = await callOpenAI(opts.openai, sys, content, maxTok); }
      catch (oe) {
        if (!opts.fallback) throw oe;
        console.error('api ' + opts.taskKey + ' → openai failed, falling back:', oe?.message || oe);
        out = await callAnthropic(opts.fallback, sys, content, maxTok);
      }
    } else {
      out = await callAnthropic(opts.model, sys, content, maxTok);
    }
    const { text, inTok, outTok } = out;

    const d0 = await readUsageData(auth.email);
    let nextData = { ...d0, month: u.month, used: (d0.month === u.month ? (d0.used || 0) : 0) + inTok + outTok };
    if (opts.countsDoc) nextData = applyDocBump(nextData, plan.docs);
    await writeUsageRow(auth.email, nextData);

    return { text, usage: { input_tokens: inTok, output_tokens: outTok } };
  } catch (e) {
    console.error('api engine (' + opts.taskKey + ') error:', e?.message || e);
    res.status(500).json({ error: 'The engine hit a snag — try again in a moment' });
    return null;
  }
}
