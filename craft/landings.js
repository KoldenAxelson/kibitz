'use strict';

// CRAFT / LANDINGS: each sentence's first word and the word it ends on.
// Flags an opening that repeats the sentence before it ("He... He...
// He...") and a landing on a word that carries nothing, so the most
// important information can go last instead. Prompts, never rules.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).landings = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  // Endings that rarely carry the point of a sentence.
  const WEAK = new Set(['it', 'them', 'him', 'her', 'there', 'then', 'too', 'also', 'again', 'now', 'though', 'anyway',
    'really', 'very', 'that', 'this', 'things', 'stuff', 'something', 'anything', 'everything', 'so', 'yet', 'well']);
  // Words ending in -ly that aren't adverbs.
  const NOT_ADVERBS = new Set(['family', 'only', 'early', 'reply', 'supply', 'apply', 'ally', 'rally', 'belly', 'holly',
    'july', 'italy', 'fly', 'ugly', 'holy', 'lonely', 'lovely', 'friendly', 'silly', 'jelly', 'bully', 'lily',
    'daily', 'weekly', 'monthly', 'yearly', 'likely', 'unlikely', 'elderly', 'curly', 'hilly', 'chilly', 'jolly']);

  function weakLanding(word) {
    const w = word.toLowerCase().replace(/’/g, "'");
    if (WEAK.has(w)) return true;
    return w.length > 4 && /ly$/.test(w) && !NOT_ADVERBS.has(w);
  }

  // One row per sentence: { index, opening, landing, sameOpening, weak },
  // opening and landing as { word, start, end } in the text's offsets.
  function find(text, sents = T.sentences(text)) {
    let previous = '';
    return sents.map((s) => {
      const ws = T.words(s.text);
      const first = ws[0];
      const last = ws[ws.length - 1];
      const key = first.word.toLowerCase();
      const row = {
        index: s.index,
        opening: { word: first.word, start: s.start + first.start, end: s.start + first.end },
        landing: { word: last.word, start: s.start + last.start, end: s.start + last.end },
        sameOpening: key === previous,
        weak: weakLanding(last.word)
      };
      previous = key;
      return row;
    });
  }

  return { find, weakLanding };
});
