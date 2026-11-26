'use strict';

// The craft modules load in the window as plain scripts (no require), in
// index.js's order, and hang off window.KibitzCraft.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ORDER = ['text', 'shapes', 'cut', 'echoes', 'landings', 'voice', 'suggest', 'lexicon', 'passes', 'scenes'];

test('every module loads as a script and works from window.KibitzCraft', () => {
  const window = {};
  window.globalThis = window;
  const context = vm.createContext(window);
  for (const name of ORDER) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'craft', name + '.js'), 'utf8');
    vm.runInContext(src, context, { filename: name + '.js' });
  }
  assert.deepEqual(Object.keys(window.KibitzCraft), ORDER);
  const K = window.KibitzCraft;
  assert.equal(K.text.sentences('One. Two.').length, 2);
  assert.ok(K.shapes.shapesOf('Then my assignments.').has('short'));
  assert.equal(K.cut.find('Really.').counts.inflation, 1);
  assert.equal(K.voice.lines('"Go," Owen said.')[0].speaker, 'Owen');
  assert.equal(K.passes.run('cut', 'Really.').findings.length, 1);
  assert.equal(K.scenes.bookShape([{ id: 'a', name: 'One', text: 'Words here.' }]).rows[0].words, 2);
  assert.equal(K.suggest.suggest(K.text.sentences('He stopped. He looked. He sat.')).rule, 'threeShort');
});

test('index.js lists the same modules in the same order', () => {
  const index = require('../craft');
  assert.deepEqual(Object.keys(index), ORDER);
});
