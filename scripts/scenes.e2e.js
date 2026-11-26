// Scene questions and Book Shape (app/scenes.js) in the real window: a ?
// on every outline card opens the questions; answers show as tags on the
// card, ride on the section's note (or the chapter's own) and reach
// book.json; a section with no note gets one without taking the chapter's
// opening from its card; the pane beside the page asks the questions of
// wherever the caret is; View → Book Shape… lists the chapters and takes
// you to one; all of it goes with the feature. Run with
// `npm run test:e2e -- scenes` (OUT=<folder> keeps pictures).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kibitz-scenes-test-${process.pid}-`));
const LIB = path.join(tmp, 'Kibitz Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  features: { cards: true, scenes: true },
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

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name) => { if (process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage()).toPNG()); };
const toOutline = async () => { await js(`switchTab('outline')`); await tick(500); };
const toPage = async () => { await js(`switchTab('manuscript')`); await tick(400); };
const sectionCell = `[...document.querySelectorAll('#outline-board .ob-cell')].find((c) => c.dataset.kind === 'section')`;
const chapterCell = `document.querySelector('#outline-board .ob-cell[data-kind="chapter"]')`;
// the caret in paragraph n of the first chapter
const caretIn = async (n) => {
  await js(`(() => {
    const body = document.querySelector('.chapter:not(.bookpage) .chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${n}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(300);
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every chapter and section card has a ?', async () => {
  await toOutline();
  const r = await js(`(() => {
    const cells = [...document.querySelectorAll('#outline-board .ob-cell')].filter((c) => c.dataset.kind === 'chapter' || c.dataset.kind === 'section');
    return { cells: cells.length, asks: cells.filter((c) => c.querySelector('.ks-ask')).length, sections: cells.filter((c) => c.dataset.kind === 'section').length };
  })()`);
  assert.deepEqual(r, { cells: 4, asks: 4, sections: 1 });
});

test('a section card\'s questions: answered in the popover, shown on the card, kept on its note', async () => {
  await js(`${sectionCell}.querySelector('.ks-ask').click()`);
  await tick(200);
  const fields = await js(`[...document.querySelectorAll('.ks-pop .ks-label')].map((l) => l.textContent)`);
  assert.deepEqual(fields, ['The question', 'What moves it on', 'How it ends', 'Tentpole', 'Revelation']);
  await js(`(() => {
    const q = document.querySelector('.ks-pop textarea');
    q.value = 'Will Owen tell Kevin?';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.ks-pop .ks-choices button')].find((b) => b.textContent === 'No, and').click();
  })()`);
  await tick(200);
  await shot('scenes-popover.png');
  const r = await js(`(() => {
    const cell = ${sectionCell};
    const note = sectionNote(cell.dataset.ch, cell.dataset.sec);
    return { tags: cell.querySelector('.ks-tags').textContent, kibitz: note && note.kibitz, text: note && note.text,
      anchored: !!document.querySelector('.chapter-body p[data-sec-id="' + cell.dataset.sec + '"]') };
  })()`);
  assert.deepEqual(r, { tags: '? No, and', kibitz: { question: 'Will Owen tell Kevin?', outcome: 'noAnd' }, text: '', anchored: true });
});

test('Esc closes the popover, and the board keeps its shape after a redraw', async () => {
  await js(`document.querySelector('.ks-pop textarea').focus()`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await tick(200);
  assert.equal(await js(`!!document.querySelector('.ks-pop')`), false);
  await js(`renderBoard()`);
  await tick(300);
  const r = await js(`(() => ({
    kinds: [...document.querySelectorAll('#outline-board .ob-cell')].map((c) => c.dataset.kind).filter((k) => k === 'chapter' || k === 'section').join(' '),
    tags: ${sectionCell}.querySelector('.ks-tags')?.textContent
  }))()`);
  assert.deepEqual(r, { kinds: 'chapter section chapter chapter', tags: '? No, and' }, 'the chapter keeps its opening; the answers stay');
});

test('a chapter\'s card asks for its narrator and pace too', async () => {
  await js(`${chapterCell}.querySelector('.ks-ask').click()`);
  await tick(200);
  const fields = await js(`[...document.querySelectorAll('.ks-pop .ks-label')].map((l) => l.textContent)`);
  assert.deepEqual(fields.slice(0, 2), ['Narrator', 'Pace']);
  await js(`(() => {
    const n = document.querySelector('.ks-pop input');
    n.value = 'Owen';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await tick(150);
  await js(`closeScenePop()`);
  assert.deepEqual(await js(`book.kibitzChapters[${chapterCell}.dataset.ch]`), { narrator: 'Owen' });
  assert.equal(await js(`${chapterCell}.querySelector('.ks-tags').textContent`), 'Owen');
  await shot('scenes-board.png');
});

test('the answers reach book.json', async () => {
  await js(`flushAllSaves()`);
  await tick(800);
  const found = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name === 'book.json') found.push(JSON.parse(fs.readFileSync(p, 'utf8'))); } };
  walk(LIB);
  const meta = found.find((b) => b.kibitzChapters);
  assert.ok(meta, 'book.json has the chapter answers');
  assert.deepEqual(Object.values(meta.kibitzChapters), [{ narrator: 'Owen' }]);
  const notes = Object.values(meta.sectionNotes).flat();
  assert.deepEqual(notes.map((n) => n.kibitz), [{ question: 'Will Owen tell Kevin?', outcome: 'noAnd' }]);
});

test('beside the page: the questions of wherever the caret is', async () => {
  await toPage();
  await caretIn(3); // the section after the *** (2 is the *** itself)
  const sec = await js(`(() => { const b = document.querySelector('.ks-side'); return b && { head: b.querySelector('.ks-side-head').textContent, q: b.querySelector('textarea').value }; })()`);
  assert.deepEqual(sec, { head: 'Questions for Section A', q: 'Will Owen tell Kevin?' });
  await caretIn(0); // the chapter's opening
  const ch = await js(`(() => { const b = document.querySelector('.ks-side'); return { head: b.querySelector('.ks-side-head').textContent, narrator: b.querySelector('input').value }; })()`);
  assert.deepEqual(ch, { head: 'Questions for Chapter 1', narrator: 'Owen' });
  await js(`document.getElementById('side-pane').classList.add('open')`);
  await tick(300);
  await shot('scenes-side.png');
  await js(`(() => {
    const box = document.querySelector('.ks-side');
    const rev = [...box.querySelectorAll('.ks-field')].find((f) => f.querySelector('.ks-label').textContent === 'Revelation').querySelector('textarea');
    rev.value = 'The bus never comes back.';
    rev.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(await js(`book.kibitzChapters[document.querySelector('.chapter:not(.bookpage)').dataset.id].revelation`), 'The bus never comes back.');
  await js(`document.getElementById('side-pane').classList.remove('open')`);
});

test('View → Book Shape… lists the chapters and goes to one', async () => {
  wc.send('menu', { type: 'bookShape' });
  await tick(400);
  const rows = await js(`[...document.querySelectorAll('.ks-shape tbody tr')].map((tr) => [...tr.cells].slice(0, 2).map((c) => c.textContent))`);
  assert.deepEqual(rows, [['Chapter 1', 'Owen'], ['Chapter 2', '—'], ['Chapter 3', '—']]);
  await shot('scenes-shape.png');
  await js(`document.querySelectorAll('.ks-shape tbody tr')[2].click()`);
  await tick(600);
  assert.equal(await js(`!!document.querySelector('.ks-shape')`), false);
  assert.equal(await js(`getSelection().anchorNode && getSelection().anchorNode.parentElement.closest('.chapter').dataset.id === book.chapterOrder.filter((id) => STORY_KINDS.includes(chapterKind(id)))[2]`), true);
});

test('all of it goes with the feature', async () => {
  await js(`library.features.scenes = false; reportFeatures()`);
  await toOutline();
  await js(`renderBoard()`);
  await tick(300);
  assert.equal(await js(`document.querySelectorAll('.ks-ask, .ks-tags').length`), 0);
  await toPage();
  await caretIn(0);
  assert.equal(await js(`!!document.querySelector('.ks-side')`), false);
  wc.send('menu', { type: 'bookShape' });
  await tick(300);
  assert.equal(await js(`!!document.querySelector('.ks-shape')`), false);
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
    win.setBounds({ width: 1300, height: 860 });
    await tick(600);
    const para = (text) => ({ text });
    await js(`(async () => {
      await addImportedBooks([{ name: 'Scenes Test', chapters: [
        { title: 'One', paras: ${JSON.stringify([para('The bus came late that morning.'), para('Nobody complained.')])} },
        { title: 'Two', paras: ${JSON.stringify([para('"Hi there," he said. "How are you?"')])} },
        { title: 'Three', paras: ${JSON.stringify([para('The fences ran white down the row.')])} }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      // a *** in the first chapter, and a section after it
      const body = document.querySelector('.chapter:not(.bookpage) .chapter-body');
      const brk = newSceneBreak();
      body.appendChild(brk);
      const p = document.createElement('p');
      p.textContent = 'Owen waited by the gate until dark.';
      body.appendChild(p);
      syncChapter(body, body.closest('.chapter').dataset.id);
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
