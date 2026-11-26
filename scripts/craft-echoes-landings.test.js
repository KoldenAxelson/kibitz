'use strict';

// craft/echoes.js and craft/landings.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const E = require('../craft/echoes.js');
const L = require('../craft/landings.js');

test('a word back within forty words is an echo, every use marked', () => {
  const text = 'The container was hot. The containers on Row Nine were hotter, and every container hummed.';
  const echoes = E.find(text);
  assert.deepEqual(echoes.map((e) => [e.key, e.count]), [['container', 3]]);
  for (const h of echoes[0].hits) assert.equal(text.slice(h.start, h.end), h.word);
});

test('small words never echo, and distance matters', () => {
  assert.deepEqual(E.find('The cat and the dog and the bird.'), []);
  const far = 'fence ' + Array.from({ length: 45 }, (_, i) => `w${i}x`).join(' ') + ' fence';
  assert.deepEqual(E.find(far), []);
  assert.equal(E.find(far, { window: 50 }).length, 1);
});

test('the same opening as the sentence before, and weak landings', () => {
  const rows = L.find('He walked to the mess hall. He got a tray and sat down with it. The noise was loud and he hated it. Kevin ate quickly.');
  assert.deepEqual(rows.map((r) => [r.opening.word, r.landing.word, r.sameOpening, r.weak]), [
    ['He', 'hall', false, false],
    ['He', 'it', true, true],
    ['The', 'it', false, true],
    ['Kevin', 'quickly', false, true]
  ]);
});

test('-ly words that are not adverbs land fine', () => {
  assert.equal(L.weakLanding('family'), false);
  assert.equal(L.weakLanding('lonely'), false);
  assert.equal(L.weakLanding('slowly'), true);
  assert.equal(L.weakLanding('There'), true);
});

test('landing offsets point into the original text', () => {
  const text = '  “Go,” he said.\nShe left it there.';
  for (const r of L.find(text)) {
    assert.equal(text.slice(r.opening.start, r.opening.end), r.opening.word);
    assert.equal(text.slice(r.landing.start, r.landing.end), r.landing.word);
  }
});
