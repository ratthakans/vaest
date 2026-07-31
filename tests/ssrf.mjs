// SSRF guard tests for api/extract.js.
//
// /api/extract fetches a URL the user supplies, so it is an SSRF target by construction.
// The first version shipped with a guard that a security review defeated end-to-end: it
// validated only the ORIGINAL hostname and then followed redirects, and its private-range
// list let ::ffff:127.0.0.1 and most real ULAs through. Every bypass that was demonstrated
// is pinned here so it cannot come back.
import assert from 'node:assert/strict';
import http from 'node:http';
import { isBlockedAddr, isBlockedTarget } from '../api/extract.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }
async function ta(name, fn) { try { await fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }

console.log('\napi/extract.js — SSRF address guard\n');

// Addresses that must never be connected to. Each one was either demonstrated as a working
// bypass or is a standard SSRF target.
const BLOCKED = {
  'loopback v4': '127.0.0.1',
  'loopback v6': '::1',
  'unspecified v6': '::',
  'all-zeros v4': '0.0.0.0',
  'cloud metadata': '169.254.169.254',
  'link-local v4': '169.254.1.1',
  'private 10/8': '10.0.0.5',
  'private 172.16/12 low': '172.16.0.1',
  'private 172.16/12 high': '172.31.255.255',
  'private 192.168/16': '192.168.1.1',
  'IPv4-mapped loopback': '::ffff:127.0.0.1',           // bypassed the old regex list
  'IPv4-mapped metadata': '::ffff:169.254.169.254',     // bypassed the old regex list
  'IPv4-mapped hex form': '::ffff:7f00:1',              // bypassed the old regex list
  'link-local v6': 'fe80::1',
  'ULA (Tailscale-style)': 'fd7a:115c:a1e0::1',         // /^fd00:/ missed this — most real ULAs
  'ULA random': 'fdab:1234::1',
  'ULA fc00': 'fc00::1',
  'CGNAT low': '100.64.1.1',
  'CGNAT high': '100.127.0.1',
  'IETF protocol assignments': '192.0.0.1',
  'benchmarking': '198.18.0.1',
  'multicast': '224.0.0.1',
  'reserved 240/4': '240.0.0.1',
  'unparseable → refuse': 'not-an-ip',
};
for (const [name, ip] of Object.entries(BLOCKED))
  t('blocks ' + name + ' (' + ip + ')', () => assert.equal(isBlockedAddr(ip), true));

// Public addresses must still work — a guard that blocks everything is not a guard.
const ALLOWED = {
  'example.com': '93.184.216.34',
  'cloudflare dns': '1.1.1.1',
  'google dns': '8.8.8.8',
  'public v6': '2606:2800:220:1:248:1893:25c8:1946',
  'just above 172.16/12': '172.32.0.1',
  'just below 172.16/12': '172.15.0.1',
  'just below CGNAT': '100.63.0.1',
  'just above CGNAT': '100.128.0.1',
  'just below benchmarking': '198.20.0.1',
  'top of public v4': '223.255.255.255',
};
for (const [name, ip] of Object.entries(ALLOWED))
  t('allows ' + name + ' (' + ip + ')', () => assert.equal(isBlockedAddr(ip), false));

// ── The classifier being right is not the same as the classifier being REACHED ──
//
// Every test above calls isBlockedAddr directly. All of them passed while the endpoint was fully
// exploitable, because Node's net.connect short-circuits on isIP(host) and never consults
// options.lookup — so guardedLookup, the defence the file's header calls #1, was never invoked for
// a URL written as a literal address. A unit test on a pure function cannot see that. These run
// the target through the code path a request actually takes.

console.log('\napi/extract.js — the guard is REACHED, not just correct\n');

for (const raw of ['http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data/',
                   'http://10.0.0.5/', 'http://[::1]:9000/', 'http://192.168.1.1/',
                   'https://[::ffff:127.0.0.1]/', 'http://localhost:3000/'])
  t('refuses ' + raw, () => assert.equal(isBlockedTarget(new URL(raw)), true));

for (const raw of ['https://example.com/', 'https://1.1.1.1/', 'http://vaest.orions.agency/'])
  t('still allows ' + raw, () => assert.equal(isBlockedTarget(new URL(raw)), false));

// Why the pre-flight has to exist at all. Pin the platform behaviour that made the original guard
// unreachable: give http.request a lookup that refuses EVERYTHING and point it at a literal
// address — it connects anyway, because net.connect returns on isIP(host) before reading
// options.lookup. If Node ever changes this, the test says so rather than the guard quietly
// becoming redundant. (This is the exact experiment that found the live bug.)
await ta('Node skips options.lookup for a literal address — so a pre-flight check is required', async () => {
  const srv = http.createServer((_q, r) => { r.writeHead(200); r.end('reached') });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  let lookupCalled = false;
  try {
    const reached = await new Promise(resolve => {
      const rq = http.request(new URL(`http://127.0.0.1:${port}/`), {
        timeout: 4000,
        lookup: (_h, _o, cb) => { lookupCalled = true; cb(new Error('blocked-address')) },
      }, res => { res.resume(); res.on('end', () => resolve(true)) });
      rq.on('error', () => resolve(false));
      rq.end();
    });
    assert.equal(lookupCalled, false, 'lookup ran — the platform changed, re-read the guard');
    assert.equal(reached, true, 'connect was refused — the platform changed, re-read the guard');
  } finally { srv.close() }
});

// And that the handler actually CALLS it, on the first request and on every redirect hop. The
// previous guard was correct and simply never invoked; a unit test on a pure function cannot tell
// the difference, so this reads the source the way tests/audit.mjs does.
const SRC = await import('node:fs').then(fs => fs.readFileSync(new URL('../api/extract.js', import.meta.url), 'utf8'));
t('the request loop pre-flights every hop through isBlockedTarget', () => {
  const loop = SRC.slice(SRC.indexOf('for (;;)'), SRC.indexOf('if (out.status'));
  assert.ok(loop.includes('isBlockedTarget(u)'), 'the redirect loop no longer pre-flights the target');
  assert.ok(/hop > MAX_HOPS/.test(loop), 'redirects are no longer bounded');
});
t('isBlockedTarget classifies literal addresses rather than only names', () => {
  assert.ok(/net\.isIP\(/.test(SRC), 'the IP-literal branch is gone — names-only means the bypass is back');
});

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
