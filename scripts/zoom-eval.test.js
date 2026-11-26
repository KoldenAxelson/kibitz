'use strict';

// tools/zoom-eval.js, the zoom evaluation harness, against a fake decider:
// it reads labels, refuses to run without them, and reports closeness.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { run, parseLabels } = require('../tools/zoom-eval.js');

function workspace(labels) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kibitz-zoom-eval-'));
  fs.writeFileSync(path.join(dir, 'paragraphs.json'), JSON.stringify([
    { id: 'p01', source: 'Test', sentences: ['The kettle clicked.', 'Mornings went like that.', 'Grief is a habit.'] },
    { id: 'p02', source: 'Test', sentences: ['A door.', 'A hall.'] }
  ]));
  fs.writeFileSync(path.join(dir, 'labels.md'), labels);
  return dir;
}
// A decider that answers every score question with level `n` (1-5).
const fakeDecider = (byModel) => ({
  warm: async (model) => { if (!byModel[model]) throw Object.assign(new Error('not installed'), { code: 'MODEL_NOT_FOUND' }); return {}; },
  decide: async ({ model, questions }) => {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) {
      const i = Number(id.slice(1));
      const level = byModel[model][i % byModel[model].length];
      answers[id] = q.type === 'choice'
        ? { type: 'choice', choice: String(level), confidence: 0.5, probabilities: { [String(level)]: 1 } }
        : { type: 'score', score: level - 1, confidence: 0.5 };
    }
    return { model, answers, dropped: [] };
  }
});

test('labels: one per sentence, empty for undecided', () => {
  const m = parseLabels('# x\n\n## p01: A\n\n[1] a\n[ ] b\n[4.5] c\n\n## p02: B\n[2] d\n');
  assert.deepEqual([...m], [['p01', [1, null, 4.5]], ['p02', [2]]]);
});

test('no labels, no run: the models stay unseen', async () => {
  const dir = workspace('## p01: T\n[ ] a\n[ ] b\n[ ] c\n## p02: T\n[ ] d\n[ ] e\n');
  await assert.rejects(run({ dir, decider: fakeDecider({ m: [3] }), models: ['m'], log: () => {} }), /No labels yet/);
});

test('a label count that doesn\'t match the sentences is caught', async () => {
  const dir = workspace('## p01: T\n[1] a\n[3] b\n## p02: T\n[1] d\n[2] e\n');
  await assert.rejects(run({ dir, decider: fakeDecider({ m: [3] }), models: ['m'], log: () => {} }), /p01: 2 labels for 3 sentences/);
});

test('closeness per model and way of asking, best first, with a report', async () => {
  const dir = workspace('## p01: T\n[1] a\n[3] b\n[5] c\n## p02: T\n[1] d\n[2] e\n');
  const rows = await run({ dir, decider: fakeDecider({ close: [1, 3, 5], flat: [3, 3, 3] }), models: ['close', 'flat', 'missing'], variants: ['paragraph', 'choice'], log: () => {} });
  assert.deepEqual(rows.map((r) => `${r.model}/${r.variant}`).slice(0, 2).sort(), ['close/choice', 'close/paragraph']);
  const best = rows[0];
  assert.equal(best.raw.distance, 0.2, 'one sentence of five a level off: p02 is labelled 1, 2 and answered 1, 3');
  assert.equal(best.raw.paragraphs, 1);
  assert.deepEqual(best.raw.flagAgree, { endsClose: 1, neverDown: 1, onlyBack: 1 });
  assert.ok(!rows.some((r) => r.model === 'missing'), 'a model that isn\'t installed is skipped');
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(report, /\| close \| (paragraph|choice) \|/);
  assert.match(report, /Closest: \*\*close\*\*/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).levels['flat / paragraph']);
});
