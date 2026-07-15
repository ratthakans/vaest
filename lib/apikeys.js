import crypto from 'node:crypto';
import { SB, svcHeaders } from './plans.js';

// ── API keys (public API auth) ─────────────────────────────────────────────
// Same storage pattern as the rest of the app: rows in vaest_state keyed by a
// prefixed string, service-role key only (no RLS policy — same as sub:/usage:).
//   apikey:<sha256(key)>  → { email, name, createdAt, revokedAt }   (O(1) auth lookup)
//   apikeys:<email>       → { keys: [{ id, hash, prefix, name, createdAt, revokedAt }] }
// The plaintext key is shown to the owner exactly once, at creation. Only its SHA-256
// hash is ever stored — same principle as a password, so a DB read can't leak live keys.

const KEY_PREFIX = 'vsk_live_';

function hash(key) { return crypto.createHash('sha256').update(key).digest('hex'); }
function newKey() { return KEY_PREFIX + crypto.randomBytes(24).toString('base64url'); }
function shortId() { return crypto.randomBytes(8).toString('hex'); }

async function readRow(key) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}&select=data`, { headers: svcHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows[0] && rows[0].data) || null;
  } catch (e) { return null; }
}
async function writeRow(key, data) {
  try {
    const r = await fetch(`${SB.url}/rest/v1/vaest_state`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email: key, data, updated_at: new Date().toISOString() }),
    });
    return r.ok;
  } catch (e) { return false; }
}
async function deleteRow(key) {
  try { await fetch(`${SB.url}/rest/v1/vaest_state?email=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: svcHeaders }); }
  catch (e) {}
}

// Issue a new key for an account. Returns the plaintext key ONCE — caller must show it
// to the user immediately and never persist the plaintext anywhere.
export async function createApiKey(email, name) {
  const e = (email || '').toLowerCase();
  const plaintext = newKey();
  const h = hash(plaintext);
  const id = shortId();
  const meta = { email: e, name: (name || 'API key').slice(0, 60), createdAt: Date.now(), revokedAt: null };
  await writeRow('apikey:' + h, meta);

  const idx = (await readRow('apikeys:' + e)) || { keys: [] };
  idx.keys.push({ id, hash: h, prefix: plaintext.slice(0, KEY_PREFIX.length + 6), name: meta.name, createdAt: meta.createdAt, revokedAt: null });
  await writeRow('apikeys:' + e, idx);

  return { id, key: plaintext, name: meta.name, createdAt: meta.createdAt };
}

// List an account's keys — metadata only, never the plaintext or the raw hash.
export async function listApiKeys(email) {
  const idx = await readRow('apikeys:' + (email || '').toLowerCase());
  return (idx && idx.keys || []).map(k => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, revokedAt: k.revokedAt }));
}

// Revoke a key by its short id (owner-scoped — caller must confirm the account first).
export async function revokeApiKey(email, id) {
  const e = (email || '').toLowerCase();
  const idx = await readRow('apikeys:' + e);
  if (!idx) return false;
  const k = (idx.keys || []).find(x => x.id === id);
  if (!k) return false;
  k.revokedAt = Date.now();
  await writeRow('apikeys:' + e, idx);
  const meta = await readRow('apikey:' + k.hash);
  if (meta) { meta.revokedAt = k.revokedAt; await writeRow('apikey:' + k.hash, meta); }
  return true;
}

// Verify a request's `Authorization: Bearer vsk_live_...` header. Returns
// { email, keyId } on a valid, non-revoked key, else null. Server-only (service key).
export async function verifyApiKey(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  const meta = await readRow('apikey:' + hash(token));
  if (!meta || meta.revokedAt) return null;
  return { email: meta.email, keyId: meta.name };
}
