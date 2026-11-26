// The sentence shape suggester (app/suggester.js) in the real window: a
// finished sentence and a pause bring the gray line, with the rule's
// advice; the next key takes it away; it never reaches the chapter on
// disk; it stays quiet with the feature off, in the middle of the writing,
// and while a rule is cooling down. Run with `npm run test:e2e -- suggester`
// (OUT=<folder> keeps a picture of the line on the page).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-suggester-test-${process.pid}-`));
const LIB = path.join(tmp, 'Kibitz Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  features: { suggester: true },
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
const errors = [];
app.on('web-contents-created', (_e, contents) => {
  contents.on('console-message', (...args) => {
    const msg = typeof args[0] === 'object' && args[0] && 'message' in args[0] ? args[0].message : args[2];
    if (/Uncaught|is not defined|before initialization/.test(String(msg))) errors.push(String(msg));
  });
});
require('../main.js');

const PAUSE = 2600; // the suggester waits 1.8s after the last key
const THREE = 'The base had a pool that nobody ever swam in during the summer. The fences on Row Nine were all painted white by the same men. Owen counted the containers on his way to the mess hall again.';
const FOURTH = ' Kevin had already eaten his lunch and gone back to work.';

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function type(keys) {
  for (const k of keys) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  await tick(200);
}
// the chapter set to these paragraphs, the caret at the end of paragraph `at`
async function page(paras, at = paras.length - 1) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.innerHTML = ${JSON.stringify(paras)}.map((t) => '<p>' + t + '</p>').join('');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${at}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    suggestLast = null;
  })()`);
  await tick(100);
}
const line = () => js(`(() => { const el = document.querySelector('.kibitz-suggest'); return el ? el.textContent : null; })()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a finished sentence and a pause bring the line, with its reason', async () => {
  await page([THREE]);
  await type(FOURTH);
  assert.equal(await line(), null, 'nothing while typing');
  await tick(PAUSE);
  assert.equal(await line(), 'Try a short one. Your last four sentences all ran 11 to 13 words.');
  const under = await js(`(() => {
    const el = document.querySelector('.kibitz-suggest');
    const p = document.querySelector('.chapter-body p');
    return el.getBoundingClientRect().top >= p.getBoundingClientRect().bottom - 1 && !document.querySelector('.chapter-body').contains(el);
  })()`);
  assert.ok(under, 'under the paragraph, and outside the text');
  if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, 'suggester.png'), (await wc.capturePage()).toPNG());
});

test('the next key takes it away', async () => {
  await type('H');
  assert.equal(await line(), null);
});

test('it never reaches the saved chapter', async () => {
  await page([THREE]);
  await type(FOURTH);
  await tick(PAUSE);
  assert.ok(await line());
  assert.ok(!(await js(`captureBody(document.querySelector('.chapter-body'))`)).includes('kibitz-suggest'));
  await js(`flushAllSaves()`);
  await tick(800);
  const files = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.html')) files.push(p); } };
  walk(LIB);
  const saved = files.map((f) => fs.readFileSync(f, 'utf8')).find((h) => h.includes('Kevin had already'));
  assert.ok(saved, 'the chapter was saved');
  assert.ok(!saved.includes('kibitz-suggest') && !saved.includes('Try a short one'));
});

test('a rule waits its turn before it speaks again', async () => {
  await page([THREE]);
  await type(FOURTH);
  await tick(PAUSE);
  assert.ok(await line());
  await type(' Owen walked back to the long row of containers.');
  await tick(PAUSE);
  assert.equal(await line(), null);
});

test('quiet in the middle of the writing: a paragraph below', async () => {
  await page([THREE, 'A paragraph already written below.'], 0);
  await type(FOURTH);
  await tick(PAUSE);
  assert.equal(await line(), null);
});

test('quiet mid-sentence', async () => {
  await page([THREE + FOURTH.replace(/\.$/, '')]);
  await type(' and');
  await tick(PAUSE);
  assert.equal(await line(), null);
});

test('quiet with the feature off', async () => {
  await js(`library.features.suggester = false`);
  await page([THREE]);
  await type(FOURTH);
  await tick(PAUSE);
  assert.equal(await line(), null);
  await js(`library.features.suggester = true`);
});

test('no uncaught errors', async () => {
  assert.deepEqual(errors, []);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.features`).catch(() => false))) await tick(50);
    win.setBounds({ width: 1100, height: 800 });
    await tick(600);
    await js(`(async () => {
      await addImportedBooks([{ name: 'Suggester Test', chapters: [{ title: 'One', paras: [{ text: 'Start.' }] }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(1000);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message || err).split('\n').join('\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
