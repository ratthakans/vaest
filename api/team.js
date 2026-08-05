import { verifyUser } from '../lib/plans.js';
import { readSub, subIsActive, resolveAccess } from '../lib/billing.js';
import { readRoster, addMember, removeMember, seatsLeft } from '../lib/team.js';
import { rateLimit } from '../lib/ratelimit.js';

// Team roster — the thing that makes a per-seat price mean something.
//
//   GET                    → { owner, seats, used, left, members }   owner or member
//   POST   { email }       → add a member                            owner only
//   DELETE ?email=         → remove one                              owner only
//
// Only the account holding the Stripe subscription may edit. A member can see who else is on the
// team — they share a usage pool, so who is spending it is not a secret from them — but cannot add
// anyone, because adding is spending.

const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;

export default async function handler(req, res) {
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'sign in first' }); return; }

  const sub = await readSub(user.email);
  const isOwner = subIsActive(sub);
  const seats = Math.max(1, parseInt(sub && sub.quantity, 10) || 1);

  // A member reads the roster of the team they are on; the owner reads their own.
  const access = await resolveAccess(user.email);
  const owner = isOwner ? user.email : (access.source === 'team' ? access.owner : null);
  if (!owner) { res.status(402).json({ error: 'No team on this account — a Team plan gives you seats to fill.' }); return; }

  if (req.method === 'GET') {
    const roster = await readRoster(owner);
    const q = isOwner ? seats : (access.seats || 1);
    res.status(200).json({ owner, seats: q, used: roster.members.length + 1, left: seatsLeft(q, roster),
                           members: roster.members, canManage: isOwner });
    return;
  }

  // Editing is the owner's alone. A member adding members would be a member spending the owner's
  // money — the seats come out of a subscription only one of them is paying for.
  if (!isOwner) { res.status(403).json({ error: 'Only the account that owns the plan can change the team.' }); return; }
  if (await rateLimit('team:' + user.email, 20, 60)) { res.status(429).json({ error: 'Too many changes at once — give it a moment.' }); return; }

  if (req.method === 'POST') {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) { res.status(400).json({ error: 'Enter a valid email address' }); return; }
    const r = await addMember(user.email, email, seats);
    if (!r.ok) { res.status(409).json({ error: r.error }); return; }
    // No mail is sent and none is needed: they sign up (or sign in) with this address and the
    // plan is simply there. Nothing to accept, nothing to expire, no invite link to leak.
    res.status(200).json({ members: r.roster.members, left: seatsLeft(seats, r.roster) });
    return;
  }

  if (req.method === 'DELETE') {
    const email = String((req.query && req.query.email) || '').trim().toLowerCase();
    if (!email) { res.status(400).json({ error: 'email required' }); return; }
    const r = await removeMember(user.email, email);
    res.status(200).json({ members: r.roster.members, left: seatsLeft(seats, r.roster) });
    return;
  }

  res.status(405).json({ error: 'GET/POST/DELETE only' });
}
