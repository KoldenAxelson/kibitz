// Strongest Moments (beta: app/passes.js with craft/story.js and decide.js)
// in the real window, against a fake Ollaya: hidden until the story beta is
// on, then one request per narrated paragraph's last sentence, and per
// reading the three the model rates strongest, best first, the provisional
// readings marked. An edit asks again only about the moments it touched.
// Never starts a real Ollaya. Run with `npm run test:e2e -- strongest`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-strongest-test-${process.pid}-`));
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
// A fake Ollaya: the chance of yes for every reading is the number in the
// moment's last sentence, as a percentage ("... 80 ..." is 0.8).
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET') { res.end('Ollaya is running'); return; }
    const body = JSON.parse(raw);
    seen.push(body);
    res.setHeader('Content-Type', 'application/json');
    const last = body.state.trim().split(/(?<=\.)\s+/).pop();
    const p = Number((last.match(/(\d+)\D*$/) || [0, '50'])[1]) / 100;
    const answers = {};
    for (const id of Object.keys(body.questions)) answers[id] = { type: 'choice', choice: p >= 0.5 ? 'yes' : 'no', probabilities: { yes: p, no: 1 - p } };
    setTimeout(() => res.end(JSON.stringify({ model: body.model, answers })), 20);
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

const FILL = 'Owen walked slowly along the long road past the houses on the hill above the old town and the river.';
const SCORES = [10, 80, 30, 60, 90, 20];
const PARAS = SCORES.map((n, i) => `${FILL} ${FILL} ${FILL} The moment number ${i + 1} scores ${n} here.`);

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const menu = async (pass) => { wc.send('menu', { type: 'revisionPass', pass }); await tick(200); };
const panel = () => js(`(() => {
  const el = document.querySelector('.kibitz-pass');
  return el && { labels: [...el.querySelectorAll('.kp-label')].map((x) => x.textContent), marks: [...el.querySelectorAll('.kp-quote mark')].map((x) => x.textContent),
    summary: [...el.querySelectorAll('.kp-summary p')].map((p) => p.textContent), options: [...el.querySelectorAll('.kp-which option')].map((o) => o.value) };
})()`);
const until = async (test, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await test(); if (v) return v; await tick(100); } return null; };
const shot = async (name) => { if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage()).toPNG()); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const passItems = () => Menu.getApplicationMenu().items.find((m) => m.label === 'Edit').submenu.items.find((m) => m.label === 'Revision Pass').submenu.items;

test('hidden until the story beta is on', async () => {
  assert.ok(!passItems().some((m) => m.label === 'Strongest Moments' && m.visible !== false), 'not on the menu');
  await menu('strongest');
  assert.equal(await panel(), null, 'the menu message alone does nothing');
  await menu('zoom');
  assert.ok(!(await panel()).options.includes('strongest'), 'not in the panel\'s list');
  await menu(null);
  await js(`setFeature('storyBeta', true)`);
  await tick(400);
  assert.ok(passItems().some((m) => m.label === 'Strongest Moments'), 'on the menu once switched on');
});

test('each moment read once, then the three strongest per reading, best first', async () => {
  seen.length = 0;
  await menu('strongest');
  const done = await until(async () => { const p = await panel(); return p && p.labels.length === 12 && !p.summary.length && p; });
  assert.ok(done, 'four readings, three picks each, no status left');
  assert.equal(seen.length, 6, 'one request per paragraph moment');
  assert.ok(seen.every((b) => b.model === 'winnow:e4b' && Object.keys(b.questions).sort().join() === 'landed,opening,reveal,rising'));
  assert.deepEqual(done.labels.slice(0, 3), ['Lands', 'Lands', 'Lands']);
  assert.deepEqual(done.labels.slice(9), ['About to show · provisional', 'About to show · provisional', 'About to show · provisional']);
  assert.deepEqual(done.marks.slice(0, 3).map((m) => m.match(/scores (\d+)/)[1]), ['90', '80', '60'], 'best first');
  assert.ok(await js(`CSS.highlights.get('kibitz-pass').size === 12`), 'each pick marked in the page');
  await shot('strongest.png');
});

test('an edit asks again only about the moment that changed', async () => {
  const before = seen.length;
  await js(`(() => {
    const p = document.querySelectorAll('.chapter-body')[0].children[0];
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    p.closest('.chapter-body').focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  for (const k of ' It 99.') {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  const p = await until(async () => { const v = await panel(); return v && v.marks[0] === 'It 99.' && v; }, 8000);
  assert.ok(p, 'the edited moment now ranks first');
  const asked = seen.length - before;
  assert.ok(asked >= 1 && asked <= 2, `only the moment edited and the next, whose view reaches back into it (asked ${asked})`);
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
      await addImportedBooks([{ name: 'Strongest Test', chapters: [{ title: 'One', paras: ${JSON.stringify(PARAS.map((text) => ({ text })))} }] }], library.shelves[0]);
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
