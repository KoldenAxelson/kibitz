'use strict';

// craft/text.js: paragraphs, sentences, words and quoted stretches, each
// with offsets that point back at exactly the text they report.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../craft/text.js');

const texts = (text) => T.sentences(text).map((s) => s.text);

test('sentences end at . ! ? and an ellipsis', () => {
  assert.deepEqual(texts('I checked my score. Then my assignments! Then I stopped checking? Then nothing...'),
    ['I checked my score.', 'Then my assignments!', 'Then I stopped checking?', 'Then nothing...']);
  assert.deepEqual(texts('She left… He stayed.'), ['She left…', 'He stayed.']);
});

test('a full stop after an abbreviation, initial or decimal carries on', () => {
  assert.deepEqual(texts('Mr. Ruiz woke at 7 a.m. and ate. Sgt. Hale paid $3.50 for it.'),
    ['Mr. Ruiz woke at 7 a.m. and ate.', 'Sgt. Hale paid $3.50 for it.']);
  assert.deepEqual(texts('J. R. Hartley wrote it. It was I. Nobody else.'), ['J. R. Hartley wrote it.', 'It was I.', 'Nobody else.']);
});

test('speech: a tag in lowercase stays in the sentence, a capital starts the next', () => {
  assert.deepEqual(texts('"Go away!" he said. "Fine." She left.'), ['"Go away!" he said.', '"Fine."', 'She left.']);
  assert.deepEqual(texts('“Wait…” she whispered. “Now.”'), ['“Wait…” she whispered.', '“Now.”']);
  assert.deepEqual(texts('Wait... what? Yes.'), ['Wait... what?', 'Yes.']);
});

test('a sentence never crosses a paragraph, and an unfinished one still counts', () => {
  const s = T.sentences('First line has no stop\nSecond one does.\n\n   Third, indented');
  assert.deepEqual(s.map((x) => [x.paragraph, x.text]), [[0, 'First line has no stop'], [1, 'Second one does.'], [2, 'Third, indented']]);
});

test('offsets point at exactly the reported text', () => {
  const text = '  Mr. Ruiz said, "Go."  He went.\n“Why?” she asked… Nobody knew. 3.5 hours passed.';
  for (const s of T.sentences(text)) assert.equal(text.slice(s.start, s.end), s.text);
  for (const w of T.words(text)) assert.equal(text.slice(w.start, w.end), w.word);
  for (const p of T.paragraphs(text)) assert.equal(text.slice(p.start, p.end), p.text);
});

test('words keep contractions and hyphens whole, and count beyond ASCII', () => {
  assert.deepEqual(T.words('Don’t paint the forty-third fence, Zoë.').map((w) => w.word), ['Don’t', 'paint', 'the', 'forty-third', 'fence', 'Zoë']);
  assert.equal(T.wordCount('Ich weiß es nicht — vielleicht.'), 5);
  assert.equal(T.wordCount(''), 0);
});

test('quoted stretches pair by shape, and an open quote closes at the paragraph end', () => {
  const text = '“Go,” he said. "Now." “Still talking\nNext paragraph.';
  assert.deepEqual(T.quoteRanges(text).map((r) => text.slice(r.start, r.end)), ['“Go,”', '"Now."', '“Still talking']);
  const ranges = T.quoteRanges(text);
  assert.equal(T.inRanges(text.indexOf('Go'), ranges), true);
  assert.equal(T.inRanges(text.indexOf('he said'), ranges), false);
  assert.equal(T.quotedShare(text, { start: 0, end: 14 }, ranges), 1 / 3);
});

test('stems pair plurals and possessives', () => {
  assert.equal(T.stem('Containers'), 'container');
  assert.equal(T.stem('Owen’s'), 'owen');
  assert.equal(T.stem('glass'), 'glass');
  assert.equal(T.stem('bus'), 'bus');
});
