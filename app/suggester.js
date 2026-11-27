'use strict';

/*  SENTENCE SHAPE SUGGESTER  */
// Kibitz's first helpful distraction. Finish a sentence and stop: after a
// pause, a gray line under the caret names one shape for the next sentence
// and says why ("Try a short one. Your last four sentences all ran 11 to 13
// words."). The first key, click or caret move takes it away. It never
// writes a word, and it only speaks at the edge of the writing: at the end
// of a paragraph with nothing written under it, so it covers nothing.
//
// The rules are craft/suggest.js (pure, tested in Node); this file only
// watches for the pause, gathers the scene and draws the line. The line
// hangs off the chapter's sheet, outside .chapter-body, the way the walking
// note does, so captureBody never sees it and no chapter file ever holds it.
// A feature (FEATURES in core), off until switched on. Desktop only: Pocket
// doesn't load craft/.

const SUGGEST_PAUSE_MS = 1800;   // quiet after the last keystroke before a suggestion
let suggestTimer = 0;
let suggestEl = null;
let suggestLast = null;          // { rule, at, chId }: the last suggestion shown
const suggestShapes = new Map(); // sentence text → its shapes, for the chapter-wide count

function suggesterOn() {
  return typeof KibitzCraft !== 'undefined' && !!KibitzCraft.suggest && featureOn('suggester') &&
    !!book && currentTab === 'manuscript' && !isScript() && !document.body.classList.contains('paged');
}

function hideSuggestion() {
  if (suggestEl) suggestEl.remove();
  suggestEl = null;
}

// Lines that are prose: not a ghost note, a scene break, a LitRPG box or a
// poem's lines, whose sentences follow other rules.
function suggestProse(p) {
  return p.tagName === 'P' && !p.classList.contains('ghost') && !p.classList.contains('scene-break') &&
    !p.classList.contains('litrpg') && !p.classList.contains('poetry');
}

// The scene so far (since the last scene break) and the chapter so far, as
// text with one paragraph a line, cut at `off` in the caret's paragraph.
function suggestText(body, p, off) {
  const scene = [];
  const chapter = [];
  for (const line of body.children) {
    if (line.classList.contains('scene-break')) scene.length = 0;
    if (suggestProse(line)) {
      const text = line === p ? line.textContent.slice(0, off) : line.textContent;
      scene.push(text);
      chapter.push(text);
    }
    if (line === p) break;
  }
  return { scene: scene.join('\n'), chapter: chapter.join('\n') };
}

function suggestShapesUsed(sents) {
  if (suggestShapes.size > 4000) suggestShapes.clear();
  const used = new Set();
  for (const s of sents) {
    if (!suggestShapes.has(s.text)) suggestShapes.set(s.text, KibitzCraft.shapes.shapesOf(s));
    for (const shape of suggestShapes.get(s.text)) used.add(shape);
  }
  return used;
}

// The pause is over: is the caret just after a finished sentence, at the
// edge of the writing, and does a rule have something to say?
function offerSuggestion() {
  suggestTimer = 0;
  if (!suggesterOn() || !document.hasFocus()) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const at = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
  const p = at && at.closest ? at.closest('.chapter-body > p') : null;
  if (!p || !suggestProse(p) || p.closest('.bookpage')) return;
  const body = p.parentElement;
  const off = flatOffset(p, range.endContainer, range.endOffset);
  if (off < 0) return;
  let before = p.textContent.slice(0, off);
  const after = p.textContent.slice(off);
  if (!before.trim() && !after.trim()) {
    // a fresh empty line after Enter: the sentence that ended the line above counts
    const above = p.previousElementSibling;
    if (!above || !suggestProse(above)) return;
    before = above.textContent;
  }
  if (!KibitzCraft.suggest.atSentenceEnd(before, after)) return;
  const C = KibitzCraft;
  const text = suggestText(body, p, off);
  const sents = C.text.sentences(text.scene);
  const chapterSents = C.text.sentences(text.chapter);
  const found = C.suggest.suggest(sents, { chapter: { sentences: chapterSents.length, shapesUsed: suggestShapesUsed(chapterSents) } });
  const chId = body.closest('.chapter').dataset.id;
  const previous = suggestLast && suggestLast.chId === chId ? suggestLast : null;
  if (!C.suggest.shouldShow(previous, found, sents.length)) return;
  if (showSuggestion(p, found)) suggestLast = { rule: found.rule, at: sents.length, chId };
}

// Draws the line under the caret, or doesn't when there's no room: the
// next paragraph or chapter would sit under it.
function showSuggestion(p, found) {
  hideSuggestion();
  const sheet = p.closest('.chapter');
  const body = p.parentElement;
  const caret = caretRect();
  if (!sheet || !caret) return false;
  const s = sheet.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  // under the caret's line, or under the walking note when it's there
  let top = Math.max(caret.bottom, p.getBoundingClientRect().bottom);
  const walk = p.hasAttribute('data-walk') && sheet.querySelector('.walk-note');
  if (walk) top = Math.max(top, walk.getBoundingClientRect().bottom);
  const el = document.createElement('div');
  el.className = 'kibitz-suggest';
  el.dataset.guide = found.shape || found.rule || ''; // ⌘L explains it (app/menus.js)
  el.contentEditable = 'false';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const say = document.createElement('span');
  say.className = 'ks-text';
  say.textContent = found.text;
  const why = document.createElement('span');
  why.className = 'ks-why';
  why.textContent = found.why;
  el.append(say, ' ', why);
  el.style.left = (b.left - s.left) + 'px';
  el.style.width = b.width + 'px';
  el.style.top = (top - s.top + 2) + 'px';
  sheet.appendChild(el);
  const below = p.nextElementSibling || sheet.nextElementSibling;
  const limit = below ? below.getBoundingClientRect().top : Infinity;
  if (el.getBoundingClientRect().bottom > limit) { el.remove(); return false; }
  suggestEl = el;
  return true;
}

// Typing in a chapter starts the wait over; anything at all takes the line away.
document.addEventListener('input', (e) => {
  hideSuggestion();
  clearTimeout(suggestTimer);
  suggestTimer = 0;
  if (e.target && e.target.closest && e.target.closest('.chapter-body') && suggesterOn()) {
    suggestTimer = setTimeout(offerSuggestion, SUGGEST_PAUSE_MS);
  }
}, true);
document.addEventListener('keydown', hideSuggestion, true);
document.addEventListener('mousedown', hideSuggestion, true);
document.addEventListener('selectionchange', () => { if (suggestEl) hideSuggestion(); });
window.addEventListener('resize', hideSuggestion);
window.addEventListener('blur', () => { clearTimeout(suggestTimer); suggestTimer = 0; });
