import { SB, sbFetch, isInternal, INVITED, PLAN_MAP } from '../lib/plans.js';
import { rateLimit } from '../lib/ratelimit.js';

// basic shape check — also rejects a ':' so an email can never collide with the vaest_state
// keyspace prefixes (usage:/sub:/share:/apikey:/errlog:) that key privileged rows
const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;

// Server-side sign-up. This used to create PRE-CONFIRMED users, on the reasoning that "payment
// is the real gate, so proving the address doesn't matter" — true when nothing was free, and
// false the moment a free tier existed. Unconfirmed accounts now cost real money and can be
// minted from any string that looks like an email, including someone else's, which also locks
// the real owner out of ever registering it.
//
// So the account is created UNCONFIRMED and no session is returned. Supabase's own /signup
// sends the confirmation mail (requires "Confirm email" ON in Auth settings — with it off this
// still works, users simply arrive already confirmed). api/chat.js independently refuses to
// spend on an unverified account, so neither layer is load-bearing alone.
//
// Google sign-in skips all of this: the provider has already proved the address.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const { email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!e || !password || String(password).length < 6) {
    res.status(400).json({ error: 'Enter an email and a password of at least 6 characters' });
    return;
  }
  if (!EMAIL_RE.test(e) || e.length > 254) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }
  // Rate-limit FIRST, before the entitlement gate below — otherwise the distinct 403 for an
  // entitled address turns this into an unauthenticated oracle for probing who is internal or
  // on the invite list.
  const origin = req.headers.origin || 'https://vaest.orions.agency';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (await rateLimit('signup:' + ip, 8, 60)) { res.status(429).json({ error: 'Too many sign-ups — wait a moment and try again' }); return; }

  // Entitlement in this system is keyed on the email STRING alone: isInternal() grants
  // unlimited spend to anything @orions.agency, and INVITED/PLAN_MAP comp a full plan. This
  // endpoint creates users pre-confirmed (email_confirm: true skips the ownership round-trip),
  // so without this gate anyone could POST x@orions.agency and mint themselves an unlimited
  // account. Entitled addresses are provisioned by the studio, never self-served.
  if (isInternal(e) || INVITED.has(e) || Object.prototype.hasOwnProperty.call(PLAN_MAP, e)) {
    res.status(403).json({ error: 'This address is provisioned by the studio — ask us to set it up, or sign in if it already exists.' });
    return;
  }

  try {
    // Supabase's own sign-up: creates the user unconfirmed and sends the confirmation mail,
    // rather than the admin API which creates users silently and mails nothing.
    const cr = await sbFetch(`/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: SB.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password, options: { email_redirect_to: `${origin}/` } }),
    });
    if (!cr.ok) {
      const d = await cr.json().catch(() => ({}));
      const msg = (d.msg || d.error_description || d.error || '').toLowerCase();
      if (cr.status === 422 || cr.status === 409 || msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        res.status(409).json({ error: 'An account with this email already exists — sign in instead' });
        return;
      }
      // Supabase reports one "Error sending confirmation email" for two very different causes:
      // our mail server is down, or the address the user typed cannot receive mail (a typo, a
      // dead domain — the provider refuses it outright). Blaming our own infrastructure was
      // wrong the first time I wrote this: the address is the likelier cause by far, and a user
      // who mistyped their domain would have been told the product was broken and left to wait
      // for a fix that was never coming. Name both, put theirs first, and offer the door that
      // needs no mail at all.
      if (msg.includes('sending') || msg.includes('smtp') || msg.includes('email')) {
        console.error('signup mail rejected for', e, '—', d.msg || d.error_description || msg);
        res.status(503).json({
          error: 'We couldn’t send the confirmation email. Check the address for a typo — or use “Continue with Google”, which needs no email at all.',
          mail: true,
        });
        return;
      }
      res.status(400).json({ error: d.msg || d.error_description || 'Sign-up failed' });
      return;
    }
    // With "Confirm email" ON, Supabase returns the user and NO session — that is the intended
    // path, and the client shows "check your inbox". With it OFF a session comes back and we
    // pass it through, so the setting can be flipped either way without a code change.
    const d = await cr.json().catch(() => ({}));
    if (d.access_token) { res.status(200).json(d); return; }
    res.status(200).json({ verify: true, email: e });
  } catch (err) {
    console.error('signup error:', err?.message || err);
    res.status(500).json({ error: 'Sign-up failed, try again' });
  }
}
