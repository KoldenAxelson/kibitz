'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../craft/story.js');
const T = require('../craft/text.js');

const SCENE = 'The bus stopped at the gate. Owen counted the windows. Nobody got off.\nHe waited for the driver to open the door.';

test('every choice has its reason for the model; all but "none" say something to the writer', () => {
  assert.deepEqual(St.KEYS, ['delay', 'contrast', 'short', 'list', 'repetition', 'pileOn', 'building', 'reversal', 'long', 'none']);
  for (const k of St.KEYS) {
    const [cue, text, why] = St.CHOICES[k];
    assert.ok(cue.length > 20, k);
    if (k === 'none') assert.equal(text, null);
    else assert.ok(text && why, k);
  }
});

test('the context: narrator, the card in words, then the scene', () => {
  const ctx = St.context({ scene: SCENE, card: { question: 'Will Owen get on?', outcome: 'noAnd', junk: 'x' }, narrator: 'Owen' });
  assert.equal(ctx, 'Narrator: Owen.\nThe question: Will Owen get on?\nHow it ends: No, and\n\nThe scene so far:\n' +
    'The bus stopped at the gate. Owen counted the windows. Nobody got off. He waited for the driver to open the door.');
  assert.equal(St.context({ scene: 'One line.' }), 'The scene so far:\nOne line.');
});

test('a long scene is cut to its last sentences, whole', () => {
  const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const t = St.tail(long);
  assert.ok(T.wordCount(t) <= St.MAX_WORDS);
  assert.match(t, /^Sentence number \d+ is here\./);
  assert.match(t, /Sentence number 199 is here\.$/);
  assert.equal(St.tail('One enormous ' + 'word '.repeat(400) + 'end.', 10).split(' ').length > 10, true, 'a single over-long sentence still goes');
});

test('the question is one choice among the shapes and "none"', () => {
  const q = St.question({ scene: SCENE });
  assert.equal(q.model, 'winnow:e4b');
  assert.deepEqual(Object.keys(q.questions), ['next']);
  assert.equal(q.questions.next.type, 'choice');
  assert.deepEqual(Object.keys(q.questions.next.criteria), St.KEYS);
});

test('pick: a sure answer becomes a suggestion; unsure, "none" or nonsense don\'t', () => {
  assert.deepEqual(St.pick({ next: { type: 'choice', choice: 'delay', confidence: 0.3, probabilities: { delay: 0.6 } } }),
    { rule: 'story', shape: 'delay', text: St.CHOICES.delay[1], why: St.CHOICES.delay[2], confidence: 0.6 });
  assert.equal(St.pick({ next: { choice: 'delay', confidence: 0.2 } }, 0.3), null);
  assert.equal(St.pick({ next: { choice: 'delay', confidence: 0.2 } }).shape, 'delay', 'the dev split set no cut');
  assert.equal(St.pick({ next: { choice: 'delay' } }), null, 'no confidence, no pick');
  assert.equal(St.pick({ next: { choice: 'none', confidence: 0.9 } }), null);
  assert.equal(St.pick({ next: { choice: 'sonnet', confidence: 0.9 } }), null);
  assert.equal(St.pick({}), null);
  assert.equal(St.pick(null), null);
});

test('combine: a rhythm problem first, then the story, then the gentle notes', () => {
  const story = { rule: 'story', shape: 'delay' };
  const hard = { rule: 'landLong', shape: 'short' };
  const soft = { rule: 'unusedShape', shape: 'reversal' };
  assert.equal(St.combine(hard, story), hard);
  assert.equal(St.combine(soft, story), story);
  assert.equal(St.combine(null, story), story);
  assert.equal(St.combine(soft, null), soft);
  assert.equal(St.combine(null, null), null);
  assert.equal(St.combine({ rule: 'threePart', shape: null }, { rule: 'story', shape: 'list' }).rule, 'threePart', 'no list after a list');
  const last = T.sentences('She ran, and she fell, and she got up, and she ran again.')[0];
  assert.equal(St.combine(soft, { rule: 'story', shape: 'pileOn' }, last), soft, 'not the shape just used');
  assert.equal(St.rhythmSettles(hard), true);
  assert.equal(St.rhythmSettles(soft), false);
  assert.equal(St.rhythmSettles(null), false);
});
