'use strict';

// craft/cut.js: the words-to-cut table, preposition chains and tiny-word
// runs, with counts per thousand words.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const C = require('../craft/cut.js');

const found = (text, opts) => C.find(text, opts).hits.map((h) => `${h.kind}:${h.text}`);

test('every kind in the table is found', () => {
  assert.deepEqual(found('He suddenly realized that he just really wanted to utilize something, maybe.'), [
    'time:suddenly', 'filter:realized', 'weasel:that', 'weasel:just', 'inflation:really', 'puff:utilize', 'empty:something', 'hedge:maybe'
  ]);
  assert.deepEqual(found('She nodded her head and sat down, and then shrugged his shoulders.'), [
    'doubled:nodded her head', 'doubled:sat down', 'time:and then', 'doubled:shrugged his shoulders'
  ]);
});

test('whole words only, apostrophes included', () => {
  assert.deepEqual(found('That’s thatch. Justice. Verily.'), []);
  assert.deepEqual(found('THAT and Just.'), ['weasel:THAT', 'weasel:Just']);
});

test('the longest phrase wins at one spot', () => {
  assert.deepEqual(found('All of a sudden it was over.'), ['time:All of a sudden']);
  assert.deepEqual(found('They were in order to finish.'), ['puff:in order to']);
});

test('hedges in speech are let off unless asked for', () => {
  const text = '"Maybe," she said. Maybe not.';
  assert.deepEqual(found(text), ['hedge:Maybe']);
  assert.equal(C.find(text).hits[0].start, text.lastIndexOf('Maybe'));
  assert.deepEqual(found(text, { hedgesInDialogue: true }), ['hedge:Maybe', 'hedge:Maybe']);
});

test('three or more prepositional phrases in a row', () => {
  assert.deepEqual(found('In the back of the room behind the desk, he waited.'), ['chain:In the back of the room behind the desk']);
  // punctuation breaks a chain
  assert.deepEqual(found('In the back. Of the room. Behind the desk.'), []);
});

test('runs of tiny words', () => {
  assert.deepEqual(found('So was I becoming, though it was to be a slower kind.'), ['tiny:it was to be a']);
  assert.deepEqual(found('It is so. It is.'), []);
});

test('counts and the rate per thousand words', () => {
  const r = C.find('Really. Really. Really. The rest of these seven words.');
  assert.equal(r.words, 9);
  assert.equal(r.counts.inflation, 3);
  assert.equal(r.perThousand.inflation, 333.3);
  assert.equal(r.counts.chain, 0);
  assert.equal(C.find('').total, 0);
});

test('the kinds come with labels and advice, and no regexes leak out', () => {
  for (const k of C.KINDS.concat(C.RUN_KINDS)) {
    assert.ok(k.key && k.label && k.instead);
    assert.equal(k.re, undefined);
  }
});
