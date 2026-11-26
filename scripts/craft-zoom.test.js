'use strict';

// craft/zoom.js: asking a decision model for zoom levels, reading its
// answers, the three flags of the uneven U, and closeness to a person.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Z = require('../craft/zoom.js');

const S = ['The kettle clicked off.', 'Every morning she made two cups.', 'Grief is a habit.'];

test('three ways of asking', () => {
  assert.deepEqual(Z.VARIANTS, ['paragraph', 'sentence', 'choice']);
  const [p] = Z.questions(S, 'paragraph');
  assert.equal(p.state, S.join(' '));
  assert.deepEqual(Object.keys(p.questions), ['s0', 's1', 's2']);
  assert.equal(p.questions.s1.type, 'score');
  assert.equal(p.questions.s1.criteria.length, 5);
  assert.match(p.questions.s1.instructions, /Every morning/);
  const each = Z.questions(S, 'sentence');
  assert.equal(each.length, 3);
  assert.deepEqual(each.map((r) => [r.state, Object.keys(r.questions)[0]]), [[S[0], 's0'], [S[1], 's1'], [S[2], 's2']]);
  const [c] = Z.questions(S, 'choice');
  assert.deepEqual(Object.keys(c.questions.s2.criteria), ['1', '2', '3', '4', '5']);
});

test('answers become levels 1-5, and anything odd becomes nothing', () => {
  const ls = Z.levels({
    s0: { type: 'score', score: 0.2, confidence: 0.6 },
    s1: { type: 'choice', choice: '3', confidence: 0.4, probabilities: { 1: 0, 2: 0.25, 3: 0.5, 4: 0.25, 5: 0 } },
    s2: { type: 'score', score: 'x' }
  }, 4);
  assert.deepEqual(ls, [{ level: 1.2, confidence: 0.6 }, { level: 3, confidence: 0.4 }, null, null]);
  assert.deepEqual(Z.levels(null, 2), [null, null]);
});

test('the flags of the uneven U', () => {
  const none = { endsClose: false, neverDown: false, onlyBack: false };
  assert.deepEqual(Z.flags([3, 1, 4]), none, 'a good U: wide, close, wider');
  assert.deepEqual(Z.flags([3, 2, 1]), { ...none, endsClose: true });
  assert.deepEqual(Z.flags([4, 3, 4.5, 5]), { ...none, neverDown: true });
  assert.deepEqual(Z.flags([4, 3, 5, 4]), { ...none, neverDown: true, onlyBack: true }, 'both: high all along, and ends where it opened');
  assert.deepEqual(Z.flags([4, 2, 4]), { ...none, onlyBack: true });
  assert.deepEqual(Z.flags([4, 2, 3.8]), { ...none, onlyBack: true }, 'back to about where it opened');
  assert.deepEqual(Z.flags([4, 2]), none, 'too short to judge');
  assert.deepEqual(Z.flags([4, null, 2, null, 5]), none, 'gaps are skipped');
});

test('stretching a model that bunches in the middle', () => {
  const model = [2.5, 3, 3.5, 2.6, 3.4];
  const human = [1, 3, 5, 1.4, 4.6];
  const fit = Z.stretchFit(model, human);
  assert.ok(fit.b > 3, 'the spread is widened');
  assert.ok(Math.abs(Z.stretch(3, fit) - 3) < 0.1);
  assert.equal(Z.stretch(9, fit), 5, 'clamped to the scale');
  assert.deepEqual(Z.stretchFit([], []), { a: 0, b: 1 });
});

test('closeness to a person: distance, within one, rank, flags', () => {
  const human = [[3, 1, 4], [3, 2, 1], [2, 5]];
  const model = [[3, 2, 4], [3, 2, 2], [2, 4]];
  const c = Z.compare(human, model);
  assert.equal(c.sentences, 8);
  assert.equal(c.paragraphs, 2, 'the two-sentence paragraph has no curve');
  assert.equal(c.distance, 3 / 8);
  assert.equal(c.withinOne, 1);
  assert.ok(c.rank > 0.8);
  assert.deepEqual(c.flagAgree, { endsClose: 0.5, neverDown: 1, onlyBack: 1 });
  const empty = Z.compare([], []);
  assert.equal(empty.distance, null);
  assert.equal(empty.rank, null);
});
