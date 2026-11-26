'use strict';

// CRAFT / SHAPES: what a sentence looks like from the outside. How it
// opens, which of the nine sentence shapes it resembles, and how a run of
// sentences moves (lengths, runs of the same length, funnels). The rules
// come from private/rules/writing-techniques.md ("Sentences").
//
// These are heuristics, not grammar: no parser, no word lists beyond a few
// small ones. A wrong guess costs a suggestion the writer ignores, so they
// lean towards staying quiet. Every threshold is a named constant here.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).shapes = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  const SHORT_MAX = 4;        // words: a short sentence ("Then my assignments.")
  const LONG_MIN = 30;        // words: a long one
  const DELAY_LEAD_MIN = 8;   // words held back before the subject arrives
  const DELAY_LEAD_SHARE = 0.4;
  const REVERSAL_MIN = 6;     // words: too short to turn
  const SAME_LENGTH_RUN = 3;  // sentences of about one length in a row
  const FUNNEL_MIN = 3;       // sentences, each shorter than the last

  // The nine shapes, in the order the video teaches them.
  const SHAPES = [
    { key: 'delay', label: 'Delay', about: 'holds its subject back to the end' },
    { key: 'contrast', label: 'Contrast', about: 'two halves pulling against each other' },
    { key: 'short', label: 'Short', about: 'a few words that land' },
    { key: 'list', label: 'List', about: 'a claim, then the details that prove it' },
    { key: 'repetition', label: 'Repetition', about: 'one word three times, on purpose' },
    { key: 'pileOn', label: 'Pile-on', about: 'and, and, and: more than grammar needs' },
    { key: 'building', label: 'Building', about: 'clauses that start the same way' },
    { key: 'reversal', label: 'Reversal', about: 'sets something up and flips it, often on the same word' },
    { key: 'long', label: 'Long', about: 'one deliberate sentence that travels' }
  ];

  const SUBORDINATORS = new Set(('when while after before as if because since although though unless until till once ' +
    'whenever wherever where whether even').split(' '));
  const PREPOSITIONS = new Set(('of in on at by for with from into onto under over behind past through across near beside between ' +
    'along around against among toward towards after before inside outside beneath above below beyond up down without within during').split(' '));
  const CONJUNCTIONS = new Set('and but or so yet then nor'.split(' '));

  const lower = (w) => w.toLowerCase().replace(/’/g, "'");

  // "Walking", "Counting": a participle that can open a sentence. Not the
  // -ing words that are nouns ("Nothing", "Morning", "King").
  const NOT_PARTICIPLES = new Set(['morning', 'evening', 'ceiling', 'spring', 'string', 'king', 'ring', 'wing', 'sing',
    'bring', 'sting', 'swing', 'thing', 'during', 'building', 'wedding', 'pudding', 'darling', 'sibling', 'duckling']);
  const isParticiple = (w) => /^\p{L}{3,}ing$/u.test(w) && !/thing$/.test(w) && !NOT_PARTICIPLES.has(w);

  // How a sentence opens:
  //   'dialogue'     it starts inside quotation marks
  //   'shortComma'   one word and a comma ("Still, ...", "Outside, ...")
  //   'clause'       a clause or phrase before the subject ("When the bus came, ...")
  //   'conjunction'  And, But, So, Then...
  //   'subject'      straight into the subject ("He...", "The base...", "Owen...")
  function opening(sentence) {
    const text = typeof sentence === 'string' ? sentence : sentence.text;
    if (/^["“«']/.test(text.trimStart())) return { kind: 'dialogue', word: '' };
    const ws = T.words(text);
    if (!ws.length) return { kind: 'subject', word: '' };
    const first = lower(ws[0].word);
    const comma = text.indexOf(',');
    const wordsBeforeComma = comma < 0 ? Infinity : ws.filter((w) => w.end <= comma).length;
    const leadsIn = SUBORDINATORS.has(first) || PREPOSITIONS.has(first) || isParticiple(first);
    if (leadsIn && comma >= 0) return { kind: 'clause', word: ws[0].word };
    if (wordsBeforeComma === 1) return { kind: 'shortComma', word: ws[0].word };
    if (CONJUNCTIONS.has(first)) return { kind: 'conjunction', word: ws[0].word };
    if (leadsIn) return { kind: 'clause', word: ws[0].word };
    return { kind: 'subject', word: ws[0].word };
  }

  function isDelay(text, ws) {
    const n = ws.length;
    if (n < DELAY_LEAD_MIN + 2) return false;
    const heads = ws.slice(0, 3).map((w) => lower(w.word));
    const prepEarly = heads.some((w) => PREPOSITIONS.has(w));
    const participle = isParticiple(heads[0]);
    const commas = [...text.matchAll(/,/g)].map((m) => m.index)
      .filter((at) => ws.filter((w) => w.end <= at).length <= n * 0.8);
    if ((prepEarly || participle) && commas.length >= 2) {
      const lead = ws.filter((w) => w.end <= commas[commas.length - 1]).length;
      if (lead >= DELAY_LEAD_MIN && lead / n >= DELAY_LEAD_SHARE) return true;
    }
    if (prepEarly && !commas.length) {
      const preps = ws.slice(0, Math.ceil(n * 0.6)).filter((w) => PREPOSITIONS.has(lower(w.word))).length;
      if (preps >= 3) return true;
    }
    return false;
  }

  function isList(text) {
    const colon = text.indexOf(':');
    if (colon > 0 && T.wordCount(text.slice(0, colon)) >= 2) {
      const items = text.slice(colon + 1).split(/,|;/).filter((c) => T.wordCount(c));
      if (items.length >= 3) return true;
    }
    const items = text.split(',').map((c) => c.trim()).filter((c) => T.wordCount(c));
    if (items.length < 3) return false;
    const last = items[items.length - 1];
    const middle = items.slice(1, -1);
    return /^(?:and|or)\s/i.test(last) && middle.every((c) => !/^(?:and|or|but|so|yet)\s/i.test(c));
  }

  // Content words of a sentence, stemmed, with their positions.
  function contentWords(ws) {
    return ws.map((w, i) => ({ key: T.stem(w.word), at: i })).filter((w) => !T.STOP_WORDS.has(w.key) && w.key.length > 2);
  }

  // The top-level clauses: the sentence cut at , ; : and dashes.
  function clauses(text) {
    return text.split(/[,;:]|\s[—–-]\s|—/).map((c) => c.trim()).filter((c) => T.wordCount(c));
  }

  // Which of the nine shapes a sentence resembles. Usually none or one;
  // sometimes two (a long list, a short reversal).
  function shapesOf(sentence) {
    const text = typeof sentence === 'string' ? sentence : sentence.text;
    const ws = T.words(text);
    const n = ws.length;
    const found = new Set();
    if (!n) return found;
    if (n <= SHORT_MAX) found.add('short');
    if (n >= LONG_MIN) found.add('long');

    // delay: the subject held back behind stacked phrases. Either a lead
    // of DELAY_LEAD_MIN+ words with two or more commas in it ("Past the dog
    // park, past the pool, past the fence, sat the one container"), or a
    // preposition in the first three words and three or more prepositions
    // before the sentence is three fifths done ("Far out in the uncharted
    // backwaters of the unfashionable end of ... lies a small yellow sun").
    if (isDelay(text, ws)) found.add('delay');

    // contrast: two halves of three words or more around ", but", ", yet",
    // ", not" or a semicolon
    const pivot = /,\s+(?:but|yet|not)\s|;\s/i.exec(text);
    if (pivot && T.wordCount(text.slice(0, pivot.index)) >= 3 && T.wordCount(text.slice(pivot.index)) >= 4) found.add('contrast');

    // list: a claim, a colon and three or more items after it, or three
    // or more items in a row, the last opened by and/or
    if (isList(text)) found.add('list');

    // building: three or more clauses that open on the same word
    const starts = clauses(text).map((c) => lower(T.words(c)[0].word));
    const startTally = new Map();
    for (const w of starts) startTally.set(w, (startTally.get(w) || 0) + 1);
    const builtOn = [...startTally].filter(([, c]) => c >= 3).map(([w]) => T.stem(w));
    if (builtOn.length) found.add('building');

    // repetition and reversal: content words that come back (not the word
    // a building sentence is built on; that's its own shape)
    const content = contentWords(ws).filter((w) => !builtOn.includes(w.key));
    const tally = new Map();
    for (const w of content) tally.set(w.key, (tally.get(w.key) || []).concat(w.at));
    const repeated = [...tally.values()];
    if (repeated.some((at) => at.length >= 3)) found.add('repetition');
    else if (n >= REVERSAL_MIN && repeated.some((at) => at.length === 2 && at[0] < n * 0.4 && at[1] >= n * 0.6)) found.add('reversal');

    // pile-on: three or more and/or where commas would do
    if ((text.match(/\b(?:and|or)\b/gi) || []).length >= 3) found.add('pileOn');

    return found;
  }

  // Runs of SAME_LENGTH_RUN or more sentences of about one length: the
  // longest within half the shortest (and within three words for short ones)
  // of the shortest. "Your last five sentences all ran 18 to 26 words."
  // Returns [{ from, to, min, max }], indices into the array, inclusive.
  function sameLengthRuns(lengths) {
    const fits = (lo, hi) => hi - lo <= Math.max(3, Math.round(lo * 0.5));
    const runs = [];
    let from = 0;
    while (from < lengths.length) {
      let lo = lengths[from];
      let hi = lengths[from];
      let to = from;
      while (to + 1 < lengths.length) {
        const nextLo = Math.min(lo, lengths[to + 1]);
        const nextHi = Math.max(hi, lengths[to + 1]);
        if (!fits(nextLo, nextHi)) break;
        lo = nextLo;
        hi = nextHi;
        to++;
      }
      if (to - from + 1 >= SAME_LENGTH_RUN) {
        runs.push({ from, to, min: lo, max: hi });
        from = to + 1;
      } else {
        from++;
      }
    }
    return runs;
  }

  // Funnels: FUNNEL_MIN or more sentences in one paragraph, each shorter
  // than the one before. Returns [{ from, to, paragraph }] (sentence indices).
  function funnels(sents) {
    const out = [];
    let from = 0;
    for (let i = 1; i <= sents.length; i++) {
      const goesOn = i < sents.length && sents[i].paragraph === sents[i - 1].paragraph && sents[i].words < sents[i - 1].words;
      if (goesOn) continue;
      if (i - from >= FUNNEL_MIN) out.push({ from, to: i - 1, paragraph: sents[from].paragraph });
      from = i;
    }
    return out;
  }

  // Everything about a run of sentences that the suggester and the rhythm
  // pass read: each sentence's length, opening and shapes, plus the runs.
  function rhythm(sents) {
    const lengths = sents.map((s) => s.words);
    const rows = sents.map((s) => ({ index: s.index, words: s.words, opening: opening(s).kind, shapes: shapesOf(s) }));
    return {
      rows,
      shortest: lengths.length ? Math.min(...lengths) : 0,
      longest: lengths.length ? Math.max(...lengths) : 0,
      mean: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
      sameLengthRuns: sameLengthRuns(lengths),
      funnels: funnels(sents),
      shapesUsed: new Set(rows.flatMap((r) => [...r.shapes]))
    };
  }

  return {
    SHORT_MAX, LONG_MIN, SAME_LENGTH_RUN, FUNNEL_MIN, SHAPES,
    opening, shapesOf, clauses, sameLengthRuns, funnels, rhythm
  };
});
