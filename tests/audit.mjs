// Structural audit — the gate CLAUDE.md law #6 prescribes.
//
// The original lived in a session scratchpad and was deleted with it, so every "AUDIT CLEAN"
// in the git history came from a tool that no longer exists and the documented workflow could
// not actually be run. This is the committed replacement, and it does more than the original:
// besides checking the app's wiring, it enforces the two laws that were previously guarded by
// nothing but attention — no model id in the client, no pure white as text.
//
//   node tests/audit.mjs      (wired into `npm test`)
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ✓ ' + name); pass++; } catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; } };
const fmt = a => a.slice(0, 8).join(', ') + (a.length > 8 ? ` … (+${a.length - 8} more)` : '');

console.log('\nStructural audit — app wiring\n');

// Every element id the script reaches for must exist, or that feature is silently dead.
// ids exist either in the markup or in the HTML the script builds at runtime (renderDoc,
// the ref panel, the Refine box) — both are real
const ids = new Set([
  ...[...HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]),
  ...[...APP.matchAll(/id=\\?"([a-zA-Z][\w-]*)\\?"/g)].map(m => m[1]),
]);
t('every $(\'id\') in app.js resolves in index.html', () => {
  const used = new Set([...APP.matchAll(/\$\('([a-zA-Z][\w-]*)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(i => !ids.has(i));
  if (missing.length) throw new Error(`${missing.length} unresolved: ${fmt(missing)}`);
});

t('no duplicate element ids in index.html', () => {
  const all = [...HTML.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const dupes = [...new Set(all.filter((x, i) => all.indexOf(x) !== i))];
  if (dupes.length) throw new Error(`duplicated: ${fmt(dupes)}`);
});

// Inline handlers are resolved off the global scope at click time — a typo fails silently
// until a user clicks it.
t('every inline handler in index.html is a defined function', () => {
  const fns = new Set([...APP.matchAll(/function\s+([a-zA-Z][\w$]*)/g)].map(m => m[1]));
  const called = new Set([...HTML.matchAll(/\bon\w+="\s*([a-zA-Z][\w$]*)\s*\(/g)].map(m => m[1]));
  const known = new Set(['event', 'this', 'if', 'return', 'for', 'while', 'typeof']);
  const missing = [...called].filter(f => !fns.has(f) && !known.has(f));
  if (missing.length) throw new Error(`${missing.length} undefined: ${fmt(missing)}`);
});

console.log('\nLaw #1 — the engines are the product: no model or provider id in the client\n');

// The client bundle ships to every visitor. A model id in a DOM id, a storage key or any
// user-visible string maps a codename to a vendor for anyone who opens devtools.
const VENDOR = /(opus|sonnet|haiku|fable|gpt-?[0-9]|gemini|anthropic|openai|claude-)/i;
const VENDOR_WORD = /\b(opus|sonnet|haiku|fable|gpt-?[0-9]|gemini|anthropic|openai|claude-)\b/i;

t('no model id in an element id or name attribute', () => {
  const attrs = [...HTML.matchAll(/(?:id|name)="([^"]+)"/g)].map(m => m[1]).filter(v => VENDOR.test(v));
  if (attrs.length) throw new Error(`shipped in the DOM: ${fmt(attrs)}`);
});

t('no model id in a user-visible string in index.html', () => {
  const text = HTML.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  const hits = text.split(/\s+/).filter(w => VENDOR_WORD.test(w));
  if (hits.length) throw new Error(`visible text: ${fmt([...new Set(hits)])}`);
});

t('no model id in a persisted state key in app.js', () => {
  // token buckets and rate keys are written to localStorage and synced to the cloud
  const hits = [...APP.matchAll(/\b(?:tok|rt|rates?)\s*\.\s*(\w+)/g)].map(m => m[1]).filter(k => VENDOR.test(k));
  if (hits.length) throw new Error(`persisted key names: ${fmt([...new Set(hits)])}`);
});

console.log('\nLaw #4 — serif is the writing voice, and never pure white\n');

t('no pure white on a reading surface', () => {
  // Scoped to where VÆST WRITES — that is what the law is about (halation in prose, badly in
  // Thai). White on a cinnabar badge or a button hover is chrome and stays.
  const PROSE = /(\.sec-c|\.q-body|\.gen-body|\.id-m|\.tx\b|\.doc\b|\.prose|\.mi-t)/;
  const hits = [];
  CSS.split(/[\n}]/).forEach((rule, i) => {
    if (!PROSE.test(rule)) return;
    if (/[^-\w]color\s*:\s*(#fff\b|#ffffff\b|white\b)/i.test(rule)) hits.push(rule.trim().slice(0, 60));
  });
  if (hits.length) throw new Error(`${hits.length} prose rules use pure white: ${fmt(hits)}`);
});

console.log('\nVersion — one source, so it cannot go stale again\n');

// Both of these started out too narrow and certified a lie. The first only matched a version
// sitting next to the word VÆST, so `<span class="ab-ver">3.1</span>` walked past it. The second
// only counted consts literally named VERSION, so a second source called VAEST_VER walked past
// too — and that one stamped the footer of every exported document a client receives. A test
// that names the one shape you already thought of is a test that agrees with you.
t('no version literal anywhere in the markup', () => {
  const hits = [
    ...(HTML.match(/V[ÆAE]ST\s*v?\d+\.\d+/gi) || []),   // "VÆST 3.1"
    ...(HTML.match(/>\s*v?\d+\.\d+\s*</gi) || []),       // ">3.1<" as an element's whole text
  ];
  if (hits.length) throw new Error(`hardcoded in markup: ${fmt([...new Set(hits)])} — set VERSION in js/app.js and paint it`);
});

t('app.js holds exactly one version constant, whatever it is called', () => {
  // matches any const whose NAME mentions a version and whose VALUE looks like one
  const hits = [...APP.matchAll(/\bconst\s+(\w*VER\w*)\s*=\s*['"]\d+\.\d+/gi)].map(m => m[1]);
  if (hits.length !== 1) throw new Error(`${hits.length} version constants: ${fmt(hits)} — expected exactly 1`);
  if (hits[0] !== 'VERSION') throw new Error(`the one source should be called VERSION, found ${hits[0]}`);
});

console.log('\n' + pass + ' passed · ' + fail + ' failed');
console.log(fail ? '\nAUDIT FAILED\n' : '\nAUDIT CLEAN\n');
process.exit(fail ? 1 : 0);
