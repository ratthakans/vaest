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
  const entry = {
    ts: Date.now(),
    email: who,
    msg: String(body.msg || '').slice(0, 400),
    where: String(body.where || '').slice(0, 120),
    ua: String((req.headers['user-agent'] || '')).slice(0, 160),
  };
  const key = 'errlog:' + new Date().toISOString().slice(0, 10);
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
