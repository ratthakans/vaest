import { streamOpenAI, callOpenAI, flattenMessages } from '../lib/openai.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; } };

const sse = (lines) => new Response(new ReadableStream({
  start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); }
}), { status: 200 });

const mkRes = () => { const o = { out: '', write(t) { this.out += t }, __wrote: false }; return o };
let captured = null;
const mockFetch = (resp) => async (url, opts) => { captured = { url, opts, body: JSON.parse(opts.body) }; return resp; };

console.log('\nlib/openai.js\n');

// ── the fallback trigger: no key must throw, never hang or return empty ──
await t('streamOpenAI throws no-openai-key when key unset → caller falls back to Odin', async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => streamOpenAI(mkRes(), 'gpt-5.6-sol', 'base', '', [{ role: 'user', content: 'hi' }], 100),
    /no-openai-key/);
});
await t('callOpenAI throws no-openai-key when key unset', async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => callOpenAI('gpt-5.6-sol', 'sys', 'hi', 100), /no-openai-key/);
});

process.env.OPENAI_API_KEY = 'sk-test';

// ── SSE parsing ──
await t('streamOpenAI streams text deltas to res and reads usage from the trailing chunk', async () => {
  global.fetch = mockFetch(sse([
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22}}\n\n',
    'data: [DONE]\n\n',
  ]));
  const res = mkRes();
  const u = await streamOpenAI(res, 'gpt-5.6-sol', 'base', '', [{ role: 'user', content: 'hi' }], 100);
  assert.equal(res.out, 'Hello world');
  assert.equal(res.__wrote, true, '__wrote must be set — the handler uses it to avoid double text on fallback');
  assert.deepEqual({ i: u.inTok, o: u.outTok, m: u.model }, { i: 11, o: 22, m: 'gpt-5.6-sol' });
});

await t('streamOpenAI survives SSE chunks split mid-line', async () => {
  global.fetch = mockFetch(sse(['data: {"choices":[{"delta":{"con', 'tent":"ab"}}]}\n', 'data: [DONE]\n']));
  const res = mkRes();
  await streamOpenAI(res, 'gpt-5.6-sol', 'b', '', [{ role: 'user', content: 'x' }], 100);
  assert.equal(res.out, 'ab');
});

await t('streamOpenAI throws openai-empty on a stream with no text → falls back', async () => {
  global.fetch = mockFetch(sse(['data: [DONE]\n\n']));
  await assert.rejects(() => streamOpenAI(mkRes(), 'gpt-5.6-sol', 'b', '', [{ role: 'user', content: 'x' }], 100), /openai-empty/);
});

await t('streamOpenAI throws openai-http-<code> on a non-200', async () => {
  global.fetch = mockFetch(new Response('nope', { status: 429 }));
  await assert.rejects(() => streamOpenAI(mkRes(), 'gpt-5.6-sol', 'b', '', [{ role: 'user', content: 'x' }], 100), /openai-http-429/);
});

// ── request shape ──
await t('stream request sets stream+include_usage and a system-first message list', async () => {
  global.fetch = mockFetch(sse(['data: {"choices":[{"delta":{"content":"x"}}]}\n', 'data: [DONE]\n']));
  await streamOpenAI(mkRes(), 'gpt-5.6-sol', 'BASE', 'TONE', [{ role: 'user', content: 'hi' }], 4096);
  const b = captured.body;
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.opts.headers.Authorization, 'Bearer sk-test');
  assert.equal(b.model, 'gpt-5.6-sol');
  assert.equal(b.stream, true);
  assert.deepEqual(b.stream_options, { include_usage: true });
  assert.equal(b.max_completion_tokens, 4096, 'GPT-5.x needs max_completion_tokens, not max_tokens');
  assert.equal(b.max_tokens, undefined, 'max_tokens must not be sent — GPT-5.x rejects it (400)');
  assert.equal(b.temperature, undefined, 'temperature must not be sent — GPT-5.x reasoning models reject non-default');
  assert.equal(b.messages[0].role, 'system');
  assert.equal(b.messages[0].content, 'BASE\n\nTONE', 'dynamic tone must ride on the system prompt');
  assert.deepEqual(b.messages[1], { role: 'user', content: 'hi' });
});

await t('buffered request omits stream flags', async () => {
  global.fetch = mockFetch(new Response(JSON.stringify({
    choices: [{ message: { content: 'out' } }], usage: { prompt_tokens: 5, completion_tokens: 6 },
  }), { status: 200 }));
  const r = await callOpenAI('gpt-5.6-sol', 'SYS', 'doc', 4096);
  assert.deepEqual(r, { text: 'out', inTok: 5, outTok: 6 });
  assert.equal(captured.body.stream, undefined);
  assert.equal(captured.body.stream_options, undefined);
  assert.deepEqual(captured.body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'doc' }]);
});

// ── message flattening (chat client sends text/image blocks) ──
await t('flattenMessages collapses text blocks and maps roles', () => {
  assert.deepEqual(
    flattenMessages([
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      { role: 'assistant', content: 'c' },
      { role: 'system', content: 'd' },
    ]),
    [{ role: 'user', content: 'a\nb' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }]);
});

console.log(`\n${pass} passed · ${fail} failed\n`);
process.exit(fail ? 1 : 0);
