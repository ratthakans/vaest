import { SERVICE_KEY, sbFetch, readRow, deleteRow, verifyUser } from '../lib/plans.js';
import { resolveAccess } from '../lib/billing.js';
import { rateLimit } from '../lib/ratelimit.js';

// DELETE /api/account — the user erases their own account.
//
// PDPA gives people the right to have their data deleted, and until now the only route was an
// email to the studio: legal, but it means a person has to ask a human for permission to leave,
// and wait. Settings already exported everything; this is the other half of that pair.
//
// Two rules hold the whole design together:
//   1. The identity comes ONLY from the verified token. Nothing in the request body names an
//      account — there is no parameter an attacker could point at someone else.
//   2. An active subscription blocks it. Deleting the account would leave Stripe billing a card
//      with nothing attached and no way back in, so we refuse and send them to the portal to
//      cancel first. Their choice, in their own words, before anything is destroyed.
export default async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'POST') { res.status(405).json({ error: 'DELETE only' }); return; }

  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'Sign in again' }); return; }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (await rateLimit('del:' + ip, 5, 3600)) { res.status(429).json({ error: 'Too many attempts — try again later' }); return; }

  // typing the address back is the confirmation: a mis-click cannot reach this
  const typed = String((req.body && req.body.confirm) || '').trim().toLowerCase();
  if (typed !== user.email) {
    res.status(400).json({ error: 'Type your email address exactly to confirm' });
    return;
  }

  try {
    const access = await resolveAccess(user.email);
    if (access.allowed && access.source === 'stripe') {
      res.status(409).json({
        error: 'Cancel your subscription first — otherwise the card keeps being charged after the account is gone. Settings ▸ Usage ▸ Change plan.',
        subscription: true,
      });
      return;
    }

    // Revoke what is public BEFORE the account goes: a share link outlives its owner otherwise,
    // and a live API key would keep spending against a row that no longer exists.
    const st = (await readRow(user.email)) || {};
    const shareIds = [];
    try {
      for (const s of (st.sessions || [])) if (s && s.shareId) shareIds.push(String(s.shareId));
    } catch (e) {}
    for (const id of shareIds.slice(0, 200)) await deleteRow('share:' + id);

    const idx = (await readRow('apikeys:' + user.email)) || { keys: [] };
    for (const k of (idx.keys || []).slice(0, 200)) if (k && k.hash) await deleteRow('apikey:' + k.hash);
    await deleteRow('apikeys:' + user.email);

    await deleteRow(user.email);          // the workspace
    await deleteRow('usage:' + user.email); // meter + spend history

    // last, because it is the one step that cannot be walked back
    const r = await sbFetch(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) {
      console.error('account delete: auth user remained', user.email, r.status);
      res.status(500).json({ error: 'Your data was removed but the login could not be deleted — email rakan@orions.agency and we will finish it.' });
      return;
    }
    res.status(200).json({ deleted: true });
  } catch (e) {
    console.error('account delete failed:', e?.message || e);
    res.status(500).json({ error: 'Couldn’t complete the deletion — nothing was half-removed that we can see. Try again, or email rakan@orions.agency.' });
  }
}
