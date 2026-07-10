// VÆST unit tests — loads the real app markup + js in jsdom, tests the pure core.
// Run: npm test
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/app', pretendToBeVisual: true });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('network disabled in tests'));
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// jsdom evals don't share the lexical scope — export the surface under test in the SAME eval
w.eval(js + `
;window.__t = {
  capTxt, esc, wordCount, parsePoints, splitCanvases, msgContent, wordDiff,
  toneSys, tasteLog, applyBlob, stateBlob, buildDeckHTML,
  setState: (s, c) => { sessions = s; currentSid = c; },
  getSessions: () => sessions,
  setMast: m => { _mast = m; },
  setProfile: p => { profile = p; }, getProfile: () => profile,
  setTrash: t => { trash = t; }, getTrash: () => trash,
  setOrient: o => { _presOrient = o; },
  setLangLS: l => localStorage.setItem('vaest_lang', l),
};`);
const T = w.window.__t;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '—', e.message); }
}

console.log('\nVÆST unit tests\n');

// ── capTxt ──
t('capTxt keeps short text untouched', () => assert.equal(T.capTxt('hello', 10), 'hello'));
t('capTxt truncates long text with marker', () => {
  const out = T.capTxt('x'.repeat(50), 10);
  assert.ok(out.startsWith('xxxxxxxxxx') && out.includes('[truncated'));
});

// ── wordCount (mixed Thai/English) ──
t('wordCount counts English words', () => assert.equal(T.wordCount('hello world again'), 3));
t('wordCount approximates Thai by characters', () => {
  const n = T.wordCount('สวัสดีครับผม');
  assert.ok(n >= 2 && n <= 4, 'got ' + n);
});

// ── parsePoints (Refined / Ø Think contract) ──
t('parsePoints extracts {{quote}} anchors, strips from display', () => {
  const pts = T.parsePoints('- **Push it** {{exact words here}} — go bolder\n- **No anchor** — fine too');
  assert.equal(pts.length, 2);
  assert.equal(pts[0].q, 'exact words here');
  assert.ok(!pts[0].t.includes('{{'));
  assert.equal(pts[1].q, null);
});
t('parsePoints falls back to whole text when no bullets', () =>
  assert.equal(T.parsePoints('just prose, no bullets').length, 1));

// ── splitCanvases (multi-canvas contract) ──
t('splitCanvases → null for a single document', () =>
  assert.equal(T.splitCanvases('# One\n\n## A\n\nbody'), null));
t('splitCanvases splits on ===CANVAS: markers', () => {
  const r = T.splitCanvases('===CANVAS: Identity===\n# A\n\n## S\n\nx\n\n===CANVAS: Copy===\n# B\n\n## S\n\ny');
  assert.equal(r.length, 2);
  assert.equal(r[0].t, 'Identity');
  assert.ok(r[1].md.includes('# B'));
});

// ── msgContent (vision blocks) ──
t('msgContent passes plain text through when no images', () =>
  assert.equal(T.msgContent('hi', []), 'hi'));
t('msgContent builds text+image blocks, caps at 6', () => {
  const r = T.msgContent('hi', Array.from({ length: 9 }, () => ({ img: 'data:image/jpeg;base64,QUJD' })));
  assert.equal(r.length, 7);
  assert.equal(r[0].type, 'text');
  assert.equal(r[1].source.data, 'QUJD');
});

// ── esc ──
t('esc escapes angle brackets and ampersands', () =>
  assert.equal(T.esc('<b>&'), '&lt;b&gt;&amp;'));

// ── wordDiff ──
t('wordDiff marks an added word with <ins>', () => {
  const d = T.wordDiff('the quick fox', 'the quick brown fox');
  assert.ok(d.includes('<ins>') && d.includes('brown'));
});

// ── persona + language + taste injection ──
t('toneSys injects the selected persona on every call', () => {
  T.setState([{ id: 't1', tone: 'playful', files: [] }], 't1');
  assert.ok(T.toneSys().includes('PERSONA — PLAYFUL'));
});
t('toneSys respects the locked reply language', () => {
  T.setLangLS('th');
  assert.ok(T.toneSys().includes('Reply in Thai'));
  T.setLangLS('');
});
t('taste memory is injected once decisions exist', () => {
  T.setState([{ id: 't2', tone: '', files: [], taste: [{ v: 'approved', t: 'Bold naming' }, { v: 'skipped', t: 'Wordplay' }] }], 't2');
  const sys = T.toneSys();
  assert.ok(sys.includes('Taste memory') && sys.includes('Bold naming') && sys.includes('PASSED ON: Wordplay'));
});

// ── private sessions ──
t('tasteLog skips private sessions', () => {
  T.setState([{ id: 't3', tone: '', files: [], private: true }], 't3');
  T.setMast({ kind: 'think' });
  T.tasteLog('approved', { t: 'X' });
  assert.equal((T.getSessions()[0].taste || []).length, 0);
});

// ── state blob round-trip: profile + trash survive the cloud ──
t('applyBlob restores profile and trash', () => {
  T.setProfile({ name: 'QA', pic: 'data:image/jpeg;base64,x' });
  T.setTrash([{ at: 1, s: { id: 'z', title: 'old' } }]);
  const blob = JSON.parse(JSON.stringify(T.stateBlob()));
  T.setProfile({}); T.setTrash([]);
  assert.equal(T.applyBlob(blob), true);
  assert.equal(T.getProfile().name, 'QA');
  assert.equal(T.getTrash().length, 1);
});

// ── deck builder CI contract ──
t('buildDeckHTML renders every slide kind in brand CI', () => {
  T.setOrient('landscape');
  const h = T.buildDeckHTML([{ kind: 'cover', title: 'T' }, { kind: 'content', title: 'S', bullets: ['a', 'b'] }, { kind: 'quote', quote: 'Q' }, { kind: 'close', title: 'C' }], 'X');
  assert.ok(h.includes('class="sl cover"'));
  assert.ok(h.includes('class="sl quote"'));
  assert.ok(h.includes('#4fc3ff'));
  assert.ok(h.includes('size:297mm 167mm'));
});

console.log(`\n${pass} passed · ${fail} failed\n`);
process.exit(fail ? 1 : 0);
