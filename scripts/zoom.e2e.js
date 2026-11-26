// The Zoom pass (app/passes.js with craft/zoom.js and decide.js) in the real
// window, against a fake Ollaya: Kibitz says the model is waking, asks one
// question per paragraph of three sentences or more, flags the curves that
// go wrong with the paragraph's curve drawn beside them, asks again only
// about what changed, and explains in the panel when the model is missing
// or Ollaya isn't there. Never starts a real Ollaya. Run with
// `npm run test:e2e -- zoom` (OUT=<folder> keeps a picture).

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-zoom-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'Kibitz Library'));
fs.writeFileSync(path.join(tmp, 'Kibitz Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', features: { passes: true },
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));

// A fake Ollaya: a sentence's level comes from a word in it (Detail 1,
// Middle 3, Idea 5); the first answer is slow, like a model loading.
const seen = [];
const fake = { mode: 'ok', first: true };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET') { res.end('Ollaya is running'); return; }
    const body = JSON.parse(raw);
    seen.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (fake.mode === 'missing') { res.statusCode = 404; res.end(JSON.stringify({ error: 'model not found', code: 'MODEL_NOT_FOUND' })); return; }
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      const level = /Detail/.test(q.instructions) ? 1 : /Idea/.test(q.instructions) ? 5 : 3;
      answers[id] = { type: 'score', score: level - 1, confidence: 0.7 };
    }
    setTimeout(() => res.end(JSON.stringify({ model: body.model, answers })), fake.first ? 1500 : 30);
    fake.first = false;
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

const PARAS = [
  'Idea sentence about the whole world is here. Middle sentence about a thing. Detail at the very end.',
  'Idea one stays high above it all. Idea two stays high above it all. Idea three stays high above it all.',
  'Two sentences only. Detail too short to judge.',
  'Middle sentence opens it. Detail in the middle. Idea to close it out.'
];

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const menu = async (pass) => { wc.send('menu', { type: 'revisionPass', pass }); await tick(200); };
const panel = () => js(`(() => {
  const el = document.querySelector('.kibitz-pass');
  return el && { labels: [...el.querySelectorAll('.kp-label')].map((x) => x.textContent), summary: [...el.querySelectorAll('.kp-summary p')].map((p) => p.textContent),
    curves: el.querySelectorAll('.kp-curve').length, marks: CSS.highlights.get('kibitz-pass')?.size || 0 };
})()`);
const until = async (test, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await test(); if (v) return v; await tick(100); } return null; };
const shot = async (name) => { if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage()).toPNG()); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Zoom is on the Revision Pass menu', async () => {
  const edit = Menu.getApplicationMenu().items.find((m) => m.label === 'Edit');
  assert.ok(edit.submenu.items.find((m) => m.label === 'Revision Pass').submenu.items.some((m) => m.label === 'Zoom'));
});

test('the model wakes, then each paragraph is read and the wrong curves flagged', async () => {
  await menu('zoom');
  const waking = await panel();
  assert.match(waking.summary[0], /Waking the local model/);
  const done = await until(async () => { const p = await panel(); return p && p.curves === 3 && !p.summary.length && p; });
  assert.ok(done, 'the findings arrive, and no status or explanation is left in the panel');
  assert.deepEqual(done.labels, ['Ends on the close-up', 'Never comes down'], 'the fine paragraph has no label');
  assert.equal(done.curves, 3, 'every paragraph read draws its curve; the two-sentence one is left out');
  assert.equal(done.marks, 2, 'only flagged sentences are underlined');
  assert.equal(await js(`document.querySelectorAll('.kibitz-pass .kp-about').length`), 0);
  assert.equal(seen.length, 3, 'one question per paragraph read');
  assert.ok(seen.every((b) => b.model === 'winnow:e4b' && Object.keys(b.questions).length === 3));
  await shot('zoom.png');
});

test('an edit asks again only about the paragraph that changed', async () => {
  const before = seen.length;
  await js(`(() => {
    const p = document.querySelectorAll('.chapter-body')[0].children[3];
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    p.closest('.chapter-body').focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  for (const k of ' Detail again.') {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  const after = await until(async () => (seen.length > before ? seen.length : null), 6000);
  await tick(800);
  assert.equal(after - before, 1);
  assert.equal(seen.length - before, 1);
  const p = await until(async () => { const v = await panel(); return v && v.labels.filter((l) => l === 'Ends on the close-up').length === 2 && v; });
  assert.ok(p, 'the edited paragraph now ends on a detail too');
  await js(`document.querySelectorAll('.kibitz-pass .kp-curve circle')[1].dispatchEvent(new MouseEvent('mouseenter'))`);
  assert.equal(await js(`String(CSS.highlights.get('kibitz-pass-current')?.values().next().value)`), 'Middle sentence about a thing.', 'pointing at a dot lights its sentence');
});

test('a missing model is explained in the panel', async () => {
  fake.mode = 'missing';
  await menu(null);
  await js(`zoomCache.clear()`);
  await menu('zoom');
  const p = await until(async () => { const v = await panel(); return v && /needs the winnow:e4b model/.test(v.summary[0]) && v; });
  assert.ok(p);
  fake.mode = 'ok';
});

test('no Ollaya at all is explained too, and nothing is started', async () => {
  await menu(null);
  await new Promise((resolve) => server.close(resolve));
  server.closeAllConnections?.();
  await js(`zoomCache.clear()`);
  await menu('zoom');
  const p = await until(async () => { const v = await panel(); return v && /Zoom needs Ollaya/.test(v.summary[0]) && v; }, 30000);
  assert.ok(p);
  assert.match(p.summary[0], /isn’t installed/);
});

test('ending the pass ends it', async () => {
  await menu(null);
  assert.equal(await panel(), null);
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
    win.setBounds({ width: 1400, height: 860 });
    await tick(600);
    await js(`(async () => {
      await addImportedBooks([{ name: 'Zoom Test', chapters: [{ title: 'One', paras: ${JSON.stringify(PARAS.map((text) => ({ text })))} }] }], library.shelves[0]);
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
