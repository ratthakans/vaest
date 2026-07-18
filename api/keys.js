import { verifyUser } from '../lib/plans.js';
import { resolveAccess } from '../lib/billing.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../lib/apikeys.js';

// Manage API keys — session-authenticated (the web app's own login), not by API key
// itself (avoids a chicken-and-egg: you need to be signed in to mint your first key).
// API access is an entitlement of an active VÆST plan — same gate as the app itself.
//   GET    → list this account's keys (metadata only)
//   POST   { name? } → create a key, returns the plaintext ONCE
//   DELETE ?id=      → revoke a key
export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'sign in first' }); return; }

  const access = await resolveAccess(user.email);
  if (!access.allowed) { res.status(402).json({ error: 'An active plan is required for API access' }); return; }

  if (req.method === 'GET') {
    const keys = await listApiKeys(user.email);
    res.status(200).json({ keys });
    return;
  }

  if (req.method === 'POST') {
    const name = (req.body && req.body.name) || '';
    const existing = await listApiKeys(user.email);
    if (existing.filter(k => !k.revokedAt).length >= 5) { res.status(429).json({ error: 'Maximum 5 active keys — revoke one first' }); return; }
    try {
      const made = await createApiKey(user.email, name);
      res.status(201).json(made); // { id, key, name, createdAt } — key shown once
    } catch (e) {
      console.error('createApiKey failed:', e?.message || e);
      res.status(500).json({ error: 'Couldn’t create the key just now — please try again' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || '';
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    const ok = await revokeApiKey(user.email, id);
    res.status(ok ? 200 : 404).json({ revoked: ok });
    return;
  }

  res.status(405).json({ error: 'GET/POST/DELETE only' });
}
