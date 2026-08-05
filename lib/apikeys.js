import crypto from 'node:crypto';
import { readRow, writeRow } from './plans.js';

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

// Issue a new key for an account. Returns the plaintext key ONCE — caller must show it
// to the user immediately and never persist the plaintext anywhere.
export async function createApiKey(email, name) {
  const e = (email || '').toLowerCase();
  const plaintext = newKey();
  const h = hash(plaintext);
  const id = shortId();
  const meta = { email: e, name: (name || 'API key').slice(0, 60), createdAt: Date.now(), revokedAt: null };
  // The apikey:<hash> row is what auth looks up — if it fails to persist, the key we're about
  // to show (once) would never authenticate. Fail loud instead of handing out a dead key.
  if (!(await writeRow('apikey:' + h, meta))) throw new Error('key store failed');

  // The index is a read-modify-write, and it is the ONLY record of which hashes belong to this
  // account — auth reads apikey:<hash> directly and never consults it. So two keys created at the
  // same moment produced one that authenticates forever and appears in no list: a live credential
  // its owner cannot see and cannot revoke, which is worse than no key at all.
  //
  // Re-read and verify. If the entry did not survive, retry; if it still will not, destroy the
  // hash row so the plaintext about to be shown authenticates nothing. Failing to issue a key is
  // an inconvenience. Issuing an invisible one is a liability.
  const row = { id, hash: h, prefix: plaintext.slice(0, KEY_PREFIX.length + 6), name: meta.name, createdAt: meta.createdAt, revokedAt: null };
  let landed = false;
  for (let i = 0; i < 3 && !landed; i++) {
    const idx = (await readRow('apikeys:' + e)) || { keys: [] };
    if (!idx.keys.some(k => k.hash === h)) idx.keys.push(row);
    await writeRow('apikeys:' + e, idx);
    const after = await readRow('apikeys:' + e);
    landed = !!(after && (after.keys || []).some(k => k.hash === h));
  }
  if (!landed) {
    await writeRow('apikey:' + h, { ...meta, revokedAt: Date.now() });   // dead on arrival, deliberately
    throw new Error('key store failed');
  }

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
