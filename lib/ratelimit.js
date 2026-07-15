// ── Rate limiter ────────────────────────────────────────────────────────────
// Distributed when Vercel KV / Upstash Redis is connected (env KV_REST_API_URL +
// KV_REST_API_TOKEN), so all serverless instances share one counter. Falls back to a
// per-instance in-memory window when KV isn't configured — works today, upgrades to
// distributed the moment you create a KV store and connect it (no code change).
// Fixed window, fail-open on any KV error (never lock out real users if Redis blips).

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
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
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
