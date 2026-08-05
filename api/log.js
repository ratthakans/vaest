import { createHash } from 'node:crypto';
import { verifyUser, readRow, writeRow } from '../lib/plans.js';
import { rateLimit } from '../lib/ratelimit.js';

// Lightweight error sink — clients POST runtime errors; kept capped per day so it
// never grows unbounded. Read in Supabase: rows with email like 'errlog:%'.

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  // Auth required — no anonymous writes to the sink (prevents unauthenticated spam).
  const user = await verifyUser(req);
  if (!user) { res.status(204).end(); return; }
  const who = user.email;
  // distributed per-user limit (KV) so the sink can't be spammed across instances
  if (await rateLimit('log:' + who, 20, 60)) { res.status(204).end(); return; }
  let body = {};
  try { body = req.body || {}; } catch (e) {}
  // A pseudonym, not the address. Storing the email here meant erasing an account required
  // finding and rewriting every day's log — 30 days of hourly shards is 720 reads on a request
  // that is supposed to be someone leaving, and a sweep that covers only part of the window is
  // worse than honest. The cheapest way to satisfy the right to erasure is not to collect the
  // thing: support can still find a user's errors by hashing an address they already know.
  const entry = {
    ts: Date.now(),
    who: createHash('sha256').update(who).digest('hex').slice(0, 16),
    msg: String(body.msg || '').slice(0, 400),
    where: String(body.where || '').slice(0, 120),
    ua: String((req.headers['user-agent'] || '')).slice(0, 160),
  };
  // One row per DAY meant every client error anywhere read and rewrote the same growing object —
  // at 200 entries that is roughly 140KB moved per report, and concurrent writers simply lost each
  // other's entries. Sharding by hour keeps each row small, cuts contention twenty-four ways, and
  // costs nothing to read back: the rows are still `errlog:%`.
  const now = new Date().toISOString();
  const key = 'errlog:' + now.slice(0, 10) + ':' + now.slice(11, 13);
  // fire-and-forget client: answer 204 first, then persist before the handler returns so the
  // read/write never delays the response (service-role key — errlog rows are server-only under RLS)
  res.status(204).end();
  try {
    const prev = (await readRow(key)) || {};
    const list = (prev.list || []).slice(-199);
    list.push(entry);
    await writeRow(key, { list });
  } catch (e) {}
}
