'use strict';

// CRAFT / ECHOES: words that come back within WINDOW_WORDS of an earlier
// use. Accidental repeats read as sloppy and chosen ones as clever, so this
// only finds them; the writer decides which are which. Stems are crude on
// purpose (text.stem): "container" pairs with "containers".

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).echoes = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  const WINDOW_WORDS = 40;
  const MIN_LETTERS = 3;

  // Returns [{ key, count, hits: [{ start, end, word }] }], in order of
  // first appearance. `hits` holds every use of an echoed word in the text,
  // so the whole pattern can be painted.
  function find(text, opts = {}) {
    const span = opts.window || WINDOW_WORDS;
    const ws = T.words(text).map((w, i) => ({ ...w, at: i, key: T.stem(w.word) }));
    const lastSeen = new Map();
    const echoed = new Set();
    for (const w of ws) {
      if (T.STOP_WORDS.has(w.key) || w.key.length < MIN_LETTERS) continue;
      if (lastSeen.has(w.key) && w.at - lastSeen.get(w.key) <= span) echoed.add(w.key);
      lastSeen.set(w.key, w.at);
    }
    const out = new Map();
    for (const w of ws) {
      if (!echoed.has(w.key)) continue;
      if (!out.has(w.key)) out.set(w.key, { key: w.key, count: 0, hits: [] });
      const e = out.get(w.key);
      e.count++;
      e.hits.push({ start: w.start, end: w.end, word: w.word });
    }
    return [...out.values()];
  }

  return { WINDOW_WORDS, find };
});
