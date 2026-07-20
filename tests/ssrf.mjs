// SSRF guard tests for api/extract.js.
//
// /api/extract fetches a URL the user supplies, so it is an SSRF target by construction.
// The first version shipped with a guard that a security review defeated end-to-end: it
// validated only the ORIGINAL hostname and then followed redirects, and its private-range
// list let ::ffff:127.0.0.1 and most real ULAs through. Every bypass that was demonstrated
// is pinned here so it cannot come back.
import assert from 'node:assert/strict';
import { isBlockedAddr } from '../api/extract.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; } }

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

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
