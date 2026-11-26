'use strict';

// CRAFT / SUGGEST: the sentence shape suggester's rhythm layer. You finish
// a sentence and stop; this decides whether to say anything about the next
// one, and what. It names one shape and gives one reason, and it never
// writes the sentence. The rules are the table in the NEO fork plan ("The
// rhythm layer"), checked in the order below, first match wins:
//
//   landLong     a very long sentence just ended    → a short one to land it
//   threeShort   three or more short ones in a row  → a long one, or a delay
//   funnel       a paragraph whose sentences shrink → finish it with a short one
//   sameLength   three or more of about one length  → break the run
//   threePart    a three-part sentence just ended   → anything but another
//   openings     three subject-first openings       → open on a clause or a word and a comma
//   noShort      nothing under four words lately    → a short one
//   unusedShape  a shape this chapter hasn't used   → that shape, as a nudge
//
// Quiet is the default: a rule needs a clear pattern, and shouldShow keeps
// suggestions a few sentences apart.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./shapes.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).suggest = factory(root.KibitzCraft.text, root.KibitzCraft.shapes);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T, S) => {
  const RUN_MIN = 3;               // sentences in a row for threeShort, sameLength, openings, funnel
  const NO_SHORT_SPAN = 8;         // sentences without one under four words
  const NO_SHORT_UNDER = 4;        // "under four words"
  const FUNNEL_NARROWS = 0.7;      // a funnel's last sentence, at most this share of its first
  const UNUSED_AFTER = 12;         // chapter sentences before a shape counts as unused
  const COOLDOWN = 3;              // new sentences between two suggestions
  const SAME_RULE_COOLDOWN = 6;    // ...and before the same rule speaks again

  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const num = (n) => NUMBER_WORDS[n] || String(n);

  // How many sentences at the end of the list pass the test.
  function trailing(list, test) {
    let k = 0;
    for (let i = list.length - 1; i >= 0 && test(list[i], i); i--) k++;
    return k;
  }

  const RULES = [
    ['landLong', (c) => c.last.words >= S.LONG_MIN && {
      shape: 'short', text: 'Land it with a short one, three to five words.', why: `That sentence ran ${num(c.last.words)} words.`
    }],
    ['threeShort', (c) => {
      const k = trailing(c.sents, (s) => s.words <= S.SHORT_MAX);
      return k >= RUN_MIN && { shape: 'long', text: 'Try a long one, or make the reader wait for it.', why: `The last ${num(k)} sentences were all ${num(S.SHORT_MAX)} words or fewer.` };
    }],
    ['funnel', (c) => {
      if (c.last.words <= S.SHORT_MAX) return null;
      const para = c.sents.filter((s) => s.paragraph === c.last.paragraph);
      const run = trailing(para, (s, i) => i > 0 && s.words < para[i - 1].words) + 1;
      const first = para[para.length - run];
      return run >= RUN_MIN && c.last.words <= first.words * FUNNEL_NARROWS && {
        shape: 'short', text: 'Finish the funnel with a short one.', why: 'Each sentence in this paragraph has been shorter than the one before.'
      };
    }],
    ['sameLength', (c) => {
      const run = S.sameLengthRuns(c.sents.map((s) => s.words)).find((r) => r.to === c.sents.length - 1);
      if (!run) return null;
      const k = run.to - run.from + 1;
      const mean = (run.min + run.max) / 2;
      const goShort = run.min >= 10 || (run.max > 8 && mean >= 12);
      const span = run.min === run.max ? `${num(run.min)} words` : `${num(run.min)} to ${num(run.max)} words`;
      return { shape: goShort ? 'short' : 'long', text: goShort ? 'Try a short one.' : 'Stretch one long.', why: `Your last ${num(k)} sentences all ran ${span}.` };
    }],
    ['threePart', (c) => c.shapesOf(c.last).has('list') && {
      shape: null, text: 'Anything but another three-part sentence.', why: 'That one came in threes.'
    }],
    ['openings', (c) => {
      // a short sentence breaks the run whatever it opens on
      const k = trailing(c.sents, (s) => s.words > S.SHORT_MAX && S.opening(s).kind === 'subject');
      return k >= RUN_MIN && {
        shape: null, text: 'Open on something other than the subject: a clause, or one word and a comma.', why: `The last ${num(k)} all started with the subject.`
      };
    }],
    ['noShort', (c) => {
      const k = trailing(c.sents, (s) => s.words >= NO_SHORT_UNDER);
      return k >= NO_SHORT_SPAN && { shape: 'short', text: 'Try a short one, under four words.', why: `Nothing under four words in the last ${num(k)} sentences.` };
    }],
    ['unusedShape', (c) => {
      if (c.chapter.sentences < UNUSED_AFTER) return null;
      const used = new Set([...c.chapter.shapesUsed, ...c.sents.flatMap((s) => [...c.shapesOf(s)])]);
      const next = S.SHAPES.find((s) => s.key !== 'short' && s.key !== 'long' && !used.has(s.key));
      return next && { shape: next.key, text: `Try a ${next.label.toLowerCase()} sentence: ${next.about}.`, why: 'This chapter hasn’t used one yet.' };
    }]
  ];

  // The suggestion for the sentence after the last of `sents` (the scene so
  // far, as text.sentences gives it), or null.
  //   opts.chapter  { sentences, shapesUsed } for the chapter up to here
  // Returns { rule, shape, text, why }; shape is a SHAPES key or null.
  function suggest(sents, opts = {}) {
    if (!sents.length) return null;
    const cache = new Map();
    const ctx = {
      sents,
      last: sents[sents.length - 1],
      chapter: opts.chapter || { sentences: sents.length, shapesUsed: new Set() },
      shapesOf: (s) => {
        if (!cache.has(s)) cache.set(s, S.shapesOf(s));
        return cache.get(s);
      }
    };
    for (const [rule, test] of RULES) {
      const found = test(ctx);
      if (found) return { rule, ...found };
    }
    return null;
  }

  // Whether the caret sits just after a finished sentence: the text before
  // it ends on . ! ? or an ellipsis (closing quotes allowed, spaces after
  // allowed), the text after it is empty, and the full stop isn't an
  // abbreviation's or an initial's.
  function atSentenceEnd(before, after = '') {
    if (after.trim() || !T.wordCount(before)) return false;
    const end = /(\.{3}|…|[.!?]+)["'”’)\]»]*\s*$/u.exec(before);
    if (!end) return false;
    if (end[1] === '.') {
      const word = /([\p{L}.]+)\.["'”’)\]»]*\s*$/u.exec(before);
      const w = word ? word[1].toLowerCase().replace(/^\.+/, '') : '';
      if (T.ABBREVIATIONS.has(w)) return false;
      if (/^\p{L}$/u.test(w) && w !== 'i' && !/\p{L}{2}\.["'”’)\]»]*\s*$/u.test(before)) return false;
    }
    return true;
  }

  // Whether to show `candidate` now, given the last one shown
  // ({ rule, at }, at = how many sentences the scene had then) and how many
  // it has now. Suggestions stay COOLDOWN sentences apart, and one rule
  // waits SAME_RULE_COOLDOWN before it repeats.
  function shouldShow(previous, candidate, sentences) {
    if (!candidate) return false;
    if (!previous || sentences < previous.at) return true; // a new scene, or text taken away
    const since = sentences - previous.at;
    return since >= (candidate.rule === previous.rule ? SAME_RULE_COOLDOWN : COOLDOWN);
  }

  return { RULES: RULES.map(([rule]) => rule), COOLDOWN, SAME_RULE_COOLDOWN, suggest, atSentenceEnd, shouldShow };
});
