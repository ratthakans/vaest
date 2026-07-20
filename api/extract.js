import { verifyUser } from '../lib/plans.js';
import { rateLimit } from '../lib/ratelimit.js';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { URL } from 'node:url';

// Read a public web page server-side and return its stripped text, so the brand-voice flow can
// distill a voice from a link the user pastes (the browser can't fetch cross-origin).
//
// This endpoint takes a URL from a user and fetches it, so it is an SSRF target by construction.
// The defences, in order of what they stop:
//   1. every socket validates the IP it is ABOUT to connect to (guardedLookup) — this is what
//      closes DNS rebinding and IPv4-mapped-IPv6 (::ffff:127.0.0.1), which a pre-flight
//      hostname check cannot, because the check and the connect resolve separately.
//   2. redirects are followed manually, re-validating every hop — 'follow' would otherwise let
//      a public host bounce us to 169.254.169.254 with no second check.
//   3. the body is streamed with a hard byte cap, and one timer bounds the WHOLE exchange
//      including the body — a timer cleared when headers arrive bounds nothing.
//   4. failures are reported generically, so this can't be used as an internal port scanner.

const MAX_BYTES = 2_000_000;   // hard stop; we only ever keep 18K of text anyway
const TOTAL_MS = 12_000;       // covers connect + headers + body
const MAX_HOPS = 3;

// ── address classification ────────────────────────────────────────────────
// Range checks are numeric, not prefix-string matches: fc00::/7 covers fd7a:… and fdab:…,
// which /^fd00:/ would have waved through.
function normalizeIp(ip) {
  const s = String(ip || '').split('%')[0];
  const m = /^::ffff:(.+)$/i.exec(s);
  if (m) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1])) return m[1];        // ::ffff:127.0.0.1
    const hm = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);   // ::ffff:7f00:1
    if (hm) {
      const a = parseInt(hm[1], 16), b = parseInt(hm[2], 16);
      return [(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join('.');
    }
  }
  return s;
}
function isBlockedV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable → refuse
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;              // this-network, private, loopback
  if (a === 169 && b === 254) return true;                        // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;               // 172.16.0.0/12
  if (a === 192 && (b === 168 || b === 0)) return true;           // private + IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true;           // benchmarking
  if (a >= 224) return true;                                      // multicast 224/4 + reserved 240/4
  return false;
}
function isBlockedV6(ip) {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;                     // unspecified, loopback
  if (/^fe[89ab]/.test(s)) return true;                           // fe80::/10 link-local
  const first = parseInt(s.split(':')[0] || '0', 16);
  if (((first & 0xfe00) >>> 0) === 0xfc00) return true;           // fc00::/7 unique-local (all of it)
  return false;
}
export function isBlockedAddr(ip) {
  const n = normalizeIp(ip);
  return n.includes(':') ? isBlockedV6(n) : isBlockedV4(n);
}

function hostLooksInternal(host) {
  const h = String(host || '').toLowerCase();
  return !h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost');
}

// Validate the address the socket is about to use. Node calls this instead of dns.lookup.
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, verbatim: true }, (err, address, family) => {
    if (err) return cb(err);
    if (Array.isArray(address)) {
      if (!address.length || address.some(a => isBlockedAddr(a.address))) return cb(new Error('blocked-address'));
    } else if (isBlockedAddr(address)) {
      return cb(new Error('blocked-address'));
    }
    cb(null, address, family);
  });
}

// One hop. Resolves { redirect } or { status, ctype, body }. Never follows on its own.
function getOnce(target, deadlineMs) {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(target, {
      method: 'GET',
      lookup: guardedLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VaestBot/1.0; +https://vaest.orions.agency)',
        'Accept': 'text/html,text/plain,*/*',
        'Accept-Encoding': 'identity',
      },
      timeout: deadlineMs,
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.destroy();
        return resolve({ redirect: res.headers.location });
      }
      const ctype = String(res.headers['content-type'] || '').toLowerCase();
      const len = Number(res.headers['content-length'] || 0);
      if (len && len > MAX_BYTES) { res.destroy(); return reject(new Error('too-big')); }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n > MAX_BYTES) { res.destroy(); return; }   // stop pulling; keep what we have
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, ctype, body: Buffer.concat(chunks) }));
      res.on('close', () => resolve({ status, ctype, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Pull readable text out of raw HTML: drop scripts/styles/nav chrome, un-tag, collapse space.
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&[a-z]+;/gi, ' ');
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const user = await verifyUser(req);
  if (!user) { res.status(401).json({ error: 'Sign in to read a link' }); return; }
  if (await rateLimit('extract:' + user.email, 10, 60)) { res.status(429).json({ error: 'Too many links — give it a minute' }); return; }

  let body = {};
  try { body = req.body || {}; } catch (e) {}
  let raw = String(body.url || '').trim();
  if (!raw) { res.status(400).json({ error: 'No URL' }); return; }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let u;
  try { u = new URL(raw); } catch (e) { res.status(400).json({ error: 'That doesn’t look like a link' }); return; }

  const started = Date.now();
  try {
    let hop = 0, out = null;
    for (;;) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad-scheme');
      if (hostLooksInternal(u.hostname)) throw new Error('blocked-address');
      const left = TOTAL_MS - (Date.now() - started);
      if (left <= 0) throw new Error('timeout');
      const r = await getOnce(u, left);
      if (r.redirect) {
        if (++hop > MAX_HOPS) throw new Error('too-many-redirects');
        u = new URL(r.redirect, u);   // re-validated at the top of the loop AND at connect time
        continue;
      }
      out = r;
      break;
    }

    if (out.status >= 400 || !out.body.length) { res.status(502).json({ error: 'Couldn’t read that link' }); return; }
    if (!/text\/|html|json|xml/.test(out.ctype)) { res.status(415).json({ error: 'That link isn’t a readable page' }); return; }

    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(out.body);
    const text = (/html/.test(out.ctype) ? htmlToText(rawText) : rawText.trim()).slice(0, 18000);
    if (!text) { res.status(422).json({ error: 'Couldn’t read any text there' }); return; }
    const tm = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    // single line — a title with newlines could otherwise forge the "=== name ===" fence
    // the client wraps this material in
    const title = (tm ? htmlToText(tm[1]) : u.hostname).replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    res.status(200).json({ title: title || u.hostname, text });
  } catch (e) {
    // deliberately uniform: distinguishing blocked/refused/timeout would turn this into an
    // internal port scanner
    res.status(502).json({ error: 'Couldn’t read that link' });
  }
}
