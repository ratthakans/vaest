// ── Rate limiter ────────────────────────────────────────────────────────────
// Distributed when an Upstash-compatible Redis is connected, so all serverless
// instances share one counter. Reads whichever env-var pair the integration injected:
// Vercel's own KV/Redis uses KV_REST_API_URL/TOKEN; the Upstash Marketplace integration
// uses UPSTASH_REDIS_REST_URL/TOKEN. Both expose the same REST /pipeline endpoint, so we
// accept either. Falls back to a per-instance in-memory window when neither is set —
// works today, upgrades to distributed the moment a store is connected (no code change).
// Fixed window, fail-open on any KV error (never lock out real users if Redis blips).
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// true once a distributed store is wired — surfaced to internal accounts so "is KV live?"
// is answerable without guessing (rate limits fail silently to in-memory otherwise).
export function kvConfigured() { return !!(KV_URL && KV_TOKEN); }

const _mem = new Map();
function memLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (_mem.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { _mem.set(key, arr); return true; }
  arr.push(now); _mem.set(key, arr);
  if (_mem.size > 2000) _mem.clear();
  return false;
}

export async function rateLimit(key, max = 12, windowSec = 60) {
  const url = KV_URL, token = KV_TOKEN;
  if (!url || !token) return memLimited(key, max, windowSec * 1000); // no KV → per-instance fallback
  try {
    const win = Math.floor(Date.now() / 1000 / windowSec);
    const k = `rl:${key}:${win}`;
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['EXPIRE', k, windowSec + 10]]),
    });
    if (!r.ok) return false; // KV error → fail-open
    const out = await r.json();
    const count = out && out[0] && out[0].result;
    return typeof count === 'number' && count > max;
  } catch (e) { return false; } // fail-open
}
