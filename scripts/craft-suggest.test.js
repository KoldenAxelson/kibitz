'use strict';

// craft/suggest.js: the suggester's rhythm layer. One test per rule, the
// order they're tried in, when it stays quiet, and the two checks the
// window leans on (is the caret after a finished sentence; is it time).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../craft/text.js');
const G = require('../craft/suggest.js');

const say = (text, opts) => G.suggest(T.sentences(text), opts);
const rule = (text, opts) => (say(text, opts) || {}).rule || null;

const LONG = 'He walked the length of the row in the heat of the afternoon with the tray balanced on one arm and the score still glowing on the screen behind him like a promise.';
const MEDIUM = [
  'The base had a pool that nobody ever swam in during the summer.',
  'The fences on Row Nine were all painted white by the same men.',
  'Owen counted the containers on his way to the mess hall again.',
  'Kevin had already eaten his lunch and gone back to work.'
];

test('the rules, in the order they are tried', () => {
  assert.deepEqual(G.RULES, ['landLong', 'threeShort', 'funnel', 'sameLength', 'threePart', 'openings', 'noShort', 'unusedShape']);
});

test('landLong: a very long sentence just ended', () => {
  const s = say(LONG);
  assert.equal(s.rule, 'landLong');
  assert.equal(s.shape, 'short');
  assert.equal(s.why, 'That sentence ran 33 words.');
});

test('threeShort: three short ones in a row', () => {
  const s = say('He stopped. He looked. He sat.');
  assert.deepEqual([s.rule, s.shape], ['threeShort', 'long']);
  assert.equal(s.why, 'The last three sentences were all four words or fewer.');
  assert.equal(rule('He stopped. He looked.'), null);
});

test('funnel: a paragraph that keeps shrinking, but only within a paragraph', () => {
  const text = 'The bus ran late again and nobody on it seemed to mind at all today. Owen minded it a little more than most. He said nothing about it.';
  assert.equal(rule(text), 'funnel');
  // the same sentences across paragraphs are no funnel
  assert.notEqual(rule(text.replace(/\. /g, '.\n')), 'funnel');
  // a funnel that has already landed on a short one is finished
  assert.equal(rule(text + ' Fine.'), null);
});

test('sameLength: a run of about one length, and which way to break it', () => {
  const s = say(MEDIUM.join(' '));
  assert.deepEqual([s.rule, s.shape, s.text], ['sameLength', 'short', 'Try a short one.']);
  assert.equal(s.why, 'Your last four sentences all ran 11 to 13 words.');
  const mid = say('He went to the store again. She stayed home with the dog. They met for dinner at six. Nobody said a word to them.');
  assert.deepEqual([mid.rule, mid.shape], ['sameLength', 'long']);
});

test('threePart: anything but another', () => {
  assert.equal(rule('He stood. The light, the noise, and the smell got to him.'), 'threePart');
});

test('openings: three subject-first openings', () => {
  const s = say('He sat down by the window. The soup was cold again today and gray as old dishwater from the sink. Owen ate all of it anyway.');
  assert.equal(s.rule, 'openings');
  assert.equal(s.why, 'The last three all started with the subject.');
  assert.equal(rule('He sat down by the window. When the soup came, it was cold again and gray as old dishwater. Owen ate all of it anyway.'), null);
  // a short one breaks the run
  assert.equal(rule('He sat down by the window. Cold soup. Owen ate all of it anyway. The tray went back.'), null);
});

test('noShort: nothing under four words for a while', () => {
  const lines = [
    'When the bus came, it was late.',
    'Still, nobody on board complained about it, not even the men who had waited longest in the rain.',
    'Owen found a seat.',
    'Outside, the white fences went past in rows that never seemed to end or change or thin out.',
    'If anyone spoke, nobody heard.',
    'Kevin slept against the glass with his cap pulled down over his eyes and his arms folded tight.',
    'At the gate, a guard waved.',
    'Later, the screens in the mess hall showed everyone their scores for the week, one name at a time.'
  ];
  const s = say(lines.join(' '));
  assert.equal(s.rule, 'noShort');
  assert.equal(s.why, 'Nothing under four words in the last eight sentences.');
  assert.equal(rule(lines.slice(1).join(' ')), null);
});

test('unusedShape: a nudge once the chapter is long enough', () => {
  const text = 'When the bus came, it was late. Still, nobody complained.';
  const chapter = { sentences: 20, shapesUsed: new Set(['delay', 'contrast', 'short']) };
  const s = say(text, { chapter });
  assert.equal(s.rule, 'unusedShape');
  assert.equal(s.shape, 'list');
  assert.equal(s.text, 'Try a list sentence: a claim, then the details that prove it.');
  assert.equal(rule(text, { chapter: { ...chapter, sentences: 5 } }), null);
});

test('quiet by default', () => {
  assert.equal(G.suggest([]), null);
  assert.equal(rule('Owen sat down.'), null);
  assert.equal(rule('When the bus came, it was late. Still, nobody complained. Owen found a seat near the back, by the door.'), null);
});

test('the caret is after a finished sentence', () => {
  assert.equal(G.atSentenceEnd('He left.'), true);
  assert.equal(G.atSentenceEnd('He left. '), true);
  assert.equal(G.atSentenceEnd('"Go."'), true);
  assert.equal(G.atSentenceEnd('Wait...'), true);
  assert.equal(G.atSentenceEnd('Really?!'), true);
  assert.equal(G.atSentenceEnd('It was I.'), true);
  assert.equal(G.atSentenceEnd('He left', ''), false);
  assert.equal(G.atSentenceEnd('He left.', ' and came back'), false);
  assert.equal(G.atSentenceEnd('He met Mr.'), false);
  assert.equal(G.atSentenceEnd('He met J.'), false);
  assert.equal(G.atSentenceEnd('...'), false);
  assert.equal(G.atSentenceEnd(''), false);
});

test('suggestions keep their distance', () => {
  const a = { rule: 'sameLength' };
  assert.equal(G.shouldShow(null, a, 5), true);
  assert.equal(G.shouldShow(null, null, 5), false);
  assert.equal(G.shouldShow({ rule: 'funnel', at: 5 }, a, 7), false);
  assert.equal(G.shouldShow({ rule: 'funnel', at: 5 }, a, 5 + G.COOLDOWN), true);
  assert.equal(G.shouldShow({ rule: 'sameLength', at: 5 }, a, 5 + G.COOLDOWN), false);
  assert.equal(G.shouldShow({ rule: 'sameLength', at: 5 }, a, 5 + G.SAME_RULE_COOLDOWN), true);
  // fewer sentences than before: a new scene, or words taken away
  assert.equal(G.shouldShow({ rule: 'sameLength', at: 9 }, a, 2), true);
});
