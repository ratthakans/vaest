// Structural audit — the gate CLAUDE.md law #6 prescribes.
//
// The original lived in a session scratchpad and was deleted with it, so every "AUDIT CLEAN"
// in the git history came from a tool that no longer exists and the documented workflow could
// not actually be run. This is the committed replacement, and it does more than the original:
// besides checking the app's wiring, it enforces the two laws that were previously guarded by
// nothing but attention — no model id in the client, no pure white as text.
//
//   node tests/audit.mjs      (wired into `npm test`)
import { readFileSync, readdirSync } from 'node:fs';

const rd = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const APP = rd('../js/app.js');
const HTML = rd('../index.html');
const CSS = rd('../css/app.css');
// The audit read three files and called itself clean. `api/` and `home.html` were outside its
// sight entirely, which is how a model name shipped in a response trailer, a stale version number
// sat in the marketing footer, and a "4 Minds" headline contradicted "three engines" one screen
// below — all of them under a green AUDIT CLEAN. A gate that covers part of the surface reports on
// part of the surface; it does not report on the product.
const HOME = rd('../home.html');
const apiDir = new URL('../api/', import.meta.url);
const API = readdirSync(apiDir).filter(f => f.endsWith('.js'))
  .map(f => ({ f: 'api/' + f, src: readFileSync(new URL(f, apiDir), 'utf8') }));
const V1 = readdirSync(new URL('../api/v1/', import.meta.url)).filter(f => f.endsWith('.js'))
  .map(f => ({ f: 'api/v1/' + f, src: readFileSync(new URL('../api/v1/' + f, import.meta.url), 'utf8') }));
const SERVER = [...API, ...V1];

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

// The rule above matched `tok.x` / `rt.x` — object names that do not hold the leaks. It passed
// while 'sonnet', r.opus, t.opus and r.mimir all shipped in the bundle, because a regex written
// against one shape cannot see another. This one reads every string literal and property name in
// the file, which is the surface an attacker actually greps.
t('no vendor or model name anywhere in the shipped client bundle', () => {
  // One exception, and it is exempted by LOCATION rather than by pattern: the LEGACY-KEYS block
  // must name the storage keys older builds wrote in order to migrate them away. Weakening the
  // regex instead would have opened the door everywhere; cutting a hole at one labelled address
  // keeps the rule intact and makes the exception reviewable — and it disappears when that block
  // is finally deleted.
  const a = APP.indexOf('/* LEGACY-KEYS'), b = APP.indexOf('/* END LEGACY-KEYS */');
  if (a < 0 || b < a) throw new Error('the LEGACY-KEYS quarantine block is gone — re-scope this exemption');
  const src = APP.slice(0, a) + APP.slice(b);
  const strings = [...src.matchAll(/'([^'\\\n]{2,40})'|"([^"\\\n]{2,40})"/g)].map(m => m[1] || m[2]);
  const props = [...src.matchAll(/\.\s*([a-zA-Z_$][\w$]*)/g)].map(m => m[1]);
  const hits = [...strings, ...props].filter(v => VENDOR_WORD.test(v));
  if (hits.length) throw new Error(`shipped to every visitor: ${fmt([...new Set(hits)])}`);
});

t('no model id in what the server sends back to the client', () => {
  // The [[USAGE]] trailer and every error string reach the browser. A cost bucket named after a
  // model family is a model id however it is labelled in a comment.
  const hits = [];
  for (const { f, src } of SERVER) {
    for (const m of src.matchAll(/res\.(?:write|json|status\([^)]*\)\.json)\s*\(([^;]{0,220})/g))
      if (VENDOR_WORD.test(m[1])) hits.push(f + ': ' + m[1].replace(/\s+/g, ' ').trim().slice(0, 70));
    for (const m of src.matchAll(/\?\s*'([a-z]{3,12})'\s*:/g))
      if (VENDOR_WORD.test(m[1])) hits.push(f + ": bucket '" + m[1] + "'");
  }
  if (hits.length) throw new Error(`reaches the client: ${fmt([...new Set(hits)])}`);
});

t('our own name appears once, and never where a customer’s deliverable can carry it', () => {
  // The vendor-name rules above only know MODEL names. Our studio's name is a different leak with
  // the same shape, and it had reached the export cover, the export footer, the canvas eyebrow,
  // the deck's title slide, the deck's closing slide and the footer of every share link. Fixing
  // them by hand missed two — a deliverable branded with the tool-maker's name is one a studio
  // has to rebuild, which turns "ready to send" into "ready to redo".
  const decl = /const\s+VENDOR_MARK\s*=/;
  if (!decl.test(APP)) throw new Error('VENDOR_MARK is gone — re-scope this rule before removing it');
  const hits = APP.split('\n')
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /ORIONS/i.test(l) && !decl.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l.trim()))
    // Two exemptions, both named so they stay reviewable: an internal-tier comment, and the
    // storage key for pre-login rows — a database identifier that never reaches a rendered
    // surface. Renaming it would orphan every anonymous workspace not yet migrated.
    .filter(({ l }) => !/ORIONS team\b/.test(l) && !/LEGACY_WHO\s*=/.test(l));
  if (hits.length) throw new Error(`hardcoded outside VENDOR_MARK: ${fmt(hits.map(h => 'line ' + h.n))}`);
});

console.log('\nWiring the audit could not see before — api/ and home.html\n');

t('every onclick in app.js resolves to a function it declares', () => {
  // app.js builds most of its own markup, so index.html-only checking missed every handler the
  // script writes at runtime — including a Recast entry that pointed at nothing.
  const declared = new Set([...APP.matchAll(/(?:function\s+|const\s+|let\s+)([a-zA-Z_$][\w$]*)\s*(?:\(|=)/g)].map(m => m[1]));
  const called = new Set([...APP.matchAll(/onclick="([a-zA-Z_$][\w$]*)\(/g)].map(m => m[1]));
  const missing = [...called].filter(f => !declared.has(f));
  if (missing.length) throw new Error(`handlers that do not exist: ${fmt(missing)}`);
});

t('no CSS animation references keyframes that were never defined', () => {
  // `animation:tryflow` named a keyframe declared in a different file and silently did nothing.
  const all = CSS + HOME + rd('../css/site.css') + rd('../css/nav.css');
  const defined = new Set([...all.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
  const used = new Set([...all.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)]
    .flatMap(m => m[1].split(',').map(p => (p.trim().match(/^([A-Za-z_-][\w-]*)/) || [])[1]))
    .filter(n => n && !['none', 'inherit', 'initial', 'unset'].includes(n)));
  const missing = [...used].filter(n => !defined.has(n) && !/^\d/.test(n));
  if (missing.length) throw new Error(`animations that never run: ${fmt(missing)}`);
});

// Only what a reader actually sees. The first version of this check scanned the raw file and
// flagged the phrase "4 Minds" sitting inside a CSS comment that explains why the 4-up stat bar
// was removed — the fix being described as the fault. Strip style, script and comments first.
const prose = html => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ');

t('home.html states the same engine count the product ships', () => {
  const engines = (APP.match(/\{n:'[A-Za-z]+'\s*,\s*role:/g) || []).length;
  const text = prose(HOME);
  const claims = [...text.matchAll(/(\w+)\s+(?:minds|engines)\b/gi)].map(m => m[1].toLowerCase());
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const bad = claims.map(c => WORD[c] ?? +c).filter(n => Number.isFinite(n) && n !== engines);
  if (bad.length) throw new Error(`markup claims ${fmt(bad.map(String))} minds/engines; ENGINES has ${engines}`);
});

t('no version literal in the marketing markup either', () => {
  const v = (APP.match(/VERSION\s*=\s*'([\d.]+)'/) || [])[1];
  const text = prose(HOME);
  const stale = [...text.matchAll(/V[ÆAE]ST\s+(\d+\.\d+)/gi)].map(m => m[1]).filter(x => x !== v);
  if (stale.length) throw new Error(`home.html says ${fmt([...new Set(stale)])}, app.js says ${v}`);
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
