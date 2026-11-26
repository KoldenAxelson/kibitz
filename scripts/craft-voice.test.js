'use strict';

// craft/voice.js: who says each line, and how each speaker sounds.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const V = require('../craft/voice.js');

const scene = [
  'He wanted to sit down.',
  '"Maybe," Owen said. "I don\'t know, I guess so. I\'m not sure it\'s worth it, honestly, but maybe."',
  'Kevin shrugged. "No."',
  '"Why not?" she asked.',
  '"Because," said Andre Silva.',
  'The Sergeant laughed. He liked that. "Again."',
  'The door opened. "Who\'s there?"',
  'Kevin said, "Count them. Twice."'
].join('\n');

test('speakers from tags, beats and the paragraph', () => {
  assert.deepEqual(V.lines(scene).map((l) => [l.text, l.speaker, l.how]), [
    ['Maybe,', 'Owen', 'tag'],
    ['I don\'t know, I guess so. I\'m not sure it\'s worth it, honestly, but maybe.', 'Owen', 'paragraph'],
    ['No.', 'Kevin', 'beat'],
    ['Why not?', 'she', 'tag'],
    ['Because,', 'Andre Silva', 'tag'],
    ['Again.', 'the Sergeant', 'beat'],
    ['Who\'s there?', null, null],
    ['Count them. Twice.', 'Kevin', 'tag']
  ]);
});

test('line offsets cover the quotation marks', () => {
  for (const l of V.lines(scene)) assert.match(scene.slice(l.start, l.end), /^".*"$/);
});

test('profiles: contractions, hedges, questions, sentence length', () => {
  const owen = V.profile(['I don\'t know, I guess so. I\'m not sure it\'s worth it, honestly, maybe.', 'Maybe?']);
  assert.equal(owen.sentences, 3);
  assert.ok(owen.contractionsPer100 > 10);
  assert.ok(owen.hedgesPer100 > 0);
  assert.equal(owen.questionShare, 1 / 3);
  const empty = V.profile('');
  assert.equal(empty.words, 0);
  assert.equal(empty.meanSentence, 0);
});

test('by speaker, named speakers only, and a comparison', () => {
  const by = V.bySpeaker(scene);
  assert.deepEqual([...by.keys()], ['Owen', 'Kevin', 'Andre Silva', 'the Sergeant']);
  assert.equal(by.get('Kevin').lines.length, 2);
  const gap = V.compare(by.get('Owen').profile, by.get('Kevin').profile);
  assert.ok(gap.sentenceGap > 3);
  assert.ok(gap.contractionGap > 0);
  assert.equal(gap.sharedTopWords, 0);
  assert.equal(V.compare(by.get('Owen').profile, by.get('Owen').profile).sharedTopWords, 1);
});
