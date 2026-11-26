// The revision passes (app/passes.js) in the real window: Edit → Revision
// Pass runs one; its finds are underlined and listed beside the page, which
// moves aside; a click on an item takes the caret there; typing reads the
// chapter again; the panel switches passes and ends; no pass changes a
// word; the menu item comes and goes with the feature. Run with
// `npm run test:e2e -- passes` (OUT=<folder> keeps a picture of each theme).

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-passes-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'Kibitz Library'));
fs.writeFileSync(path.join(tmp, 'Kibitz Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  features: { passes: true },
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

const PARAS = [
  'The bus came late that morning, and nobody on it complained.',
  'He walked to the mess hall. He got a tray and sat down with it. He saw the screen on the wall and the score was really there again.',
  '"Maybe," Owen said softly. "I don\'t know. I guess I\'m not sure it\'s worth it, honestly."',
  'Owen, Kevin, Andre and Mateo met Sergeant Hale at the gate. A smile tugged at her lips, she thought.'
];

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const menu = async (pass) => { wc.send('menu', { type: 'revisionPass', pass }); await tick(300); };
const panel = () => js(`(() => {
  const el = document.querySelector('.kibitz-pass');
  if (!el) return null;
  return { pass: el.querySelector('.kp-which').value, items: el.querySelectorAll('.kp-item').length,
    labels: [...el.querySelectorAll('.kp-label')].map((x) => x.textContent), marks: CSS.highlights.get('kibitz-pass')?.size || 0 };
})()`);
const expected = (pass) => js(`(() => {
  const body = document.querySelector('.chapter-body');
  return KibitzCraft.passes.run(${JSON.stringify(pass)}, passText(body).text).findings.map((f) => f.label);
})()`);
const shot = async (name) => { if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage()).toPNG()); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Edit → Revision Pass lists every pass and End Pass', async () => {
  const edit = Menu.getApplicationMenu().items.find((m) => m.label === 'Edit');
  const item = edit.submenu.items.find((m) => m.label === 'Revision Pass');
  assert.ok(item, 'the item is there with the feature on');
  assert.deepEqual(item.submenu.items.filter((m) => m.type !== 'separator').map((m) => m.label),
    ['Words to Cut', 'Rhythm', 'Echoes', 'Point of View', 'Clutter', 'Dialogue', 'Description', 'Time and Cast', 'Zoom', 'End Pass']);
});

test('a pass underlines and lists what the engine finds, and the page moves aside', async () => {
  await menu('cut');
  const p = await panel();
  assert.equal(p.pass, 'cut');
  assert.deepEqual(p.labels, await expected('cut'));
  assert.ok(p.items > 0 && p.marks >= p.items);
  const clear = await js(`document.querySelector('#paper-scroll .chapter.sheet').getBoundingClientRect().right <= document.querySelector('.kibitz-pass').getBoundingClientRect().left`);
  assert.ok(clear, 'the page sits clear of the panel');
  await shot('passes-night.png');
});

test('every pass matches the engine', async () => {
  for (const pass of ['rhythm', 'echoes', 'pov', 'clutter', 'dialogue', 'description', 'time', 'cut']) {
    await menu(pass);
    const p = await panel();
    assert.equal(p.pass, pass);
    assert.deepEqual(p.labels, await expected(pass), pass);
  }
});

test('a click on an item puts the caret at the find, and marks it', async () => {
  await menu('pov');
  const at = await js(`(() => {
    const item = [...document.querySelectorAll('.kibitz-pass button.kp-item')].find((b) => b.querySelector('.kp-label').textContent === 'Filter');
    item.click();
    const sel = getSelection();
    const r = document.createRange();
    r.setStart(sel.anchorNode, sel.anchorOffset);
    r.setEnd(sel.anchorNode, Math.min(sel.anchorNode.length, sel.anchorOffset + 6));
    return { text: r.toString(), collapsed: sel.isCollapsed, current: CSS.highlights.get('kibitz-pass-current').size, marked: item.classList.contains('current') };
  })()`);
  assert.deepEqual(at, { text: 'He saw', collapsed: true, current: 1, marked: true });
});

test('writing reads the chapter again', async () => {
  await menu('cut');
  const before = (await panel()).items;
  await js(`(() => {
    const p = document.querySelector('.chapter-body').lastElementChild;
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  for (const k of ' Very.') {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  await tick(1200);
  assert.equal((await panel()).items, before + 1);
});

test('the panel switches passes, and the same pass again ends it', async () => {
  await menu(null);
  await menu('cut');
  await js(`(() => { const s = document.querySelector('.kp-which'); s.value = 'echoes'; s.dispatchEvent(new Event('change')); })()`);
  assert.equal((await panel()).pass, 'echoes');
  await menu('echoes');
  assert.equal(await panel(), null);
  assert.equal(await js(`CSS.highlights.has('kibitz-pass') || document.body.classList.contains('kibitz-pass-open')`), false);
});

test('Esc in the panel and End Pass end it', async () => {
  await menu('rhythm');
  await js(`document.querySelector('.kp-close').focus()`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await tick(200);
  assert.equal(await panel(), null);
  await menu('rhythm');
  await menu(null);
  assert.equal(await panel(), null);
});

test('no pass changes a word', async () => {
  const before = await js(`document.querySelector('.chapter-body').innerHTML`);
  for (const pass of ['cut', 'rhythm', 'echoes', 'pov', 'clutter', 'dialogue', 'description', 'time']) await menu(pass);
  await js(`document.querySelector('.kibitz-pass button.kp-item')?.click()`);
  await menu(null);
  assert.equal(await js(`document.querySelector('.chapter-body').innerHTML`), before);
});

test('the panel in Paper and Light', async () => {
  await menu('dialogue');
  for (const theme of ['paper', 'light']) {
    wc.send('menu', { type: 'pageTheme', value: theme });
    await tick(400);
    await shot(`passes-${theme}.png`);
  }
  wc.send('menu', { type: 'pageTheme', value: 'night' });
  await menu(null);
});

test('the menu item goes with the feature', async () => {
  await js(`library.features.passes = false; reportFeatures()`);
  await tick(400);
  const edit = Menu.getApplicationMenu().items.find((m) => m.label === 'Edit');
  assert.ok(!edit.submenu.items.some((m) => m.label === 'Revision Pass'));
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
    win.setBounds({ width: 1400, height: 860 });
    await tick(600);
    await js(`(async () => {
      await addImportedBooks([{ name: 'Passes Test', chapters: [{ title: 'One', paras: ${JSON.stringify(PARAS.map((text) => ({ text })))} }] }], library.shelves[0]);
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
