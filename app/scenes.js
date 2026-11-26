'use strict';

/*  SCENE QUESTIONS AND BOOK SHAPE  */
// Every outline card can answer five questions (the scene's question, what
// moves it on, how it ends, its tentpole moment and its revelation), and a
// chapter's card two more (its narrator, its pace). An empty question is a
// gray prompt, never a warning. Three ways in:
//   - on the Outline, the ? on a card (shown on hover) opens them, and the
//     answers show as one quiet line of tags on the card;
//   - while writing, the right-hand pane shows them for the section the
//     caret is in, under the cards beside the page;
//   - View → Book Shape… charts the whole book: lengths, dialogue, pace,
//     and which narrator has been away longest.
// A section's answers ride on its outline note (note.kibitz), so they move
// wherever NEO moves the note; the chapter's own (its opening, before any
// ***, belongs to the chapter's card) live in book.kibitzChapters. Both are
// saved in book.json with the rest of the book's notes.
// The fields and the measures are craft/scenes.js. A feature (FEATURES in
// core), off until switched on. Desktop only.

let scenePop = null;          // the open popover
let sceneSideKey = '';        // what the pane's questions are about
let sceneSideQueued = false;
let sceneBoardObserver = null;
let sceneShapeEl = null;

const scenesOn = () => typeof KibitzCraft !== 'undefined' && !!KibitzCraft.scenes && !!book && featureOn('scenes') && !isScript();

// A card's place: { chId, secId, segIdx, chapter }. secId null with
// chapter true is the chapter's own card; with chapter false, a section
// that has no note yet (it gets one with its first answer).
function sceneAnswers(where) {
  if (where.chapter) return (book.kibitzChapters || {})[where.chId] || null;
  const note = where.secId ? sectionNote(where.chId, where.secId) : null;
  return note ? note.kibitz || null : null;
}

// A section with no outline note gets one, empty, the way NEO gives a
// section its first note (saveCard): its first line of prose carries the id.
function sceneSectionId(where) {
  if (where.secId || where.chapter) return where.secId;
  const seg = chapterSegments(where.chId)[where.segIdx];
  if (!seg) return null;
  if (seg.id) return (where.secId = seg.id);
  const anchor = seg.ps.find((p) => !p.classList.contains('ghost'));
  if (!anchor) return null;
  const sec = { id: newSectionId(), text: '' };
  anchor.dataset.secId = sec.id;
  book.sectionNotes = book.sectionNotes || {};
  (book.sectionNotes[where.chId] = book.sectionNotes[where.chId] || []).push(sec);
  orderSectionNotes(where.chId);
  syncChapter(chapterBodyEl(where.chId), where.chId);
  return (where.secId = sec.id);
}

function setSceneAnswer(where, key, value) {
  const S = KibitzCraft.scenes;
  if (where.chapter) {
    book.kibitzChapters = book.kibitzChapters || {};
    const next = S.clean({ ...book.kibitzChapters[where.chId], [key]: value }, true);
    if (next) book.kibitzChapters[where.chId] = next;
    else delete book.kibitzChapters[where.chId];
  } else {
    if (!value && !where.secId) return; // nothing to keep, no note to make
    const id = sceneSectionId(where);
    const note = id && sectionNote(where.chId, id);
    if (!note) return;
    const next = S.clean({ ...note.kibitz, [key]: value });
    if (next) note.kibitz = next;
    else delete note.kibitz;
  }
  scheduleMetaSave();
}

// The narrators named on other chapters' cards, for the narrator field.
const sceneNarrators = () => [...new Set(Object.values(book.kibitzChapters || {}).map((c) => c.narrator).filter(Boolean))].sort();

// The questions as a form. Text answers save as they're typed; a choice
// saves on click, and clicking it again clears it.
function sceneForm(where, onChange) {
  const S = KibitzCraft.scenes;
  const answers = sceneAnswers(where) || {};
  const form = document.createElement('div');
  form.className = 'ks-form';
  const fields = where.chapter ? S.CHAPTER_FIELDS.concat(S.FIELDS) : S.FIELDS;
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'ks-field';
    const id = 'ks-' + f.key + '-' + Math.random().toString(36).slice(2, 7);
    const label = document.createElement(f.choices ? 'span' : 'label');
    label.className = 'ks-label';
    label.textContent = t(f.label);
    if (!f.choices) label.htmlFor = id;
    row.appendChild(label);
    if (f.choices) {
      const group = document.createElement('div');
      group.className = 'ks-choices';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', t(f.label));
      group.title = t(f.prompt);
      for (const [key, text] of f.choices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t(text);
        b.setAttribute('aria-pressed', String(answers[f.key] === key));
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          for (const other of group.children) other.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', String(on));
          setSceneAnswer(where, f.key, on ? key : '');
          onChange();
        });
        group.appendChild(b);
      }
      row.appendChild(group);
    } else {
      const input = document.createElement(f.key === 'narrator' ? 'input' : 'textarea');
      input.id = id;
      input.className = 'ks-input';
      input.placeholder = t(f.prompt);
      input.value = answers[f.key] || '';
      input.spellcheck = false;
      if (f.key === 'narrator') {
        input.type = 'text';
        const list = document.createElement('datalist');
        list.id = id + '-list';
        for (const n of sceneNarrators()) list.appendChild(new Option(n));
        input.setAttribute('list', list.id);
        row.appendChild(list);
      } else {
        input.rows = 2;
      }
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); });
      input.addEventListener('input', () => { setSceneAnswer(where, f.key, input.value); onChange(); });
      row.appendChild(input);
    }
    form.appendChild(row);
  }
  return form;
}

/* ---- on the Outline ---- */

function sceneWhereOfCell(cell) {
  const chapter = cell.dataset.kind === 'chapter';
  return { chId: cell.dataset.ch, secId: cell.dataset.sec || null, segIdx: Number(cell.dataset.seg), chapter };
}

function decorateSceneCard(cell) {
  cell.querySelector('.ks-tags')?.remove();
  cell.querySelector('.ks-ask')?.remove();
  if (!scenesOn() || cell.dataset.new || (cell.dataset.kind !== 'chapter' && cell.dataset.kind !== 'section')) return;
  const where = sceneWhereOfCell(cell);
  const sum = KibitzCraft.scenes.summary(sceneAnswers(where));
  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'ks-ask';
  ask.textContent = '?';
  ask.title = t('Scene questions');
  ask.setAttribute('aria-label', t('Scene questions'));
  ask.tabIndex = -1;
  ask.addEventListener('click', (e) => { e.stopPropagation(); openScenePop(cell); });
  cell.appendChild(ask);
  if (!sum.question && !sum.tags.length) return;
  const tags = document.createElement('div');
  tags.className = 'ks-tags';
  tags.textContent = (sum.question ? '? ' : '') + sum.tags.join(' · ');
  tags.title = [sum.question, ...sum.tags].filter(Boolean).join('\n');
  const foot = cell.querySelector('.ob-foot');
  if (foot) foot.before(tags);
  else cell.querySelector('.ob-card').appendChild(tags);
}

function decorateBoard() {
  const board = document.getElementById('outline-board');
  if (!board) return;
  for (const cell of board.querySelectorAll('.ob-cell')) decorateSceneCard(cell);
}

// The board is drawn anew often (renderBoard): watch it, and dress its
// cards each time. It's made the first time the Outline shows.
function watchSceneBoard() {
  const board = document.getElementById('outline-board');
  if (!board || sceneBoardObserver) return;
  let queued = false;
  sceneBoardObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorateBoard(); });
  });
  sceneBoardObserver.observe(board, { childList: true });
  decorateBoard();
}
const auxPaper = document.getElementById('aux-paper');
if (auxPaper) new MutationObserver(watchSceneBoard).observe(auxPaper, { childList: true });

function closeScenePop() {
  if (!scenePop) return;
  const { el, cell } = scenePop;
  scenePop = null;
  el.remove();
  if (cell.isConnected) {
    decorateSceneCard(cell);
    cell.focus({ preventScroll: true });
  }
}

function openScenePop(cell) {
  closeScenePop();
  const where = sceneWhereOfCell(cell);
  const el = document.createElement('div');
  el.className = 'ks-pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('Scene questions'));
  const head = document.createElement('div');
  head.className = 'ks-pop-head';
  const title = document.createElement('span');
  title.textContent = where.chapter ? chapterName(where.chId) : t('Section {letter}', { letter: cell.querySelector('.ob-letter')?.textContent || '' });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ks-close';
  close.textContent = '×';
  close.setAttribute('aria-label', t('Close'));
  close.addEventListener('click', closeScenePop);
  head.append(title, close);
  el.append(head, sceneForm(where, () => {
    if (where.secId && !cell.dataset.sec) cell.dataset.sec = where.secId;
    decorateSceneCard(cell);
  }));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeScenePop(); }
    e.stopPropagation(); // the board's own keys stay out of the form
  });
  document.body.appendChild(el);
  // beside the card, inside the window
  const r = cell.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = r.right + 10 + w < window.innerWidth ? r.right + 10 : Math.max(10, r.left - 10 - w);
  el.style.left = left + 'px';
  el.style.top = Math.max(10, Math.min(r.top, window.innerHeight - h - 50)) + 'px';
  scenePop = { el, cell };
  el.querySelector('textarea, input, button:not(.ks-close)')?.focus();
}
document.addEventListener('mousedown', (e) => {
  if (scenePop && !scenePop.el.contains(e.target) && !e.target.closest('.ks-ask')) closeScenePop();
}, true);

/* ---- beside the page ---- */

// The card the caret's paragraph belongs to.
function sceneWhereOfCaret() {
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('.chapter-body > p') : null;
  if (!p || p.closest('.bookpage')) return null;
  const chId = p.closest('.chapter').dataset.id;
  let segIdx = 0;
  for (const line of p.parentElement.children) {
    if (line === p) break;
    if (line.classList.contains('scene-break')) segIdx++;
  }
  const segs = chapterSegments(chId);
  const seg = segs[segIdx];
  if (!seg) return null;
  const chapter = segIdx === 0 && !seg.id;
  // (letters as the Outline gives them: an opening with no note of its own is the chapter's)
  const letter = secLetter(segIdx - (segs[0].id ? 0 : 1));
  return { chId, secId: chapter ? null : seg.id, segIdx, chapter, label: chapter ? chapterName(chId) : t('Section {letter}', { letter }) };
}

function sceneSideUpdate() {
  sceneSideQueued = false;
  const cards = document.getElementById('side-cards');
  let box = document.querySelector('.ks-side');
  const where = cards && scenesOn() && featureOn('cards') && currentTab === 'manuscript' ? sceneWhereOfCaret() : null;
  if (!where) {
    if (box) box.remove();
    sceneSideKey = '';
    return;
  }
  if (box && box.contains(document.activeElement)) return; // being typed in
  const key = [where.chId, where.segIdx, where.secId || ''].join(':');
  if (box && key === sceneSideKey && box.previousElementSibling === cards) return;
  sceneSideKey = key;
  if (!box) {
    box = document.createElement('section');
    box.className = 'ks-side';
  }
  cards.after(box);
  box.textContent = '';
  const head = document.createElement('div');
  head.className = 'ks-side-head';
  head.textContent = t('Questions for {card}', { card: where.label });
  box.append(head, sceneForm(where, () => { sceneSideKey = [where.chId, where.segIdx, where.secId || ''].join(':'); }));
}
function queueSceneSide() {
  if (sceneSideQueued) return;
  sceneSideQueued = true;
  requestAnimationFrame(sceneSideUpdate);
}
document.addEventListener('selectionchange', queueSceneSide);

/* ---- View → Book Shape… ---- */

function closeBookShape() {
  if (sceneShapeEl) sceneShapeEl.remove();
  sceneShapeEl = null;
}

function openBookShape() {
  if (!scenesOn()) return;
  closeBookShape();
  const ids = book.chapterOrder.filter((id) => STORY_KINDS.includes(chapterKind(id)));
  const shape = KibitzCraft.scenes.bookShape(ids.map((id) => {
    const own = (book.kibitzChapters || {})[id] || {};
    return { id, name: chapterName(id), text: chapterText(id), narrator: own.narrator, pace: own.pace };
  }));
  const el = document.createElement('div');
  el.className = 'ks-shape';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', t('Book shape'));
  const inner = document.createElement('div');
  inner.className = 'ks-shape-inner';
  const head = document.createElement('div');
  head.className = 'ks-shape-head';
  const h = document.createElement('h2');
  h.textContent = t('Book shape');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ks-close';
  close.textContent = '×';
  close.setAttribute('aria-label', t('Close'));
  close.addEventListener('click', closeBookShape);
  head.append(h, close);
  inner.appendChild(head);
  const notes = document.createElement('ul');
  notes.className = 'ks-notes';
  for (const n of shape.notes) {
    const li = document.createElement('li');
    li.textContent = n.text;
    notes.appendChild(li);
  }
  if (!shape.notes.length) {
    const li = document.createElement('li');
    li.className = 'ks-quiet';
    li.textContent = shape.rows.length ? t('Nothing drags: no long dialogue runs, no fast runs without a breather.') : t('No chapters yet.');
    notes.appendChild(li);
  }
  if (shape.rows.length && !shape.narrators.length) {
    const li = document.createElement('li');
    li.className = 'ks-quiet';
    li.textContent = t('Name each chapter’s narrator on its card (the ? on the Outline) to see who has been away longest.');
    notes.appendChild(li);
  }
  inner.appendChild(notes);
  const flagged = new Set(shape.notes.flatMap((n) => Array.from({ length: n.to - n.from + 1 }, (_, i) => n.from + i)));
  const longest = Math.max(1, ...shape.rows.map((r) => r.words));
  const table = document.createElement('table');
  table.className = 'ks-table';
  const thead = table.createTHead().insertRow();
  for (const label of [t('Chapter'), t('Narrator'), t('Length'), t('Dialogue'), t('Pace')]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    thead.appendChild(th);
  }
  const tbody = table.createTBody();
  shape.rows.forEach((r, i) => {
    const tr = tbody.insertRow();
    tr.tabIndex = 0;
    tr.classList.toggle('flagged', flagged.has(i));
    tr.title = t('Go to {chapter}', { chapter: r.name });
    const go = () => { closeBookShape(); goToChapterTop(r.id); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    tr.insertCell().textContent = r.name;
    tr.insertCell().textContent = r.narrator || '—';
    const bar = (share, text) => {
      const cell = tr.insertCell();
      cell.className = 'ks-barcell';
      const track = document.createElement('span');
      track.className = 'ks-track';
      const b = document.createElement('span');
      b.className = 'ks-bar';
      b.style.width = (share * 100).toFixed(1) + '%';
      track.appendChild(b);
      const v = document.createElement('span');
      v.className = 'ks-val';
      v.textContent = text;
      cell.append(track, v);
    };
    bar(r.words / longest, r.words.toLocaleString());
    bar(r.dialogue, Math.round(r.dialogue * 100) + '%');
    const pace = tr.insertCell();
    pace.textContent = r.pace === 'fast' ? t('Fast') : r.pace === 'breather' ? t('Breather') : '—';
    if (r.pace !== 'steady' && !r.paceSet) pace.title = t('Judged by length');
  });
  inner.appendChild(table);
  el.appendChild(inner);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBookShape(); } });
  el.addEventListener('mousedown', (e) => { if (e.target === el) closeBookShape(); });
  document.body.appendChild(el);
  sceneShapeEl = el;
  close.focus();
}

// (Not on Pocket: its bridge keeps a single menu listener, the window's own.)
if (!IS_POCKET && window.kibitz && window.kibitz.onMenu) {
  window.kibitz.onMenu((msg) => {
    if (msg.type === 'bookShape') openBookShape();
  });
}
