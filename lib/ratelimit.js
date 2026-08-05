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

const MAX_KEYS = 2000;
const _mem = new Map();
const _seen = new Map();          // key → when it was last touched, to break ties on eviction
function memLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (_mem.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { _mem.set(key, arr); _seen.set(key, now); return true; }
  arr.push(now); _mem.set(key, arr); _seen.set(key, now);
  // The map used to be emptied wholesale once it passed 2000 keys — so anyone able to produce 2000
  // distinct keys (2000 IPs, or simply enough ordinary traffic) reset every counter in the
  // process, including their own. The cleanup was the bypass.
  //
  // Evict by age instead: entries whose window has already closed carry no information, and if
  // that is not enough, drop the least recently touched. A counter is never cleared while it is
  // still capable of stopping something.
  if (_mem.size > MAX_KEYS) {
    // Expired first: a closed window carries no information.
    for (const [k, t] of _seen) if (now - t > windowMs) { _mem.delete(k); _seen.delete(k); }
    // Then the ones with the FEWEST hits — never the least recently touched. Evicting by age was
    // the first attempt and it failed the same test the wholesale clear did: a key at its limit is
    // being refused, so it stops being touched, so it becomes the oldest and gets dropped. The
    // attacker's fresh keys survive and the counter that was doing its job does not. Hit count is
    // the property that actually matters — a key at its ceiling is the last thing to discard.
    if (_mem.size > MAX_KEYS) {
      const byHits = [...(_mem)].sort((a, b) => a[1].length - b[1].length || (_seen.get(a[0]) || 0) - (_seen.get(b[0]) || 0));
      for (const [k] of byHits.slice(0, _mem.size - MAX_KEYS)) { _mem.delete(k); _seen.delete(k); }
    }
  }
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
