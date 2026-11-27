'use strict';

// craft/shapes.js: openings, the nine sentence shapes and the runs a
// paragraph makes. The example sentences are the "Grunt Force try" lines
// and published examples from private/rules/writing-techniques.md.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../craft/text.js');
const S = require('../craft/shapes.js');

const shapes = (text) => [...S.shapesOf(text)].sort();

test('the nine shapes are named in the order they are taught', () => {
  assert.deepEqual(S.SHAPES.map((s) => s.key), ['delay', 'contrast', 'short', 'list', 'repetition', 'pileOn', 'building', 'reversal', 'long']);
});

test('openings', () => {
  const kind = (t) => S.opening(t).kind;
  assert.equal(kind('He walked to the mess hall.'), 'subject');
  assert.equal(kind('The base was a postcard.'), 'subject');
  assert.equal(kind('When the bus came, he stood.'), 'clause');
  assert.equal(kind('Walking home, he counted fences.'), 'clause');
  assert.equal(kind('Still, nothing.'), 'shortComma');
  assert.equal(kind('Then my assignments.'), 'conjunction');
  assert.equal(kind('"Go," he said.'), 'dialogue');
  // -ing nouns are subjects, not participles
  assert.equal(kind('Nothing moved, not even the flag.'), 'subject');
  assert.equal(kind('Morning came, grey and loud.'), 'subject');
  assert.equal(kind('During the count, nobody spoke.'), 'clause');
});

test('delay: the subject held back', () => {
  assert.deepEqual(shapes('Past the dog park, past the pool nobody swims in, past the forty-third white fence on Row Nine, sat the one container with its lights still on.'), ['building', 'delay']);
  assert.deepEqual(shapes('Far out in the uncharted backwaters of the unfashionable end of the Western Spiral arm of the Galaxy lies a small unregarded yellow sun.'), ['delay']);
  // a conditional lead-in is not a delay
  assert.deepEqual(shapes('If the Sergeant had screamed at me, I’d have forgotten it by dinner, but I couldn’t forget him being kind.'), ['contrast']);
});

test('contrast, reversal, list', () => {
  assert.deepEqual(shapes('Dignity through work was the first thing the work took.'), ['reversal']);
  assert.deepEqual(shapes('The base was a postcard: mowed by men who’d never own a lawn, painted by hands that used to build houses, watched over by a number nobody had seen.'), ['list']);
  assert.deepEqual(shapes('The light, the noise, and the smell got to him.'), ['list']);
  assert.deepEqual(shapes('He ate the soup, and then he left.'), []);
});

test('repetition, pile-on, building', () => {
  assert.deepEqual(shapes('He said the words, and he meant the words, and the words meant nothing at all to anyone.'), ['repetition']);
  assert.deepEqual(shapes('He ran and he ran and he fell and he got up.'), ['pileOn']);
  assert.deepEqual(shapes('Every shift earns a point, every point earns a perk, every perk buys a quiet night.'), ['building']);
});

test('short and long', () => {
  assert.deepEqual(shapes('Then my assignments.'), ['short']);
  assert.deepEqual(shapes('They rode on.'), ['short']);
  const long = 'He walked the length of the row in the heat of the afternoon with the tray balanced on one arm and the score still glowing on the screen behind him like a promise nobody meant to keep for long.';
  assert.ok(S.shapesOf(long).has('long'));
  assert.deepEqual(shapes('She walked to the store and bought some milk for the kids.'), []);
});

test('runs of about the same length', () => {
  assert.deepEqual(S.sameLengthRuns([5, 18, 22, 26, 20, 3, 4, 30]), [{ from: 1, to: 4, min: 18, max: 26 }]);
  assert.deepEqual(S.sameLengthRuns([3, 4, 3, 12, 12, 13, 14, 40]), [{ from: 0, to: 2, min: 3, max: 4 }, { from: 3, to: 6, min: 12, max: 14 }]);
  assert.deepEqual(S.sameLengthRuns([3, 20, 4, 30]), []);
  assert.deepEqual(S.sameLengthRuns([]), []);
});

test('funnels stay inside a paragraph', () => {
  const text = 'The bus ran late again and nobody on it seemed to mind at all. Owen minded a little. He said nothing. Fine.\nA new paragraph starts long enough to matter. Short.';
  const f = S.funnels(T.sentences(text));
  assert.deepEqual(f, [{ from: 0, to: 3, paragraph: 0 }]);
});

test('rhythm sums a run of sentences', () => {
  const r = S.rhythm(T.sentences('I checked my score. Then my assignments. Then I stopped checking.'));
  assert.equal(r.shortest, 3);
  assert.equal(r.longest, 4);
  assert.deepEqual(r.rows.map((x) => x.opening), ['subject', 'conjunction', 'conjunction']);
  assert.ok(r.shapesUsed.has('short'));
  assert.equal(r.sameLengthRuns.length, 1);
});

test('a guide for every shape and for the rules that name none: what, how, when, never an example sentence', () => {
  for (const key of [...S.SHAPES.map((s) => s.key), 'openings', 'threePart']) {
    const g = S.guideFor(key);
    assert.ok(g && g.name && g.what && g.how && g.when, key);
    for (const text of [g.what, g.how, g.when]) assert.doesNotMatch(text, /[“”"]/, `${key}: no quoted lines`);
  }
  assert.equal(S.guideFor('nope'), null);
});
