'use strict';

// craft/scenes.js: the questions a card asks, and the book's shape.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const S = require('../craft/scenes.js');

test('the five scene questions, and the chapter\'s two', () => {
  assert.deepEqual(S.FIELDS.map((f) => f.key), ['question', 'forward', 'outcome', 'tentpole', 'revelation']);
  assert.deepEqual(S.CHAPTER_FIELDS.map((f) => f.key), ['narrator', 'pace']);
  for (const f of S.FIELDS.concat(S.CHAPTER_FIELDS)) assert.ok(f.label && f.prompt, f.key);
});

test('answers are cleaned: one line, known choices, nothing empty', () => {
  assert.deepEqual(S.clean({ question: '  Will Owen\n tell?  ', forward: 'complication', outcome: 'maybe', tentpole: ' ', extra: 'x' }),
    { question: 'Will Owen tell?', forward: 'complication' });
  assert.equal(S.clean({}), null);
  assert.equal(S.clean(null), null);
  assert.equal(S.clean({ narrator: 'Owen' }), null, 'a section has no narrator');
  assert.deepEqual(S.clean({ narrator: 'Owen', pace: 'fast' }, true), { narrator: 'Owen', pace: 'fast' });
});

test('a card shows the question and short tags', () => {
  assert.deepEqual(S.summary({ question: 'Will Owen tell?', forward: 'decision', outcome: 'noAnd', tentpole: 'The gate', narrator: 'Owen', pace: 'breather' }),
    { question: 'Will Owen tell?', tags: ['Owen', 'Decision', 'No, and', 'Tentpole', 'Breather'] });
  assert.deepEqual(S.summary(null), { question: '', tags: [] });
  assert.equal(S.answered({ question: 'Q', outcome: 'yesBut', narrator: 'Owen' }), 2);
});

const prose = 'The fences ran white down the row and nobody looked at them. '.repeat(8);
const talk = '"Hi there," he said. "How are you doing today?" "Fine, thanks."';
const ch = (n, narrator, text, pace) => ({ id: 'c' + n, name: 'Chapter ' + n, narrator, text, pace });

test('the book\'s shape: lengths, dialogue, pace', () => {
  const r = S.bookShape([ch(1, 'Owen', prose), ch(2, 'Kevin', talk), ch(3, 'Owen', prose, 'fast')]);
  assert.deepEqual(r.rows.map((x) => [x.words, x.pace, x.paceSet]), [[96, 'steady', false], [11, 'fast', false], [96, 'fast', true]]);
  assert.ok(r.rows[1].dialogue > 0.8);
  assert.equal(r.rows[0].dialogue, 0);
  assert.equal(r.median, 96);
});

test('runs of dialogue-heavy chapters and of fast ones are named', () => {
  // (fast is short against the book's median chapter, so most are full length)
  const tail = [ch(5, 'Owen', prose), ch(6, 'Andre', prose), ch(7, 'Mateo', prose)];
  const r = S.bookShape([ch(1, 'Owen', prose), ch(2, 'Kevin', talk), ch(3, 'Andre', talk), ch(4, 'Mateo', talk), ...tail]);
  assert.deepEqual(r.notes.map((n) => [n.from, n.to]), [[1, 3], [1, 3], [1, 1]]); // and Kevin, away five chapters
  assert.match(r.notes[0].text, /^Chapter 2 to Chapter 4: three dialogue-heavy chapters in a row\./);
  assert.match(r.notes[1].text, /three fast chapters with no breather/);
  // a breather the writer marks breaks a run
  const broken = S.bookShape([ch(1, 'Owen', prose), ch(2, 'Kevin', talk), ch(3, 'Andre', talk, 'breather'), ch(4, 'Mateo', talk), ...tail]);
  assert.ok(!broken.notes.some((n) => /fast chapters/.test(n.text)));
});

test('the narrator who has been away longest', () => {
  const book = [ch(1, 'Kevin', prose), ch(2, 'Owen', prose), ch(3, 'Andre', prose), ch(4, 'Owen', prose), ch(5, 'Andre', prose), ch(6, 'Owen', prose)];
  const r = S.bookShape(book);
  assert.deepEqual(r.narrators.map((n) => [n.name, n.gap]), [['Kevin', 5], ['Andre', 1], ['Owen', 0]]);
  assert.match(r.notes.pop().text, /^Kevin hasn’t narrated since Chapter 1, five chapters ago\./);
  assert.equal(S.bookShape(book.slice(0, 3)).notes.length, 0, 'not worth saying yet');
  assert.equal(S.bookShape([ch(1, '', prose)]).narrators.length, 0);
});

test('an empty book has no shape and no complaints', () => {
  assert.deepEqual(S.bookShape([]), { rows: [], median: 0, narrators: [], notes: [] });
  assert.equal(S.bookShape([ch(1, '', '')]).rows[0].pace, 'steady');
});
