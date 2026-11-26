// The suggester's story layer (craft/story.js in app/suggester.js) in the
// real window, against a fake Ollaya: with the rhythm layer quiet, the
// pause asks the model, and a sure pick becomes the line, its reason the
// story's; the narrator goes with the question; a real rhythm problem is
// named without asking; a "none" or a missing Ollaya leaves silence;
// typing while the model thinks abandons the question; the first keystroke
// wakes the model; with the switch off nothing is asked. Never starts a
// real Ollaya. Run with `npm run test:e2e -- story` (OUT=<folder> keeps a
// picture).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-story-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'Kibitz Library'));
fs.writeFileSync(path.join(tmp, 'Kibitz Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', features: { suggester: true, story: true },
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));

// A fake Ollaya: answers the story question with fake.choice at
// fake.confidence after fake.delay ms; a noul question is a warm-up.
const asked = [];
const warmed = [];
const fake = { choice: 'reversal', confidence: 0.7, delay: 100 };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET') { res.end('Ollaya is running'); return; }
    const body = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    const [id, q] = Object.entries(body.questions)[0];
    if (q.type === 'noul') { warmed.push(body.model); res.end(JSON.stringify({ model: body.model, answers: { [id]: { type: 'noul', noul: 0.5, confidence: 0.5 } } })); return; }
    asked.push(body);
    setTimeout(() => {
      if (!res.writableEnded) res.end(JSON.stringify({ model: body.model, answers: { next: { type: 'choice', choice: fake.choice, confidence: fake.confidence } } }));
    }, fake.delay);
  });
});

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

const PAUSE = 2600; // the suggester waits 1.8s after the last key
// varied lengths, nothing for the rhythm layer to say
const QUIET = 'Owen stood at the gate. The bus was late again, and the driver, who never said sorry for anything, waved him on without a word. He waited.';
const QUIET_NEXT = ' Then the door opened.';
// four of one length: the rhythm layer's sameLength speaks
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
async function page(paras) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.innerHTML = ${JSON.stringify(paras)}.map((t) => '<p>' + t + '</p>').join('');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.lastElementChild);
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

test('the first keystroke wakes the model', async () => {
  await page([QUIET]);
  await type(QUIET_NEXT);
  await tick(PAUSE);
  assert.deepEqual(warmed, ['winnow:e4b']);
});

test('the rhythm layer quiet: the model picks, and its pick is the line', async () => {
  assert.equal(asked.length, 1, 'asked once, at the pause');
  assert.equal(await line(), 'Try a reversal: set it up and flip it. Something’s about to turn.');
  const q = asked[0];
  assert.equal(q.model, 'winnow:e4b');
  assert.equal(q.questions.next.type, 'choice');
  assert.match(q.state, /^Narrator: Owen\.\n/, 'the chapter\'s narrator goes with it');
  assert.match(q.state, /He waited\. Then the door opened\.$/);
  if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, 'story.png'), (await wc.capturePage()).toPNG());
});

test('a real rhythm problem is named without asking', async () => {
  const before = asked.length;
  await page([THREE]);
  await type(FOURTH);
  await tick(PAUSE);
  assert.equal(asked.length, before);
  assert.match(await line(), /^Try a short one\./);
});

test('"nothing in particular" says nothing', async () => {
  fake.choice = 'none';
  const before = asked.length;
  await page([QUIET]);
  await type(QUIET_NEXT);
  await tick(PAUSE);
  assert.equal(asked.length, before + 1);
  assert.equal(await line(), null);
  fake.choice = 'reversal';
});

test('typing while the model thinks abandons the question', async () => {
  fake.delay = 1500;
  await page([QUIET]);
  await type(QUIET_NEXT);
  await tick(2100);
  await type(' H');
  await tick(2000);
  assert.equal(await line(), null, 'the late answer is dropped');
  fake.delay = 100;
});

test('with the switch off nothing is asked', async () => {
  await js(`library.features.story = false`);
  const before = asked.length;
  await page([QUIET]);
  await type(QUIET_NEXT);
  await tick(PAUSE);
  assert.equal(asked.length, before);
  assert.equal(await line(), null);
  await js(`library.features.story = true`);
});

test('no Ollaya: silence, and the rhythm layer still speaks', async () => {
  await new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await page([QUIET]);
  await type(QUIET_NEXT);
  await tick(PAUSE + 1500);
  assert.equal(await line(), null);
  await page([THREE]);
  await type(FOURTH);
  await tick(PAUSE);
  assert.match(await line(), /^Try a short one\./);
});

test('no uncaught errors', async () => {
  assert.deepEqual(errors, []);
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.KIBITZ_DECIDE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KIBITZ_OLLAYA_BIN = path.join(tmp, 'no-ollaya-here');
  require('../main.js');
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
      await addImportedBooks([{ name: 'Story Test', chapters: [{ title: 'One', paras: [{ text: 'Start.' }] }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      book.kibitzChapters = { [document.querySelector('.chapter').dataset.id]: { narrator: 'Owen' } };
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
