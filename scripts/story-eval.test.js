'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../tools/story-eval.js');

test('lift: picks that match beat the same picks shuffled', () => {
  const actual = [new Set(['short']), new Set(['long']), new Set(['short']), new Set(['long'])];
  const good = E.lift(['short', 'long', 'short', 'long'], actual);
  assert.equal(good.hit, 1);
  assert.ok(good.chance > 0.3 && good.chance < 0.7);
  assert.ok(good.lift > 0.3);
  const lucky = E.lift(['short', 'short', 'short', 'short'], actual);
  assert.equal(lucky.lift, 0, 'one pick everywhere gains nothing from reading');
  assert.equal(E.lift([], []).hit, null);
});

test('a run against a fake model writes a report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-eval-'));
  const ctx = 'He walked to the door. He walked to the window. He walked to the chair. He sat.';
  fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify([
    { id: 'b1', split: 'dev', context: ctx, next: 'Nothing.' },
    { id: 'b2', split: 'dev', context: ctx, next: 'He looked out across the long grey fields and the river beyond them, where the barges went slowly down to the grey sea every single morning before the town had even begun to wake and stir.' },
    { id: 'b3', split: 'test', context: ctx, next: 'No.' }
  ]));
  const asked = [];
  const decider = {
    warm: async () => {},
    decide: async (req) => {
      asked.push(req);
      return { answers: { next: { type: 'choice', choice: asked.length === 1 ? 'short' : 'long', confidence: 0.55 } } };
    }
  };
  const s = await E.run({ dir, split: 'dev', decider, log: () => {} });
  assert.equal(asked.length, 2, 'dev only');
  assert.equal(asked[0].model, 'winnow:e4b');
  assert.equal(s.byThreshold.find((t) => t.min === 0.5).hit, 1);
  assert.equal(s.byThreshold.find((t) => t.min === 0.6).n, 0);
  assert.match(fs.readFileSync(path.join(dir, 'report-dev.md'), 'utf8'), /\| ≥ 0\.5 \| 100% \(2\) \| 100% \|/);
  await assert.rejects(E.run({ dir, split: 'train', decider, log: () => {} }), /No boundaries/);
});
