'use strict';

// CRAFT / CUT: the "words to cut" table from the Writing Techniques notes,
// as a search. Weasel, puff, filter, time, empty, inflation, hedge and
// doubled words, plus runs of prepositional phrases and runs of tiny words.
// Every hit is a prompt to look, never a rule: most of these are fine once
// and a habit by the tenth time, which is why counts come per thousand
// words. Hedges inside quotation marks are let off by default, because
// people hedge when they talk.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).cut = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  const CHAIN_MIN = 3;        // prepositional phrases in a row before a run is flagged
  const PHRASE_MAX_WORDS = 4; // words a phrase may run before the next preposition
  const TINY_RUN = 5;         // tiny words in a row ("it was to be a")
  const TINY_MAX = 3;         // letters in a tiny word

  const POSSESSIVE = '(?:my|his|her|their|your|our)';

  // The table's examples plus their near neighbours. `patterns` are regex
  // sources for phrases with a slot in them.
  const KINDS = [
    { key: 'weasel', label: 'Weasel', instead: 'cut it', phrases: ['that', 'just'] },
    { key: 'puff', label: 'Puff', instead: 'use, begin, try',
      phrases: ['utilize', 'utilized', 'utilizes', 'utilise', 'utilised', 'commence', 'commenced', 'endeavor', 'endeavored',
        'endeavour', 'facilitate', 'facilitated', 'in order to', 'ascertain'] },
    { key: 'filter', label: 'Filter', instead: 'show the thing seen',
      phrases: ['saw', 'noticed', 'notice', 'watched', 'felt', 'heard', 'realized', 'realised', 'wondered', 'seemed'] },
    { key: 'time', label: 'Time', instead: 'let the event arrive',
      phrases: ['suddenly', 'all of a sudden', 'and then', 'finally', 'immediately', 'at that moment'] },
    { key: 'empty', label: 'Empty', instead: 'name the thing', phrases: ['something', 'stuff', 'things', 'there was', 'there were'] },
    { key: 'inflation', label: 'Inflation', instead: 'a stronger noun or verb',
      phrases: ['really', 'very', 'totally', 'actually', 'extremely', 'literally', 'absolutely', 'quite'] },
    { key: 'hedge', label: 'Hedge', instead: 'commit, which reads as authority',
      phrases: ['usually', 'sort of', 'kind of', 'maybe', 'perhaps', 'probably', 'somewhat', 'a bit'] },
    { key: 'doubled', label: 'Doubled', instead: 'sat, nodded, whispered',
      phrases: ['sat down', 'sit down', 'sits down', 'sitting down', 'stood up', 'stand up', 'stands up', 'standing up', 'whispered quietly', 'shouted loudly', 'end result', 'each and every', 'past history'],
      patterns: [`nodded ${POSSESSIVE} heads?`, `shrugged ${POSSESSIVE} shoulders`, `blinked ${POSSESSIVE} eyes`] }
  ];
  // Kinds found by shape rather than by word, listed so callers can label them.
  const RUN_KINDS = [
    { key: 'chain', label: 'Preposition chain', instead: 'cut a phrase or two' },
    { key: 'tiny', label: 'Tiny words', instead: 'cut the second half' }
  ];

  const PREPOSITIONS = new Set(('of in on at by for with from into onto under over behind past through across near beside between ' +
    'along around against among toward towards after before inside outside beneath above below beyond during').split(' '));

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word edges that know letters beyond ASCII and treat apostrophes as
  // part of a word ("that's" is not "that").
  const edge = (body) => new RegExp(`(?<![\\p{L}\\p{N}'’])(?:${body})(?![\\p{L}\\p{N}]|['’]\\p{L})`, 'giu');

  for (const kind of KINDS) {
    // longest first, so "and then" wins over a shorter match at the same spot
    const parts = kind.phrases.slice().sort((a, b) => b.length - a.length).map((p) => escapeRe(p).replace(/ /g, '\\s+'));
    kind.re = edge(parts.concat(kind.patterns || []).join('|'));
  }

  // Runs of CHAIN_MIN+ prepositions, each within PHRASE_MAX_WORDS words of
  // the last with no punctuation between, marked from the first preposition
  // to the end of the last phrase.
  function chains(text) {
    const ws = T.words(text);
    const found = [];
    let run = [];
    const broken = (a, b) => /[.,;:!?"“”()—]/.test(text.slice(ws[a].end, ws[b].start));
    const close = (stopAt) => {
      if (run.length >= CHAIN_MIN) {
        const last = run[run.length - 1];
        const end = Math.min(stopAt, last + PHRASE_MAX_WORDS + 1) - 1;
        found.push({ start: ws[run[0]].start, end: ws[end].end, kind: 'chain' });
      }
      run = [];
    };
    for (let i = 0; i < ws.length; i++) {
      if (i > 0 && broken(i - 1, i)) close(i);
      if (run.length && i - run[run.length - 1] > PHRASE_MAX_WORDS) close(i);
      if (PREPOSITIONS.has(ws[i].word.toLowerCase())) run.push(i);
    }
    close(ws.length);
    return found;
  }

  // Runs of TINY_RUN+ words of TINY_MAX letters or fewer, with no
  // punctuation between: no nouns, no strong verbs, nothing carrying weight.
  function tinyRuns(text) {
    const ws = T.words(text);
    const found = [];
    let from = -1;
    const close = (to) => {
      if (from >= 0 && to - from >= TINY_RUN) found.push({ start: ws[from].start, end: ws[to - 1].end, kind: 'tiny' });
      from = -1;
    };
    for (let i = 0; i < ws.length; i++) {
      const tiny = ws[i].word.replace(/['’]/g, '').length <= TINY_MAX;
      const joined = i > 0 && !/[.,;:!?"“”()—]/.test(text.slice(ws[i - 1].end, ws[i].start));
      if (tiny && from >= 0 && joined) continue;
      close(i);
      if (tiny) from = i;
    }
    close(ws.length);
    return found;
  }

  // Everything the table finds in a text.
  //   opts.hedgesInDialogue  count hedges inside quotation marks (default false)
  // Returns { hits, counts, perThousand, words, total }: hits sorted by
  // position, word hits never overlapping each other (runs may overlap them).
  function find(text, opts = {}) {
    const quotes = opts.hedgesInDialogue ? [] : T.quoteRanges(text);
    const wordHits = [];
    for (const kind of KINDS) {
      kind.re.lastIndex = 0;
      for (const m of text.matchAll(kind.re)) {
        if (kind.key === 'hedge' && T.inRanges(m.index, quotes)) continue;
        wordHits.push({ start: m.index, end: m.index + m[0].length, kind: kind.key, text: m[0] });
      }
    }
    // longest first at one spot, then drop anything overlapping a kept hit
    wordHits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const kept = [];
    for (const h of wordHits) if (!kept.length || h.start >= kept[kept.length - 1].end) kept.push(h);
    const runs = chains(text).concat(tinyRuns(text)).map((r) => ({ ...r, text: text.slice(r.start, r.end) }));
    const hits = kept.concat(runs).sort((a, b) => a.start - b.start || a.end - b.end);

    const words = T.wordCount(text);
    const counts = {};
    for (const k of KINDS.concat(RUN_KINDS)) counts[k.key] = 0;
    for (const h of hits) counts[h.kind]++;
    const perThousand = {};
    for (const k of Object.keys(counts)) perThousand[k] = words ? Math.round(counts[k] / words * 10000) / 10 : 0;
    return { hits, counts, perThousand, words, total: hits.length };
  }

  return { KINDS: KINDS.map(({ re, ...k }) => k), RUN_KINDS, CHAIN_MIN, TINY_RUN, find, chains, tinyRuns };
});
