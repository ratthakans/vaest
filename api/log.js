import { verifyUser, SB } from '../lib/plans.js';

// Lightweight error sink — clients POST runtime errors; kept capped per day so it
// never grows unbounded. Read in Supabase: rows with email like 'errlog:%'.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const user = await verifyUser(req);
  const who = user ? user.email : 'anon';
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
  const hdr = { apikey: SB.key, Authorization: `Bearer ${SB.key}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}&select=data`, { headers: hdr });
    const rows = r.ok ? await r.json() : [];
    const list = (rows[0]?.data?.list || []).slice(-199);
    list.push(entry);
    await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...hdr, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: key, data: { list }, updated_at: new Date().toISOString() }),
    });
  } catch (e) {}
  res.status(204).end();
}
