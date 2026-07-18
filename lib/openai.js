// ── OpenAI (Mimir · Ø Think) ─────────────────────────────────────────────────
// One place for the endpoint, key and request shape — the app chat streams, the public API
// buffers, but both send the same body. Raw fetch on purpose: no SDK import lands on a cold
// start (same reasoning as the Gemini path in api/chat.js).
//
// Every function here THROWS on any failure — missing key, HTTP error, empty completion — so
// callers fall back to Odin. That's what keeps Ø Think working unchanged until OPENAI_API_KEY
// is set, and keeps an OpenAI outage from ever hard-failing the feature.

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function buildBody(model, system, messages, maxTokens, stream) {
  // GPT-5.x (Sol/Terra/Luna) are reasoning models: the Chat Completions API rejects the old
  // `max_tokens` (use `max_completion_tokens`) and only accepts the default temperature, so we
  // send neither `max_tokens` nor `temperature` — passing either returns HTTP 400.
  const b = {
    model,
    messages: [{ role: 'system', content: system }].concat(messages),
    max_completion_tokens: maxTokens,
  };
  if (stream) { b.stream = true; b.stream_options = { include_usage: true }; } // usage rides the final chunk
  return b;
}

async function post(payload) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no-openai-key');
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000), // don't let a hung upstream pin the function
  });
  // carry OpenAI's own error text into the thrown message so the fallback log says *why*, not just 400
  if (!r.ok) {
    let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch (e) {}
    throw new Error('openai-http-' + r.status + (detail ? ' ' + detail : ''));
  }
  if (!r.body) throw new Error('openai-nobody');
  return r;
}

// the chat client's messages carry either a string or text/image blocks — OpenAI's chat
// endpoint wants plain strings here, and Ø Think is text-only, so flatten and drop the rest
export function flattenMessages(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('\n'),
  }));
}

// Streamed (app chat) — writes text to res as it arrives, returns token usage.
export async function streamOpenAI(res, model, base, dynamic, messages, maxTokens) {
  const sys = base + (dynamic ? '\n\n' + dynamic : '');
  const r = await post(buildBody(model, sys, flattenMessages(messages), maxTokens, true));
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', inTok = 0, outTok = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const js = line.slice(5).trim();
      if (!js || js === '[DONE]') continue;
      try {
        const d = JSON.parse(js);
        const t = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (t) { out += t; res.__wrote = true; res.write(t); }
        // the usage chunk carries an empty choices array, so it never collides with text
        if (d.usage) { inTok = d.usage.prompt_tokens || inTok; outTok = d.usage.completion_tokens || outTok; }
      } catch (e) {}
    }
  }
  if (!out) throw new Error('openai-empty');
  // reasoning tokens are billed as output and are already inside completion_tokens
  if (!inTok) inTok = Math.ceil(JSON.stringify(messages).length / 4);
  if (!outTok) outTok = Math.ceil(out.length / 4);
  return { inTok, outTok, model };
}

// Buffered (public API /v1/*) — request/response, no streaming.
export async function callOpenAI(model, system, content, maxTokens) {
  const r = await post(buildBody(model, system, [{ role: 'user', content }], maxTokens, false));
  const d = await r.json();
  const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  if (!text) throw new Error('openai-empty');
  return { text, inTok: (d.usage && d.usage.prompt_tokens) || 0, outTok: (d.usage && d.usage.completion_tokens) || 0 };
}
