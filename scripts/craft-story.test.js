'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../craft/story.js');
const T = require('../craft/text.js');

const SCENE = 'The bus stopped at the gate. Owen counted the windows. Nobody got off.\nHe waited for the driver to open the door.';

test('nine readings, each a question, a shape and a reason, in the order a yes is taken', () => {
  assert.deepEqual(St.KEYS, ['landed', 'reveal', 'setup', 'overwhelm', 'rising', 'stock', 'pull', 'fixed', 'opening']);
  for (const [key, q, shape, why] of St.READINGS) {
    assert.match(q, /\?$/, key);
    assert.ok(St.SHAPE_TEXT[shape], key);
    assert.ok(why.length > 5, key);
  }
});

test('the context: narrator, the card in words, then the scene\'s end', () => {
  const ctx = St.context({ scene: SCENE, card: { question: 'Will Owen get on?', outcome: 'noAnd' }, narrator: 'Owen' });
  assert.equal(ctx, 'Narrator: Owen.\nThe question: Will Owen get on?\nHow it ends: No, and\n\n' +
    'The scene so far, up to the sentence just written:\nThe bus stopped at the gate. Owen counted the windows. Nobody got off. He waited for the driver to open the door.');
  const long = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  assert.ok(T.wordCount(St.tail(long)) <= St.MAX_WORDS);
  assert.match(St.tail(long), /number 99 is here\.$/);
});

test('one request: a yes/no per reading asked', () => {
  const q = St.question({ scene: SCENE });
  assert.equal(q.model, 'winnow:e4b');
  assert.deepEqual(Object.keys(q.questions), St.KEYS);
  assert.deepEqual(Object.keys(q.questions.reveal.criteria), ['yes', 'no']);
  assert.deepEqual(Object.keys(St.question({ scene: SCENE }, ['reveal', 'stock']).questions), ['reveal', 'stock']);
});

test('the chance of yes, from probabilities or a confidence', () => {
  assert.deepEqual(St.yesChances({
    reveal: { choice: 'yes', probabilities: { yes: 0.7, no: 0.3 } },
    stock: { choice: 'no', confidence: 0.75 },
    pull: { choice: 'yes', confidence: 0.9 },
    fixed: { choice: 'maybe', confidence: 0.9 },
    nonsense: { choice: 'yes', confidence: 1 }
  }), { reveal: 0.7, stock: 0.25, pull: 0.9 });
});

test('the rules: the first yes in order, past the shape just used', () => {
  const cuts = { reveal: 0.5, stock: 0.5, landed: 0.5 };
  assert.deepEqual(St.fromReadings({ reveal: 0.6, stock: 0.9 }, cuts),
    { rule: 'story', reading: 'reveal', shape: 'delay', text: St.SHAPE_TEXT.delay, why: 'Something’s about to be shown.' });
  assert.equal(St.fromReadings({ reveal: 0.4, stock: 0.9 }, cuts).reading, 'stock');
  assert.equal(St.fromReadings({ pull: 0.99 }, cuts), null, 'a reading without a cut is never used');
  const short = T.sentences('He ran.')[0];
  assert.equal(St.fromReadings({ landed: 0.9, stock: 0.9 }, cuts, short).reading, 'stock', 'not short after short');
  assert.equal(St.fromReadings({ stock: 0.9 }, cuts, null, { rule: 'threePart' }), null, 'no list after three parts');
  assert.deepEqual(St.asking(cuts), ['landed', 'reveal', 'stock']);
  assert.deepEqual(St.asking(), [], 'nothing ships until measured');
});

test('combine: a rhythm problem, then the story, then the gentle notes', () => {
  const story = { rule: 'story' };
  assert.equal(St.combine({ rule: 'landLong' }, story).rule, 'landLong');
  assert.equal(St.combine({ rule: 'unusedShape' }, story), story);
  assert.equal(St.combine({ rule: 'unusedShape' }, null).rule, 'unusedShape');
  assert.equal(St.combine(null, null), null);
  assert.equal(St.rhythmSettles({ rule: 'sameLength' }), true);
  assert.equal(St.rhythmSettles({ rule: 'openings' }), false);
});

test('a ladder question: the moment and five rungs, a comparison each', () => {
  const L = require('../craft/ladders.js');
  assert.deepEqual(Object.keys(L.LADDERS), St.KEYS);
  for (const k of St.KEYS) assert.equal(L.LADDERS[k].length, 5, k);
  const q = St.ladderQuestion({ scene: SCENE }, 'reveal');
  assert.deepEqual(Object.keys(q.questions), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.match(q.state, /He waited for the driver to open the door\.\n\nReference passages:\nPassage 1: /);
  assert.match(q.questions.r3.instructions, /about to be shown[\s\S]*passage 3/);
  assert.throws(() => St.ladderQuestion({ scene: SCENE }, 'nope'), /No ladder/);
});

test('the level: the sum of the yes-chances', () => {
  const a = (choice, confidence) => ({ type: 'choice', choice, confidence });
  assert.equal(St.ladderLevel({ r1: a('yes', 1), r2: a('yes', 0.9), r3: a('no', 0.6), r4: a('no', 1), r5: a('no', 1) }).toFixed(2), '2.30');
  assert.equal(St.ladderLevel({ r1: { choice: 'yes', probabilities: { yes: 0.8 } } }), 0.8);
  assert.equal(St.ladderLevel({}), null);
  assert.equal(St.LADDER_CUT, 3);
});

// Strongest Moments (beta): rank, never claim
const PARA = (n, last) => Array.from({ length: n }, (_, i) => `Owen walked past house number ${i} on the hill.`).join(' ') + ' ' + last;

test('moments: each narrated paragraph\'s last sentence, once there is scene enough to read', () => {
  const text = [PARA(1, 'Too early.'), PARA(4, 'The bus stopped.'), '“Get in,” she said, “now, before he sees you.”', '', PARA(2, 'He got in.')].join('\n');
  const m = St.moments(text);
  assert.deepEqual(m.map((x) => text.slice(x.start, x.end)), ['The bus stopped.', 'He got in.'], 'not the first (too little before), not speech, not the scene break');
  assert.match(m[0].view, /The bus stopped\.$/);
  assert.ok(T.wordCount(m[1].view) <= St.MAX_WORDS);
});

test('strongest: per reading, the top three by chance, shown readings before provisional', () => {
  assert.deepEqual(St.strongestKeys(), ['landed', 'opening', 'rising', 'reveal']);
  const chances = [0.1, 0.9, 0.5, 0.7, 0.3].map((x) => ({ landed: x, opening: 1 - x, rising: x, reveal: 0.5 }));
  const r = St.strongest(chances);
  assert.deepEqual(r.map((x) => [x.key, x.provisional]), [['landed', false], ['opening', false], ['rising', true], ['reveal', true]]);
  assert.deepEqual(r[0].picks.map((p) => p.index), [1, 3, 2]);
  assert.deepEqual(r[1].picks.map((p) => p.index), [0, 4, 2]);
  assert.deepEqual(r[3].picks.map((p) => p.index), [0, 1, 2], 'ties keep the page order');
  assert.deepEqual(St.strongest(chances.slice(0, 3)), [], 'too few moments to rank');
  assert.deepEqual(St.strongest([null, ...chances]).length, 4, 'moments not yet read are skipped');
  for (const k of St.strongestKeys()) assert.ok(St.STRONG_LABEL[k], k);
});
