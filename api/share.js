import { SB, svcHeaders, verifyUser } from '../lib/plans.js';

// ── Server-side share broker ──────────────────────────────────────────────
// Share rows (email 'share:<id>') hold what an owner chose to publish. They used
// to be read/written directly with the public key, which let anyone (a) enumerate
// every share via ?email=like.share:* and (b) overwrite a shared canvas via the
// anon UPDATE grant. This endpoint moves all share access behind the service key:
//   GET    ?id=…                      → { title, canvas, comments }   (public; owner email withheld)
//   POST   ?id=…  { comment:{…} }     → append one comment            (public; append-only, never touches canvas)
//   POST   { action:'create', id?, title, canvas }  → create/update  (owner auth; stamps by=email)
//   POST   { action:'resolve', id, cid }            → remove a comment (owner auth)
//   DELETE ?id=…                       → revoke the link              (owner auth)
// RLS then drops the anon share policies entirely, so this is the only path in.

const ID_RE = /^sh[a-z0-9]{4,40}$/i;
const MAX_CANVAS = 400_000;   // chars — a generous cap on a single shared document
const MAX_COMMENTS = 80;

// per-instance rate limit so a known share id can't be comment-spammed
const HITS = new Map();
function rateLimited(key, perMin) {
  const min = Math.floor(Date.now() / 60000);
  const h = HITS.get(key);
  if (!h || h.min !== min) { HITS.set(key, { n: 1, min }); return false; }
  h.n++;
  return h.n > perMin;
}

const rowKey = id => 'share:' + id;

async function readShare(id) {
  const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(rowKey(id))}&select=data`, { headers: svcHeaders });
  if (!r.ok) return null;
  const rows = await r.json();
  return (rows[0] && rows[0].data) || null;
}
async function writeShare(id, data) {
  const r = await fetch(`${SB.url}/rest/v1/vaest_state`, {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ email: rowKey(id), data, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();

  // ── GET: public read of a share (owner email intentionally withheld) ──
  if (req.method === 'GET') {
    if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
    const data = await readShare(id);
    if (!data) { res.status(404).json({ error: 'not found' }); return; }
    res.status(200).json({ title: data.title || '', canvas: data.canvas || '', comments: Array.isArray(data.comments) ? data.comments : [] });
    return;
  }

  if (req.method === 'DELETE') {
    const user = await verifyUser(req);
    if (!user) { res.status(401).json({ error: 'auth required' }); return; }
    if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
    const data = await readShare(id);
    if (!data) { res.status(204).end(); return; }
    if ((data.by || '').toLowerCase() !== user.email) { res.status(403).json({ error: 'not your share' }); return; }
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(rowKey(id))}`, { method: 'DELETE', headers: svcHeaders });
    res.status(r.ok ? 204 : 500).end();
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'GET/POST/DELETE only' }); return; }

  const body = req.body || {};
  const action = body.action || (body.comment ? 'comment' : '');

  // ── owner: create / update a share ──
  if (action === 'create') {
    const user = await verifyUser(req);
    if (!user) { res.status(401).json({ error: 'auth required' }); return; }
    const sid = ID_RE.test(id) ? id : '';
    if (!sid) { res.status(400).json({ error: 'bad id' }); return; }
    const canvas = clip(body.canvas, MAX_CANVAS);
    if (!canvas.trim()) { res.status(400).json({ error: 'empty document' }); return; }
    // preserve existing comments; only the owner of an existing row may overwrite it
    const existing = await readShare(sid);
    if (existing && (existing.by || '').toLowerCase() !== user.email) { res.status(403).json({ error: 'not your share' }); return; }
    const data = {
      title: clip(body.title, 300),
      canvas,
      by: user.email,
      comments: (existing && Array.isArray(existing.comments)) ? existing.comments : [],
    };
    const ok = await writeShare(sid, data);
    res.status(ok ? 200 : 500).json(ok ? { id: sid } : { error: 'write failed' });
    return;
  }

  // ── owner: resolve (remove) a comment ──
  if (action === 'resolve') {
    const user = await verifyUser(req);
    if (!user) { res.status(401).json({ error: 'auth required' }); return; }
    if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
    const data = await readShare(id);
    if (!data) { res.status(404).json({ error: 'not found' }); return; }
    if ((data.by || '').toLowerCase() !== user.email) { res.status(403).json({ error: 'not your share' }); return; }
    const cid = String(body.cid || '');
    data.comments = (Array.isArray(data.comments) ? data.comments : []).filter(c => c.id !== cid);
    const ok = await writeShare(id, data);
    res.status(ok ? 200 : 500).json({ comments: data.comments });
    return;
  }

  // ── public: append one comment (append-only — never rewrites the canvas) ──
  if (action === 'comment') {
    if (!ID_RE.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
    if (rateLimited('c:' + id, 12)) { res.status(429).json({ error: 'slow down' }); return; }
    const c = body.comment || {};
    const text = clip(c.text, 1200).trim();
    if (!text) { res.status(400).json({ error: 'empty comment' }); return; }
    const data = await readShare(id);
    if (!data) { res.status(404).json({ error: 'not found' }); return; }
    data.comments = Array.isArray(data.comments) ? data.comments : [];
    data.comments.push({
      id: 'c' + Math.random().toString(36).slice(2, 10),
      h: clip(c.h, 200),
      name: clip(c.name, 40),
      text,
      ts: Date.now(),
    });
    if (data.comments.length > MAX_COMMENTS) data.comments = data.comments.slice(-MAX_COMMENTS);
    const ok = await writeShare(id, data);
    res.status(ok ? 200 : 500).json({ comments: data.comments });
    return;
  }

  res.status(400).json({ error: 'unknown action' });
}
