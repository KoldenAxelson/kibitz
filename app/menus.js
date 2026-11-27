'use strict';

/*  WRITER AND EDITOR MENUS  */
// Help is pulled, never pushed. ⌘J opens the writer menu at the caret
// (what comes next: rhythm, this paragraph's zoom); ⌘K opens the editor
// menu (the revision passes, several at once). Vim-style: a number key (or
// j/k and Space) toggles a choice, Enter runs the ones ticked, Esc closes.
// A menu opens with the last set it ran ticked, so ⌘J Enter repeats it.
// The writer's answers come back as one small card under the caret; any
// key or click puts it away. The editor's run in the revision pass panel.
// Nothing here writes a word. A feature (FEATURES in core), off until
// switched on.

let menuEl = null;       // the open menu
let menuCardEl = null;   // the writer's answer card
let menuRun = 0;         // bumped to abandon a model answer in progress
const menuLastSeen = { writer: null, editor: null };

const menusReady = () => typeof KibitzCraft !== 'undefined' && !!KibitzCraft.suggest && featureOn('menus');

// The caret's prose paragraph, its chapter body and the offset in it, or null.
function menuCaret() {
  const sel = window.getSelection();
  if (!book || currentTab !== 'manuscript' || isScript() || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const at = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
  const p = at && at.closest ? at.closest('.chapter-body > p') : null;
  if (!p || p.closest('.bookpage') || !suggestProse(p)) return null;
  const off = flatOffset(p, range.endContainer, range.endOffset);
  return off < 0 ? null : { p, body: p.parentElement, off };
}

/* ---- what each menu offers ---- */
const WRITER_ITEMS = [
  { key: 'rhythm', label: 'Rhythm' },
  { key: 'zoom', label: 'Zoom', model: true }
];
const menuItems = (which) => (which === 'writer'
  ? WRITER_ITEMS.map((i) => ({ ...i, label: t(i.label) }))
  : passesShown().map((p) => ({ key: p.key, label: t(p.label), model: !!p.model })));

function menuLast(which) {
  const saved = (library && library.menuLast && library.menuLast[which]) || menuLastSeen[which];
  return Array.isArray(saved) ? saved : [];
}
function rememberMenu(which, keys) {
  menuLastSeen[which] = keys;
  if (!library) return;
  library.menuLast = { ...(library.menuLast || {}), [which]: keys };
  writeLibrary();
}

function closeMenu(refocus = true) {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  if (refocus) focusPage();
}
function hideMenuCard() {
  menuRun++;
  if (menuCardEl) menuCardEl.remove();
  menuCardEl = null;
}

function openMenu(which) {
  if (!menusReady()) return;
  closeMenu(false);
  hideMenuCard();
  if (which === 'writer' && !menuCaret()) { toast(t('Put the caret in a paragraph of prose first.')); return; }
  if (which === 'editor' && !passBody()) { toast(t('Open a chapter of prose to run a pass on it.')); return; }
  const items = menuItems(which);
  const last = menuLast(which);
  const ticked = new Set(items.filter((i) => last.includes(i.key)).map((i) => i.key));
  if (!ticked.size) ticked.add(items[0].key);
  let cursor = 0;
  const el = document.createElement('div');
  el.className = 'kibitz-menu';
  el.tabIndex = -1;
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', which === 'writer' ? t('Writer menu') : t('Editor menu'));
  const list = document.createElement('ol');
  const rows = items.map((item, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'menuitemcheckbox');
    li.dataset.key = item.key;
    const n = document.createElement('span');
    n.className = 'km-n';
    n.textContent = String((i + 1) % 10);
    const name = document.createElement('span');
    name.className = 'km-label';
    name.textContent = item.label;
    li.append(n, name);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); toggle(i); });
    list.appendChild(li);
    return li;
  });
  const paint = () => rows.forEach((li, i) => {
    const on = ticked.has(items[i].key);
    li.classList.toggle('on', on);
    li.classList.toggle('cursor', i === cursor);
    li.setAttribute('aria-checked', String(on));
  });
  const toggle = (i) => {
    if (i < 0 || i >= items.length) return;
    cursor = i;
    const k = items[i].key;
    if (ticked.has(k)) ticked.delete(k); else ticked.add(k);
    paint();
  };
  const run = () => {
    const keys = items.filter((i) => ticked.has(i.key)).map((i) => i.key);
    closeMenu(true);
    if (!keys.length) return;
    rememberMenu(which, keys);
    if (which === 'editor') runPasses(keys);
    else answerWriter(keys);
  };
  el.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') closeMenu(true);
    else if (e.key === 'Enter') run();
    else if (/^[0-9]$/.test(e.key)) toggle((Number(e.key) + 9) % 10);
    else if (e.key === 'j' || e.key === 'ArrowDown') { cursor = Math.min(items.length - 1, cursor + 1); paint(); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); paint(); }
    else if (e.key === ' ' || e.key === 'x') toggle(cursor);
  });
  el.addEventListener('focusout', () => setTimeout(() => { if (menuEl === el && !el.contains(document.activeElement)) closeMenu(false); }));
  el.append(list);
  paint();
  document.body.appendChild(el);
  // by the caret, kept on screen
  const caret = caretRect();
  const box = el.getBoundingClientRect();
  const x = caret ? caret.left : (window.innerWidth - box.width) / 2;
  const y = caret ? caret.bottom + 6 : window.innerHeight / 3;
  el.style.left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8)) + 'px';
  el.style.top = (y + box.height > window.innerHeight - 8 ? Math.max(8, (caret ? caret.top : y) - box.height - 6) : y) + 'px';
  menuEl = el;
  el.focus();
}

/* ---- the writer's answers ---- */
async function answerWriter(keys) {
  const at = menuCaret();
  if (!at) return;
  const run = ++menuRun;
  const card = document.createElement('div');
  card.className = 'kibitz-card';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  const rows = {};
  for (const k of keys) {
    const row = document.createElement('div');
    row.className = 'kc-row';
    const name = document.createElement('span');
    name.className = 'kc-name';
    name.textContent = t((WRITER_ITEMS.find((i) => i.key === k) || {}).label || k);
    const say = document.createElement('span');
    say.className = 'kc-say';
    row.append(name, say);
    card.appendChild(row);
    rows[k] = say;
  }
  if (menuCardEl) menuCardEl.remove();
  menuCardEl = card;
  document.body.appendChild(card);
  placeCard(card);
  const live = () => run === menuRun && menuCardEl === card;
  for (const k of keys) {
    if (!live()) return;
    if (k === 'rhythm') sayRhythm(rows[k], at);
    if (k === 'zoom') await sayZoom(rows[k], at, live);
    if (live()) placeCard(card);
  }
}

function placeCard(card) {
  const caret = caretRect();
  const box = card.getBoundingClientRect();
  const x = caret ? caret.left : (window.innerWidth - box.width) / 2;
  let y = caret ? caret.bottom + 6 : window.innerHeight / 3;
  if (y + box.height > window.innerHeight - 8) y = Math.max(8, (caret ? caret.top : y) - box.height - 6);
  card.style.left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8)) + 'px';
  card.style.top = y + 'px';
}

// Rhythm: the suggester's rule for the next sentence, from the scene up to
// the caret, asked for now rather than after a pause.
function sayRhythm(say, at) {
  const C = KibitzCraft;
  const text = suggestText(at.body, at.p, at.off);
  const sents = C.text.sentences(text.scene);
  const chapterSents = C.text.sentences(text.chapter);
  const found = sents.length ? C.suggest.suggest(sents, { chapter: { sentences: chapterSents.length, shapesUsed: suggestShapesUsed(chapterSents) } }) : null;
  if (!found) { say.textContent = t('Nothing to say yet.'); say.classList.add('kc-quiet'); return; }
  const why = document.createElement('span');
  why.className = 'kc-why';
  why.textContent = found.why;
  say.append(found.text, ' ', why);
}

// Zoom: the caret's paragraph, read by the local model (kept with the pass's
// readings, so one read serves both).
async function sayZoom(say, at, live) {
  const Zm = KibitzCraft.zoom;
  const [para] = Zm.paragraphsToRead(at.p.textContent);
  if (!para) { say.textContent = t('Too short to read yet.'); say.classList.add('kc-quiet'); return; }
  let levels = zoomCache.get(para.text);
  if (!levels) {
    say.textContent = t('Reading…');
    say.classList.add('kc-working');
    const [req] = Zm.questions(para.sentences.map((x) => x.text), Zm.CHOSEN.variant);
    const id = `menu-zoom-${menuRun}`;
    const res = await window.kibitz.decide({ id, model: Zm.CHOSEN.model, state: req.state, questions: req.questions });
    if (!live()) { if (window.kibitz.decideCancel) window.kibitz.decideCancel(id); return; }
    say.classList.remove('kc-working');
    if (res.error) { say.textContent = res.error.code === 'CANCELLED' ? '' : zoomTrouble(res.error, 'Zoom'); return; }
    levels = Zm.levels(res.answers, para.sentences.length).map((x) => (x ? Zm.stretch(x.level, Zm.CHOSEN.stretch) : null));
    zoomCache.set(para.text, levels);
  }
  const [f] = Zm.findings([para], [levels]).findings;
  say.textContent = '';
  if (!f) return;
  say.append(zoomCurve({ ...f, sentences: null }));
  const what = document.createElement('span');
  what.className = 'kc-why';
  what.textContent = f.label ? `${f.label}. ${f.note}` : t('No flag.');
  say.append(' ', what);
}

// Any key or click puts the card away (the menu keeps its own keys). Esc
// only puts it away: on the page it would also leave the book.
document.addEventListener('keydown', (e) => {
  if (!menuCardEl || (menuEl && menuEl.contains(e.target))) return;
  hideMenuCard();
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
}, true);
document.addEventListener('mousedown', (e) => { if (menuCardEl && !menuCardEl.contains(e.target)) hideMenuCard(); }, true);
window.addEventListener('resize', () => { hideMenuCard(); closeMenu(false); });

if (window.kibitz && window.kibitz.onMenu) {
  window.kibitz.onMenu((msg) => {
    if (msg.type !== 'helpMenu') return;
    if (menuEl) { closeMenu(true); return; }
    openMenu(msg.which);
  });
}
