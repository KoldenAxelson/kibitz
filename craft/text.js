'use strict';

// CRAFT / TEXT: the pieces every craft rule stands on. Paragraphs,
// sentences, words and the stretches inside quotation marks, each with its
// offsets in the text it came from, so a pass can paint exactly what it
// found with the CSS Highlight API.
//
// Plain JavaScript with no DOM: it runs in the window (KibitzCraft.text)
// and in Node (require('./craft/text.js')). Text in, plain objects out.
// English first; the splitting rules are written so other languages that
// end sentences with . ! ? degrade gracefully rather than break.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.KibitzCraft = root.KibitzCraft || {}).text = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // A full stop after one of these doesn't end the sentence.
  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'mx', 'dr', 'st', 'sr', 'jr', 'prof', 'rev', 'hon', 'fr',
    'sgt', 'lt', 'col', 'gen', 'capt', 'cpt', 'cpl', 'pvt', 'maj', 'adm', 'cmdr', 'gov', 'pres', 'sen', 'rep',
    'vs', 'etc', 'eg', 'ie', 'cf', 'al', 'approx', 'dept', 'est', 'no', 'vol', 'fig', 'ft', 'mt', 'ave', 'blvd', 'rd',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'a.m', 'p.m', 'e.g', 'i.e', 'u.s', 'u.k'
  ]);

  // Small words that turn up in every paragraph and say nothing by
  // repeating. "every" is left out on purpose: anaphora is an echo worth
  // seeing.
  const STOP_WORDS = new Set(('a an the and or but if so of to in on at by for with from into onto up down out over off as ' +
    'is was were be been being am are has have had do did does done not no nor than then that this these those ' +
    'it its it\'s i me my mine we us our you your he him his she her they them their there here what which who whom ' +
    'when where why how all any some can could would should will shall may might must just very too also ' +
    's t don didn wasn isn couldn wouldn i\'m i\'d i\'ll he\'d he\'s she\'s we\'re they\'re you\'re one').split(' '));

  // Lowercase, curly apostrophes straightened, a possessive and a plain
  // plural -s dropped: crude on purpose, enough to pair "container" with
  // "containers" and "Owen's" with "Owen".
  function stem(word) {
    let w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
    if (w.length > 3 && /[^s]s$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  // A word: letters and digits, with inner apostrophes and hyphens kept
  // ("don't", "forty-third"), as a word processor counts them.
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;

  // What may end a sentence: an ellipsis or a run of . ! ?, then any closing
  // quotes or brackets, then a space or the end of the paragraph.
  const END_RE = /(\.{3}|…|[.!?]+)(["'”’)\]»]*)(?=\s|$)/g;

  function words(text) {
    const out = [];
    for (const m of text.matchAll(WORD_RE)) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }

  function wordCount(text) {
    return (text.match(WORD_RE) || []).length;
  }

  // Paragraphs are lines: Kibitz's chapters are one <p> per paragraph, and
  // a caller flattening them joins with "\n".
  function paragraphs(text) {
    const out = [];
    const re = /[^\n]+/g;
    let m;
    while ((m = re.exec(text))) {
      const lead = m[0].length - m[0].trimStart().length;
      const body = m[0].trim();
      if (body) out.push({ index: out.length, start: m.index + lead, end: m.index + lead + body.length, text: body });
    }
    return out;
  }

  // The word just before a full stop, lowercased, dots kept ("a.m"), so the
  // abbreviation check can see it.
  function wordBefore(text, at) {
    let i = at;
    while (i > 0 && /[\p{L}.]/u.test(text[i - 1])) i--;
    return text.slice(i, at).toLowerCase().replace(/^\.+/, '');
  }

  // Does the terminator matched at m end a sentence, given what follows?
  function endsHere(text, m, stop) {
    const after = text.slice(m.index + m[0].length, stop).trimStart();
    if (!after) return true;
    const next = after[0];
    // "Go!" he said. / "Wait..." she whispered. / e.g. this: a lowercase
    // start means the sentence carries on.
    if (/\p{Ll}/u.test(next)) return false;
    if (m[1] === '.') {
      const before = wordBefore(text, m.index);
      if (ABBREVIATIONS.has(before)) return false;
      // An initial: "J. R. Hartley", "Sgt. K. Ruiz" (but "It was I." ends)
      const letter = text.slice(m.index - 1, m.index);
      if (/^\p{Lu}$/u.test(letter) && letter !== 'I' && !/\p{L}/u.test(text[m.index - 2] || '')) return false;
    }
    return true;
  }

  // Sentences with offsets, never crossing a paragraph. Each carries its
  // word count and the paragraph it belongs to.
  function sentences(text) {
    const out = [];
    for (const para of paragraphs(text)) {
      let from = para.start;
      END_RE.lastIndex = from;
      let m;
      const cut = (to) => {
        const raw = text.slice(from, to);
        const lead = raw.length - raw.trimStart().length;
        const body = raw.trim();
        if (body && wordCount(body)) {
          out.push({ index: out.length, paragraph: para.index, start: from + lead, end: from + lead + body.length, text: body, words: wordCount(body) });
        }
        from = to;
      };
      while ((m = END_RE.exec(text)) && m.index < para.end) {
        const to = m.index + m[0].length;
        if (to > para.end) break;
        if (endsHere(text, m, para.end)) cut(to);
      }
      cut(para.end);
    }
    return out;
  }

  // The stretches inside double quotation marks, marks included. Curly
  // quotes pair by shape; straight ones alternate. Speech left open at a
  // paragraph's end (a speech running on to the next paragraph) closes there.
  function quoteRanges(text) {
    const out = [];
    for (const para of paragraphs(text)) {
      let open = -1;
      for (let i = para.start; i < para.end; i++) {
        const c = text[i];
        if (open < 0 && (c === '“' || c === '"' || c === '«')) open = i;
        else if (open >= 0 && (c === '”' || c === '"' || c === '»')) {
          out.push({ start: open, end: i + 1 });
          open = -1;
        }
      }
      if (open >= 0) out.push({ start: open, end: para.end });
    }
    return out;
  }

  function inRanges(at, ranges) {
    return ranges.some((r) => at >= r.start && at < r.end);
  }

  // Fraction of a span's words that sit inside quotation marks.
  function quotedShare(text, span, ranges = quoteRanges(text)) {
    const ws = words(text.slice(span.start, span.end));
    if (!ws.length) return 0;
    return ws.filter((w) => inRanges(span.start + w.start, ranges)).length / ws.length;
  }

  return { ABBREVIATIONS, STOP_WORDS, stem, words, wordCount, paragraphs, sentences, quoteRanges, inRanges, quotedShare };
});
