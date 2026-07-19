import { verifyUser } from '../lib/plans.js';
import { rateLimit } from '../lib/ratelimit.js';
import dns from 'node:dns/promises';

// Read a public web page server-side and return its stripped text, so the brand-voice
// flow can distill a voice from a link the user pastes (the browser can't fetch cross-origin).
// Signed-in only, rate-limited, and SSRF-guarded: only http/https, and the host must resolve
// to a public address (blocks localhost, private ranges, and the cloud metadata endpoint).

const PRIVATE = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,               // 172.16.0.0/12
  /^::1$/, /^fe80:/i, /^fc00:/i, /^fd00:/i,    // IPv6 loopback / link-local / ULA
];
function isPrivateAddr(ip) { return PRIVATE.some(re => re.test(ip)); }

async function hostIsPublic(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return false;
    return addrs.every(a => !isPrivateAddr(a.address));
  } catch (e) { return false; }
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
  if (await rateLimit('extract:' + user.email, 20, 60)) { res.status(429).json({ error: 'Too many links — give it a minute' }); return; }

  let body = {};
  try { body = req.body || {}; } catch (e) {}
  let raw = String(body.url || '').trim();
  if (!raw) { res.status(400).json({ error: 'No URL' }); return; }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let u;
  try { u = new URL(raw); } catch (e) { res.status(400).json({ error: 'That doesn’t look like a link' }); return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { res.status(400).json({ error: 'Only web links (http/https)' }); return; }
  if (!(await hostIsPublic(u.hostname))) { res.status(400).json({ error: 'That address can’t be reached' }); return; }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaestBot/1.0; +https://vaest.orions.agency)', 'Accept': 'text/html,text/plain,*/*' },
    }).finally(() => clearTimeout(t));
    if (!r.ok) { res.status(502).json({ error: 'The link returned ' + r.status }); return; }
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (!/text\/|html|json|xml/.test(ctype)) { res.status(415).json({ error: 'That link isn’t a readable page' }); return; }
    // cap the download so a huge page can't blow the function
    const buf = await r.arrayBuffer();
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 1_500_000));
    const text = (/html/.test(ctype) ? htmlToText(rawText) : rawText.trim()).slice(0, 18000);
    if (!text) { res.status(422).json({ error: 'Couldn’t read any text there' }); return; }
    const tm = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = tm ? htmlToText(tm[1]).slice(0, 120) : u.hostname;
    res.status(200).json({ title, text });
  } catch (e) {
    res.status(504).json({ error: e.name === 'AbortError' ? 'The link took too long' : 'Couldn’t reach that link' });
  }
}
