'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../tools/story-eval.js');

const rows = [
  { chances: { reveal: 0.9 }, truth: ['reveal'] },
  { chances: { reveal: 0.7 }, truth: ['reveal'] },
  { chances: { reveal: 0.6 }, truth: [] },
  { chances: { reveal: 0.2 }, truth: ['reveal'] },
  { chances: { reveal: 0.1 }, truth: [] }
];

test('score: precision and recall at a cut', () => {
  const s = E.score(rows, 'reveal', 0.65);
  assert.equal(s.tp, 2);
  assert.equal(s.precision, 1);
  assert.ok(Math.abs(s.recall - 2 / 3) < 1e-9);
  assert.equal(E.score(rows, 'reveal', 0.95).precision, null);
});

test('the dev cut: best F1 among those clearing the bar', () => {
  const c = E.chooseCut(rows, 'reveal');
  assert.ok(c.precision >= 0.6 && c.recall >= 0.4);
  assert.ok(c.cut > 0.1 && c.cut <= 0.2, 'catching all three, one wrong, beats missing one');
  assert.equal(E.passes({ yes: 7, precision: 1, recall: 1 }), false, 'too few to judge');
  assert.equal(E.passes({ yes: 8, precision: 0.6, recall: 0.4 }), true);
});

test('dev writes the cuts, test reads them and asks nothing new', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-eval-'));
  const ctx = 'Someone knocked. The door began to open.';
  fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify([
    { id: 'b1', split: 'dev', context: ctx }, { id: 'b2', split: 'dev', context: 'He sat. He read the paper slowly.' },
    { id: 'b3', split: 'test', context: ctx }
  ]));
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ b1: ['reveal'], b2: [], b3: ['reveal'] }));
  const asked = [];
  const decider = {
    warm: async () => {},
    decide: async (req) => {
      asked.push(req);
      const open = /open/.test(req.state);
      return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { type: 'choice', choice: k === 'reveal' && open ? 'yes' : 'no', confidence: 0.8 }])) };
    }
  };
  await assert.rejects(E.run({ dir, split: 'test', decider, log: () => {} }), /dev split first/);
  const dev = await E.run({ dir, split: 'dev', decider, log: () => {} });
  assert.equal(asked.length, 2);
  assert.equal(Object.keys(asked[0].questions).length, 9, 'all nine readings in one request');
  const cuts = JSON.parse(fs.readFileSync(path.join(dir, 'thresholds.json'), 'utf8'));
  assert.equal(cuts.reveal, dev.find((r) => r.key === 'reveal').cut);
  const t = await E.run({ dir, split: 'test', decider, timeOnly: ['landed'], log: () => {} });
  assert.deepEqual(Object.keys(asked[asked.length - 1].questions), ['landed'], 'then a timing pass asking only what could ship');
  assert.equal(t.find((r) => r.key === 'reveal').tp, 1);
  assert.match(fs.readFileSync(path.join(dir, 'report-test.md'), 'utf8'), /Cuts fixed from the dev split[\s\S]*Asking only landed:/);
});

test('ladders: a level per reading from five comparisons, the cut fixed at 3, ladder sources left out', async () => {
  const L = require('../craft/ladders.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ladder-'));
  fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify([
    { id: 'x1', split: 'test', context: 'The door began to open.' }, { id: 'x2', split: 'test', context: 'He read the paper.' },
    { id: L.SOURCES[0], split: 'test', context: 'A rung.' }
  ]));
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ x1: ['reveal'], x2: [] }));
  const asked = [];
  const decider = {
    warm: async () => {},
    decide: async (req) => {
      asked.push(req);
      const open = /door began/.test(req.state) && /about to be shown/.test(req.questions.r1.instructions);
      return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, { type: 'choice', choice: open && k !== 'r5' ? 'yes' : 'no', confidence: 0.9 }])) };
    }
  };
  const res = await E.runLadders({ dir, split: 'test', decider, log: () => {} });
  assert.equal(asked.length, 18, 'two moments × nine ladders; the source left out');
  const reveal = res.find((r) => r.key === 'reveal');
  assert.equal(reveal.tp, 1);
  assert.equal(reveal.said, 1);
  assert.equal(reveal.auc, 1);
  assert.match(fs.readFileSync(path.join(dir, 'report-ladder-test.md'), 'utf8'), /level ≥ 3 of 5/);
  assert.equal(E.auc([{ truth: ['a'], s: 2 }, { truth: [], s: 1 }], 'a', (r) => r.s), 1);
});
