import { verifyUser, SB, svcHeaders } from '../lib/plans.js';

// Lightweight error sink — clients POST runtime errors; kept capped per day so it
// never grows unbounded. Read in Supabase: rows with email like 'errlog:%'.

// Per-instance, per-email rate limit so a single client can't spam the sink.
const HITS = new Map(); // email -> { n, min }
function rateLimited(email) {
  const min = Math.floor(Date.now() / 60000);
  const h = HITS.get(email);
  if (!h || h.min !== min) { HITS.set(email, { n: 1, min }); return false; }
  h.n++;
  return h.n > 20; // max 20 logs / minute / user on this instance
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  // Auth required — no anonymous writes to the sink (prevents unauthenticated spam).
  const user = await verifyUser(req);
  if (!user) { res.status(204).end(); return; }
  const who = user.email;
  if (rateLimited(who)) { res.status(204).end(); return; }
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
  // service-role key: errlog rows are server-only under RLS (no anon policy)
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}&select=data`, { headers: svcHeaders });
    const rows = r.ok ? await r.json() : [];
    const list = (rows[0]?.data?.list || []).slice(-199);
    list.push(entry);
    await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: key, data: { list }, updated_at: new Date().toISOString() }),
    });
  } catch (e) {}
  res.status(204).end();
}
