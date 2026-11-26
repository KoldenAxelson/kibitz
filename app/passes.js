'use strict';

/*  REVISION PASSES  */
// Edit → Revision Pass ▸ Words to Cut, Rhythm, Echoes, Point of View,
// Clutter, Dialogue, Description, Time and Cast. A pass reads the chapter
// the caret is in, underlines what it finds with the CSS Highlight API (as
// the spellcheck pass does, so nothing touches the chapter's file) and
// lists it in a panel beside the page, with its summary on top. A click on
// an item puts the caret there; the pass reads the chapter again as you
// revise. It never changes a word. Choosing the same pass again, End Pass,
// the panel's × or Esc in the panel ends it.
//
// The passes themselves are craft/passes.js (pure, tested in Node). Zoom is
// the one that asks the local model (craft/zoom.js says what; decide.js in
// the main process asks): it reads a paragraph at a time, keeps each
// paragraph's levels so an edit only asks again about what changed, and
// says plainly in the panel when the model is waking or can't be reached.
// A feature (FEATURES in core), off until switched on.

const PASS_RESCAN_MS = 700;
const ZOOM_RESCAN_MS = 2000;  // the model is slower: wait for a real pause
const zoomCache = new Map();  // paragraph text → its levels, stretched
let zoomRun = 0;              // bumped to abandon a reading in progress
let zoomAsking = null;        // the id of the question out with the model
let passKey = null;      // the pass running, or null
let passChId = null;     // the chapter it read
let passFound = null;    // { findings, summary } from craft/passes.js
let passMarks = [];      // per finding, the Ranges to underline
let passSpans = [];      // per finding, the Range of the whole finding (null: about the chapter)
let passLines = null;    // the paragraphs read, for the quotes in the list
let passEl = null;
let passTimer = 0;

const passesReady = () => typeof KibitzCraft !== 'undefined' && !!KibitzCraft.passes;

// The chapter's text as the passes read it, one paragraph a line, and where
// each paragraph starts in it. A scene break is an empty line.
function passText(body) {
  const lines = [];
  const parts = [];
  let at = 0;
  for (const p of body.children) {
    if (p.tagName !== 'P' || p.classList.contains('ghost')) continue;
    const text = p.classList.contains('scene-break') ? '' : p.textContent;
    lines.push({ p, start: at, text });
    parts.push(text);
    at += text.length + 1;
  }
  return { text: parts.join('\n'), lines };
}

// An offset in that text → a point in the page.
function passPoint(lines, off) {
  let line = lines[0];
  for (const l of lines) {
    if (l.start > off) break;
    line = l;
  }
  return flatPoint(line.p, Math.min(off - line.start, line.text.length)) || [line.p, 0];
}

function passRange(lines, start, end) {
  if (!lines.length) return null;
  try {
    const r = new Range();
    r.setStart(...passPoint(lines, start));
    r.setEnd(...passPoint(lines, end));
    return r;
  } catch { return null; }
}

// The chapter the caret (or the scroll) is in, if it holds prose.
function passBody() {
  if (!book || currentTab !== 'manuscript' || isScript() || $('#editor-view').hidden) return null;
  const sheet = currentChapterId && document.querySelector(`.chapter[data-id="${currentChapterId}"]`);
  const body = sheet ? sheet.querySelector('.chapter-body') : document.querySelector('.chapter:not(.bookpage) .chapter-body');
  return body && !body.hidden && !body.closest('.bookpage') ? body : null;
}

const passNeedsModel = (key) => !!(KibitzCraft.passes.PASSES.find((p) => p.key === key) || {}).model;

function runPass(key) {
  if (!passesReady()) return;
  if (!passBody()) { toast(t('Open a chapter of prose to run a pass on it.')); return; }
  passKey = key;
  passRefresh();
}

function stopZoom() {
  zoomRun++;
  if (zoomAsking && window.kibitz.decideCancel) window.kibitz.decideCancel(zoomAsking);
  zoomAsking = null;
}

function endPass() {
  stopZoom();
  passKey = null;
  passFound = null;
  passMarks = [];
  passSpans = [];
  clearTimeout(passTimer);
  CSS.highlights.delete('kibitz-pass');
  CSS.highlights.delete('kibitz-pass-current');
  if (passEl) passEl.remove();
  passEl = null;
  document.body.classList.remove('kibitz-pass-open');
}

// Reads the chapter again and redraws the marks and the list.
function passRefresh() {
  passTimer = 0;
  if (!passKey) return;
  if (passNeedsModel(passKey)) { passZoom(); return; }
  const body = passBody();
  if (!body) { endPass(); return; }
  const { text, lines } = passText(body);
  passChId = body.closest('.chapter').dataset.id;
  passShow(KibitzCraft.passes.run(passKey, text), text, lines);
}

function passShow(found, text, lines) {
  passLines = lines;
  passFound = found;
  passSpans = found.findings.map((f) => (f.start === null ? null : passRange(lines, f.start, f.end)));
  passMarks = found.findings.map((f) => (f.start === null ? [] : (f.marks || [f]).map((m) => passRange(lines, m.start, m.end)).filter(Boolean)));
  paintPass(-1);
  renderPassPanel(text);
}

// Zoom: each paragraph of three sentences or more goes to the model in
// turn; the list fills in as answers come back.
async function passZoom() {
  stopZoom();
  const body = passBody();
  if (!body) { endPass(); return; }
  const run = zoomRun;
  const Zm = KibitzCraft.zoom;
  const { text, lines } = passText(body);
  passChId = body.closest('.chapter').dataset.id;
  const paras = Zm.paragraphsToRead(text);
  const levels = paras.map((p) => zoomCache.get(p.text) || null);
  const todo = paras.map((_, i) => i).filter((i) => !levels[i]);
  const live = () => run === zoomRun && passKey === 'zoom';
  const show = (status) => {
    if (!live()) return;
    const r = Zm.findings(paras, levels);
    passShow({ findings: r.findings, summary: status ? [status, ...r.summary] : r.summary }, text, lines);
  };
  show(todo.length ? (zoomCache.size ? t('Reading {n} paragraphs…', { n: todo.length }) : t('Waking the local model: the first time takes about half a minute.')) : '');
  for (let k = 0; k < todo.length; k++) {
    if (!live()) return;
    const i = todo[k];
    const [req] = Zm.questions(paras[i].sentences.map((x) => x.text), Zm.CHOSEN.variant);
    zoomAsking = `zoom-${run}-${i}`;
    const res = await window.kibitz.decide({ id: zoomAsking, model: Zm.CHOSEN.model, state: req.state, questions: req.questions });
    if (!live()) return;
    zoomAsking = null;
    if (res.error) {
      if (res.error.code !== 'CANCELLED') show(zoomTrouble(res.error));
      return;
    }
    levels[i] = Zm.levels(res.answers, paras[i].sentences.length).map((x) => (x ? Zm.stretch(x.level, Zm.CHOSEN.stretch) : null));
    zoomCache.set(paras[i].text, levels[i]);
    show(k + 1 < todo.length ? t('Reading paragraph {n} of {all}…', { n: k + 2, all: todo.length }) : '');
  }
}

function zoomTrouble(err) {
  if (err.code === 'NOT_RUNNING') return t('Zoom needs Ollaya, the local model, and it isn’t answering. {why}', { why: err.message });
  if (err.code === 'MODEL_NOT_FOUND') return t('Zoom needs the {model} model. In a terminal: ollaya pull {model}', { model: KibitzCraft.zoom.CHOSEN.model });
  if (err.code === 'TIMEOUT') return t('The local model took too long to answer. Try again in a moment.');
  return t('The local model couldn’t answer: {why}', { why: err.message });
}

// A paragraph's climb: a dot per sentence, the close-up at the bottom and
// the big idea at the top. Pointing at a dot lights its sentence.
function zoomCurve(f) {
  const NS = 'http://www.w3.org/2000/svg';
  const STEP = 22, H = 40, PAD = 4;
  const y = (x) => PAD + (5 - Math.min(5, Math.max(1, x))) * ((H - 2 * PAD) / 4);
  const svg = document.createElementNS(NS, 'svg');
  const w = (f.curve.length - 1) * STEP + 2 * PAD;
  svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', H);
  svg.setAttribute('class', 'kp-curve');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('Zoom levels: {levels}', { levels: f.curve.map((x) => (x === null ? '–' : x)).join(', ') }));
  for (const level of [1, 5]) {
    const g = document.createElementNS(NS, 'line');
    g.setAttribute('x1', 0); g.setAttribute('x2', w);
    g.setAttribute('y1', y(level)); g.setAttribute('y2', y(level));
    g.setAttribute('class', 'kp-guide');
    svg.appendChild(g);
  }
  const pts = f.curve.map((x, i) => (x === null ? null : [PAD + i * STEP, y(x)]));
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.filter(Boolean).map((p) => p.join(',')).join(' '));
  svg.appendChild(line);
  pts.forEach((p, i) => {
    if (!p) return;
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', p[0]);
    dot.setAttribute('cy', p[1]);
    dot.setAttribute('r', 3);
    const tip = document.createElementNS(NS, 'title');
    tip.textContent = t('Sentence {n}: {level}', { n: i + 1, level: f.curve[i] });
    dot.appendChild(tip);
    const s = f.sentences && f.sentences[i];
    if (s) {
      dot.addEventListener('mouseenter', () => {
        const r = passRange(passLines, s.start, s.end);
        if (r) CSS.highlights.set('kibitz-pass-current', new Highlight(r));
      });
      dot.addEventListener('mouseleave', () => paintPass(-1));
    }
    svg.appendChild(dot);
  });
  return svg;
}

function paintPass(current) {
  const all = new Highlight();
  const here = new Highlight();
  passMarks.forEach((ranges, i) => { for (const r of ranges) (i === current ? here : all).add(r); });
  CSS.highlights.set('kibitz-pass', all);
  CSS.highlights.set('kibitz-pass-current', here);
}

// A finding as the list shows it: a few words either side, the find marked.
function passQuote(text, f) {
  const line = passLines.filter((l) => l.start <= f.start).pop();
  const lineEnd = line.start + line.text.length;
  const end = Math.min(f.end, lineEnd);
  const from = Math.max(line.start, f.start - 32);
  const to = Math.min(lineEnd, end + 32);
  const q = document.createElement('span');
  q.className = 'kp-quote';
  const mark = document.createElement('mark');
  const found = text.slice(f.start, end);
  mark.textContent = found.length > 90 ? found.slice(0, 88).trimEnd() + '…' : found;
  q.append((from > line.start ? '…' : '') + text.slice(from, f.start), mark, text.slice(end, to) + (to < lineEnd || end < f.end ? '…' : ''));
  return q;
}

function renderPassPanel(text) {
  const listTop = passEl ? passEl.querySelector('.kp-list').scrollTop : 0;
  if (!passEl) {
    passEl = document.createElement('aside');
    passEl.className = 'kibitz-pass';
    passEl.setAttribute('aria-label', t('Revision pass'));
    passEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endPass(); focusPage(); }
    });
    document.body.appendChild(passEl);
    document.body.classList.add('kibitz-pass-open');
  }
  passEl.textContent = '';
  const head = document.createElement('header');
  const which = document.createElement('select');
  which.className = 'kp-which';
  which.setAttribute('aria-label', t('Which pass'));
  for (const p of KibitzCraft.passes.PASSES) which.add(new Option(t(p.label), p.key, false, p.key === passKey));
  which.addEventListener('change', () => runPass(which.value));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'kp-close';
  close.textContent = '×';
  close.title = t('End the pass');
  close.setAttribute('aria-label', t('End the pass'));
  close.addEventListener('click', () => { endPass(); focusPage(); });
  head.append(which, close);
  // What a pass looks for is the select's tooltip, not text in the panel
  which.title = t(KibitzCraft.passes.PASSES.find((p) => p.key === passKey).about);
  const summary = document.createElement('div');
  summary.className = 'kp-summary';
  for (const line of passFound.summary) {
    const p = document.createElement('p');
    p.textContent = line;
    summary.appendChild(p);
  }
  const list = document.createElement('ol');
  list.className = 'kp-list';
  passFound.findings.forEach((f, i) => {
    const li = document.createElement('li');
    const item = document.createElement(f.start === null ? 'div' : 'button');
    item.className = 'kp-item';
    const label = document.createElement('span');
    label.className = 'kp-label';
    label.textContent = f.label;
    const note = document.createElement('span');
    note.className = 'kp-note';
    note.textContent = f.note;
    if (f.curve && !f.label) item.classList.add('kp-fine');
    item.append(...(f.label ? [label] : []), ...(f.curve ? [zoomCurve(f)] : []), ...(f.start === null ? [] : [passQuote(text, f)]), ...(f.note ? [note] : []));
    if (f.start !== null) {
      item.type = 'button';
      item.addEventListener('click', () => showPassFinding(i, item));
    }
    li.appendChild(item);
    list.appendChild(li);
  });
  passEl.append(head, ...(passFound.summary.length ? [summary] : []), list);
  if (!passFound.findings.length) {
    const none = document.createElement('p');
    none.className = 'kp-empty';
    none.textContent = t('Nothing found in this chapter.');
    passEl.appendChild(none);
  }
  list.scrollTop = listTop;
}

// A click on an item: the caret to the start of the find, the find in view
// and marked as the one being looked at. (The caret, not a selection: a
// key pressed next must never replace the writer's words.)
function showPassFinding(i, item) {
  const span = passSpans[i];
  if (!span || !span.startContainer.isConnected) { passRefresh(); return; }
  paintPass(i);
  for (const el of passEl.querySelectorAll('.kp-item.current')) el.classList.remove('current');
  item.classList.add('current');
  const caret = span.cloneRange();
  caret.collapse(true);
  const body = span.startContainer.parentElement.closest('.chapter-body');
  if (body) body.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(caret);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  (span.startContainer.nodeType === Node.TEXT_NODE ? span.startContainer.parentElement : span.startContainer)
    .scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

function queuePassRefresh() {
  if (!passKey) return;
  clearTimeout(passTimer);
  passTimer = setTimeout(passRefresh, passNeedsModel(passKey) ? ZOOM_RESCAN_MS : PASS_RESCAN_MS);
}

// Writing in the chapter reads it again; moving to another chapter reads
// that one; leaving the manuscript ends the pass.
document.addEventListener('input', (e) => {
  if (passKey && e.target && e.target.closest && e.target.closest('.chapter-body')) queuePassRefresh();
}, true);
document.addEventListener('selectionchange', () => {
  if (passKey && currentChapterId && currentChapterId !== passChId) queuePassRefresh();
});
const passStillHere = () => { if (passKey && !passBody()) endPass(); };
document.addEventListener('click', () => setTimeout(passStillHere), true);
document.addEventListener('keyup', () => setTimeout(passStillHere), true);

// (Not on Pocket: its bridge keeps a single menu listener, the window's
// own, and the passes are desktop only.)
if (window.kibitz && window.kibitz.onMenu) {
  window.kibitz.onMenu((msg) => {
    if (msg.type !== 'revisionPass') return;
    if (!msg.pass || msg.pass === passKey) endPass();
    else runPass(msg.pass);
  });
}
