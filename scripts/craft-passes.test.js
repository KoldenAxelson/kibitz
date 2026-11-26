'use strict';

// craft/passes.js: the eight revision passes. One test each for what a
// pass finds and what it lets be, plus the promises every pass keeps:
// offsets inside the text, a note on every finding, the same answer twice.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const P = require('../craft/passes.js');

const run = (key, text) => P.run(key, text);
const labels = (key, text) => run(key, text).findings.map((f) => f.label);
const marked = (key, text) => run(key, text).findings.map((f) => (f.start === null ? null : text.slice(f.start, f.end)));

const CHAPTER = [
  'The bus came late that morning, and nobody on it complained.',
  'He walked to the mess hall. He got a tray and sat down with it. He saw the screen on the wall and the score was there again.',
  '"Maybe," Owen said softly. "I don\'t know. I guess I\'m not sure it\'s worth it, honestly."',
  '"No," Kevin exclaimed.',
  'Owen, Kevin, Andre and Mateo met Sergeant Hale at the gate. A smile tugged at her lips, she thought. Her blue eyes widened.',
  'In the back of the room behind the desk near the window, it was to be a long night.'
].join('\n');

test('the passes, in menu order, each with a label and a line about it', () => {
  assert.deepEqual(P.PASSES.map((p) => p.key), ['cut', 'rhythm', 'echoes', 'pov', 'clutter', 'dialogue', 'description', 'time']);
  for (const p of P.PASSES) assert.ok(p.label && p.about);
  assert.throws(() => run('nope', 'x'), /No such pass/);
});

test('every pass keeps its promises', () => {
  for (const { key } of P.PASSES) {
    const a = run(key, CHAPTER);
    assert.deepEqual(run(key, CHAPTER), a, `${key} is the same twice`);
    assert.ok(a.summary.length && a.summary.every((l) => /^[A-Z0-9]/.test(l)), `${key} summary`);
    for (const f of a.findings) {
      assert.ok(f.label && f.note, `${key}: label and note`);
      if (f.start === null) continue;
      assert.ok(f.start >= 0 && f.end <= CHAPTER.length && f.start < f.end, `${key}: ${f.label} in bounds`);
      for (const m of f.marks || []) assert.ok(m.start >= f.start && m.end <= f.end && m.start < m.end, `${key}: ${f.label} marks inside`);
    }
    for (const empty of ['', 'One.']) assert.doesNotThrow(() => run(key, empty), `${key} on ${JSON.stringify(empty)}`);
  }
});

test('Words to Cut: the table, with a rate per thousand words', () => {
  const r = run('cut', 'He suddenly realized that he just really wanted something, maybe.');
  assert.deepEqual(r.findings.map((f) => f.label), ['Time', 'Filter', 'Weasel', 'Weasel', 'Inflation', 'Empty', 'Hedge']);
  assert.match(r.summary[0], /^7 marks in 10 words: 700 per thousand\.$/);
});

test('Rhythm: same-length runs, subject-first runs, same openings, weak landings', () => {
  const runText = 'The base had a pool that nobody ever swam in. The fences on Row Nine were painted white. Owen counted the containers on the way back. Kevin had eaten and gone back to work already.';
  assert.ok(labels('rhythm', runText).includes('Same length'));
  assert.ok(labels('rhythm', runText).includes('Subject first'));
  const he = run('rhythm', 'He walked in. He sat. He ate it.');
  const same = he.findings.find((f) => f.label === 'Same opening');
  assert.equal(same.marks.length, 3);
  assert.ok(he.findings.some((f) => f.label === 'Weak landing' && f.note.includes('“it”')));
  assert.ok(run('rhythm', 'Short one. Then another.').summary.some((l) => l.startsWith('Shapes used: short')));
  assert.ok(run('rhythm', 'Every sentence here has four words or more in it.').summary.includes('Nothing under four words in the whole chapter. Add one.'));
});

test('Echoes: every use marked, names left alone', () => {
  const r = run('echoes', 'The container was hot. Owen sat in the container. Owen slept.');
  assert.deepEqual(r.findings.map((f) => f.label), ['“container” ×2']);
  assert.equal(r.findings[0].marks.length, 2);
});

test('Point of View: thought tags, filters, faces, and never inside speech', () => {
  assert.deepEqual(marked('pov', 'A smile tugged at her lips, she thought. He saw the gate. "I saw it," Owen said.'),
    ['smile tugged at her lips', 'she thought', 'He saw']);
  assert.match(run('pov', 'I went. I saw. He stayed.').summary[0], /first person/);
});

test('Clutter: chains, tiny words, doubled, trips between rooms', () => {
  assert.deepEqual(labels('clutter', 'He walked to the kitchen. She nodded her head. In the back of the room behind the desk near the window, it was to be a long night.'),
    ['Just a trip', 'Doubled', 'Preposition chain', 'Tiny words']);
  // a trip that does something else too is a scene, not clutter
  assert.deepEqual(labels('clutter', 'He walked to the kitchen and burned the toast.'), []);
});

test('Dialogue: beats, floating voices, adverbs, loud tags', () => {
  const beats = ['Owen shrugged. "Go."', 'Kevin frowned at him. "No."', 'Owen leaned back in his chair. "Fine."', 'Kevin picked up his tray. "Good."'].join('\n');
  assert.deepEqual(labels('dialogue', beats), ['A beat on every line']);
  const floating = ['"Go."', '"No."', '"Fine."', '"Good."'].join('\n');
  assert.deepEqual(labels('dialogue', floating), ['Floating voices']);
  assert.deepEqual(marked('dialogue', '"Maybe," Owen said softly. "No," Kevin exclaimed.'), ['said softly', 'exclaimed']);
  assert.deepEqual(labels('dialogue', '"Only," he said only.'), []);
});

test('Dialogue: speakers who sound alike are named, about the whole chapter', () => {
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(`"We should check the fence line before the count tonight," Owen said.`);
    lines.push(`"We should check the gate lights before the count tonight," Kevin said.`);
  }
  const alike = run('dialogue', lines.join('\n')).findings.find((f) => f.label === 'Sound alike');
  assert.ok(alike);
  assert.equal(alike.start, null);
  assert.match(alike.note, /^Owen and Kevin sound alike/);
});

test('Description: a silent opening, sight only, eye and hair colour', () => {
  const silent = 'The fences ran white down the row. '.repeat(50) + '\n"Morning," Owen said.';
  assert.deepEqual(labels('description', silent).slice(0, 1), ['A silent opening']);
  const seen = 'The light was pale on the white fences, and the dark shadows of the containers lay gray across the row where the men looked at the bright screens that glowed above the gate, and nobody looked away from them or blinked at all.';
  assert.deepEqual(labels('description', seen), ['Only sight']);
  assert.deepEqual(labels('description', seen.replace('nobody looked away', 'a generator hummed and nobody looked away')), []);
  assert.deepEqual(marked('description', 'She had blue eyes. Her hair was a dull brown.'), ['blue eyes', 'hair was a dull brown']);
});

test('Time and Cast: when we are, and new names a paragraph at a time', () => {
  assert.deepEqual(labels('time', 'The bus came. Owen got on.'), ['When are we?']);
  assert.deepEqual(labels('time', 'The bus came late that morning. Owen got on.'), []);
  const crowd = 'That night Owen and Kevin waited.\nThen Andre, Mateo and Sergeant Hale came to see Owen.';
  const r = run('time', crowd);
  assert.deepEqual(r.findings.map((f) => f.label), ['Too many new names']);
  assert.match(r.findings[0].note, /^Three new names in one paragraph: Andre, Mateo, Sergeant Hale\./);
  assert.match(r.summary[0], /^Names: Owen 2, Kevin 1, Andre 1/);
});

test('names: never a sentence\'s ordinary first word', () => {
  const found = P.names('The gate opened. Owen saw the gate. The dog barked at Owen.', require('../craft/text.js').sentences('The gate opened. Owen saw the gate. The dog barked at Owen.'));
  assert.deepEqual([...new Set(found.map((n) => n.name))], ['Owen']);
});
