'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function spellWorker() {
  let handle, reply;
  const context = vm.createContext({
    require: localRequire,
    process: { parentPort: {
      on: (_name, callback) => { handle = callback; },
      postMessage: (message) => { reply = message; }
    } }
  });
  // The string is the file on disk. filename is how Node attributes coverage to it.
  vm.runInContext(source('spell-worker.js'), context, { filename: path.join(root, 'spell-worker.js') });
  let id = 0;
  const waiting = new Map();
  reply = null;
  // the worker answers asynchronously and in order
  context.process.parentPort.postMessage = (message) => {
    const done = waiting.get(message.id);
    waiting.delete(message.id);
    if (done) done(message);
  };
  return (message) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, (m) => { assert.equal(m.id, n); resolve(m); });
    handle({ data: { id: n, ...message } });
  });
}

test('a book opened again is checked again: new pages, the same chapter ids', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'en-US', dir: path.join(root, 'node_modules/dictionary-en-us') })).ok, true);
  const pageWith = (text) => ({ node: { data: text, nodeType: 3, isConnected: true } });
  let page = pageWith('a frgament');
  class TextRange {
    setStart(node, offset) { this.node = node; this.start = offset; }
    setEnd(_node, offset) { this.end = offset; }
    toString() { return this.node.data.slice(this.start, this.end); }
  }
  const highlights = new Map();
  const context = vm.createContext({
    document: {
      addEventListener() {},
      createTreeWalker: (el) => {
        let node = el.node;
        return { nextNode: () => { const next = node; node = null; return next; } };
      },
      querySelector: (selector) => selector.startsWith('.chapter[') ? page : null
    },
    Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 }, Range: TextRange,
    Highlight: Set, CSS: { highlights }, t: (text) => text, toast() {},
    currentTab: 'manuscript', currentChapterId: 'ch-test', library: {},
    window: { kibitz: { spellCheckWords: async (words) => (await send({ type: 'check', words })).result } }
  });
  const app = require('./app-files').appSource();
  vm.runInContext(app.slice(app.indexOf('let spellOn = false;'), app.indexOf('let typewriterEnabled = false;')), context);
  vm.runInContext('spellOn = true;', context);
  await vm.runInContext('spellScanEl(spellElFor("ch-test"), "ch-test")', context);
  const flagged = () => [...highlights.get('kibitz-spell')].map((range) => [range.node, range.toString()]);
  assert.deepEqual(flagged(), [[page.node, 'frgament']]);
  // back to the shelf and open the book again: the chapter is a new page
  page.node.isConnected = false;
  page = pageWith('another frgament');
  vm.runInContext('forgetSpelling(); scanSpellingHere();', context);
  await new Promise(setImmediate);
  assert.deepEqual(flagged(), [[page.node, 'frgament']]);
  // openBook is where it happens
  const open = app.slice(app.indexOf('async function openBook('));
  assert.match(open.slice(0, open.indexOf('\n}\n')), /forgetSpelling\(\)/);
});

test('hyphenated words: the whole word first, then only the wrong pieces', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'en-US', dir: path.join(root, 'node_modules/dictionary-en-us') })).ok, true);
  const node = { data: 'An e-mail, a well-known x-ray, a well-knwon one, and NASA-style flair.', nodeType: 3, isConnected: true };
  const el = { node };
  class TextRange {
    setStart(n, offset) { this.node = n; this.start = offset; }
    setEnd(_n, offset) { this.end = offset; }
    toString() { return this.node.data.slice(this.start, this.end); }
  }
  const highlights = new Map();
  const context = vm.createContext({
    document: {
      addEventListener() {},
      createTreeWalker: () => { let n = node; return { nextNode: () => { const x = n; n = null; return x; } }; }
    },
    NodeFilter: { SHOW_TEXT: 4 }, Range: TextRange, Highlight: Set, CSS: { highlights },
    $: () => null, t: (text) => text, tk: (text) => text, toast() {},
    window: { kibitz: { spellCheckWords: async (words) => (await send({ type: 'check', words })).result } }
  });
  const app = require('./app-files').appSource();
  vm.runInContext(app.slice(app.indexOf('let spellOn = false;'), app.indexOf('let typewriterEnabled = false;')), context);
  context.el = el;
  await vm.runInContext('spellOn = true; spellScanEl(el, "ch-test")', context);
  assert.deepEqual([...highlights.get('kibitz-spell')].map((r) => r.toString()), ['knwon']);
});
