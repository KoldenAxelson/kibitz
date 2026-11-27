// The writer and editor menus (app/menus.js) in the real window: hidden
// until the feature is on; ⌘J at the caret ticks and runs rhythm and Zoom
// (against a fake Ollaya) into one card that the next key puts away; ⌘K
// runs several revision passes into one panel; each menu opens with the
// last set it ran. Run with `npm run test:e2e -- menus`.
'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-menus-test-${process.pid}-`));
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
// A fake Ollaya for Zoom: a sentence's level from a word in it.
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET') { res.end('Ollaya is running'); return; }
    const body = JSON.parse(raw);
    seen.push(body);
    res.setHeader('Content-Type', 'application/json');
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      const level = /Detail/.test(q.instructions) ? 1 : /Idea/.test(q.instructions) ? 5 : 3;
      answers[id] = { type: 'score', score: level - 1, confidence: 0.7 };
    }
    setTimeout(() => res.end(JSON.stringify({ model: body.model, answers })), 300);
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
  'He walked in. She sat. He sat. They waited. Nobody spoke.',
  'Idea sentence about the whole world is here. Middle sentence about a thing very very very much. Detail at the very end.'
];

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const help = async (which) => { wc.send('menu', { type: 'helpMenu', which }); await tick(250); };
const key = async (k) => {
  const code = { Enter: 'Return', Escape: 'Escape' }[k] || k;
  wc.sendInputEvent({ type: 'keyDown', keyCode: code });
  if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k });
  wc.sendInputEvent({ type: 'keyUp', keyCode: code });
  await tick(120);
};
const menuState = () => js(`(() => { const el = document.querySelector('.kibitz-menu'); return el && [...el.querySelectorAll('li')].map((li) => (li.classList.contains('on') ? '+' : '-') + li.dataset.key); })()`);
const card = () => js(`(() => { const el = document.querySelector('.kibitz-card'); return el && [...el.querySelectorAll('.kc-row')].map((r) => ({ name: r.querySelector('.kc-name').textContent, say: r.querySelector('.kc-say').textContent, curve: !!r.querySelector('.kp-curve') })); })()`);
const until = async (test, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await test(); if (v) return v; await tick(100); } return null; };
const shot = async (name) => { if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage()).toPNG()); };
const caretAtEnd = (i) => js(`(() => {
  const p = document.querySelectorAll('.chapter-body')[0].children[${i}];
  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(false);
  p.closest('.chapter-body').focus();
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const editItems = () => Menu.getApplicationMenu().items.find((m) => m.label === 'Edit').submenu.items.map((m) => m.label);

test('hidden until switched on', async () => {
  assert.ok(!editItems().includes('Writer Menu'));
  await caretAtEnd(0);
  await help('writer');
  assert.equal(await menuState(), null, 'the message alone does nothing');
  await js(`setFeature('menus', true)`);
  await tick(400);
  assert.ok(editItems().includes('Writer Menu') && editItems().includes('Editor Menu'));
});

test('⌘J: rhythm ticked first; Enter answers in a card by the caret', async () => {
  await caretAtEnd(0);
  await help('writer');
  assert.deepEqual(await menuState(), ['+rhythm', '-zoom']);
  await key('Enter');
  assert.equal(await menuState(), null);
  const c = await until(card);
  assert.equal(c[0].name, 'Rhythm');
  assert.ok(c[0].say.length > 5, c[0].say);
  assert.ok(await js(`document.activeElement.closest('.chapter-body') !== null`), 'the caret is back on the page');
  await key('Escape');
  assert.equal(await card(), null, 'any key puts the card away');
});

test('the last set comes back ticked; a number key adds Zoom, read by the model', async () => {
  await caretAtEnd(1);
  await help('writer');
  assert.deepEqual(await menuState(), ['+rhythm', '-zoom']);
  await key('2');
  assert.deepEqual(await menuState(), ['+rhythm', '+zoom']);
  seen.length = 0;
  await key('Enter');
  const working = await until(async () => { const c = await card(); return c && c[1] && /Reading/.test(c[1].say) && c; }, 3000);
  assert.ok(working, 'Zoom says it is reading');
  const done = await until(async () => { const c = await card(); return c && c[1] && c[1].curve && c; });
  assert.ok(done, 'the paragraph\'s curve arrives');
  assert.match(done[1].say, /Ends on the close-up/);
  assert.equal(seen.length, 1);
  await shot('menus-writer.png');
  await key('Escape');
  await help('writer');
  assert.deepEqual(await menuState(), ['+rhythm', '+zoom'], 'Enter alone would repeat it');
  await key('Escape');
  assert.equal(await menuState(), null);
});

test('⌘K: several passes at once in one panel', async () => {
  await caretAtEnd(0);
  await help('editor');
  const items = await menuState();
  assert.equal(items[0], '+cut');
  assert.ok(items.includes('-echoes') && items.includes('-zoom') && !items.some((x) => x.endsWith('strongest')), 'beta passes stay hidden');
  await key('3');
  await key('Enter');
  const p = await until(() => js(`(() => { const el = document.querySelector('.kibitz-pass'); return el && { which: el.querySelector('.kp-which').selectedOptions[0].textContent, tags: [...new Set([...el.querySelectorAll('.kp-pass')].map((x) => x.textContent))] }; })()`));
  assert.equal(p.which, 'Words to Cut · Echoes');
  assert.ok(p.tags.every((x) => ['Words to Cut', 'Echoes'].includes(x)), p.tags.join());
  await shot('menus-editor.png');
  wc.send('menu', { type: 'revisionPass', pass: null });
  await tick(200);
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
      await addImportedBooks([{ name: 'Menus Test', chapters: [{ title: 'One', paras: ${JSON.stringify(PARAS.map((text) => ({ text })))} }] }], library.shelves[0]);
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
