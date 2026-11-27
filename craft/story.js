'use strict';

// CRAFT / STORY: the sentence shape suggester's story layer, take two.
// The model reads; the rules decide. At a pause after a finished sentence,
// the local decision model (decide.js) answers yes or no to a few
// questions about the scene as written ("Is something about to be
// shown?"), and a fixed table turns the first yes into one shape and one
// reason. The model never picks the advice. (Take one, where it picked the
// shape, failed its test: it's parked on the story-layer branch.)
//
// Take three (Konrad's ladder): the model doesn't say yes or no outright.
// It compares the moment with five reference passages per reading
// (craft/ladders.js, rung 1 clearly not ... rung 3 borderline ... rung 5
// strongly), and the sum of its yes-chances is the moment's level, 0-5. A
// reading counts at LADDER_CUT: beating the borderline rung.
//
// The questions, their shapes and their order: private/plan/story-reading.md
// (and the research behind them). Which questions ship, and how sure the
// model must be for each, is measured by tools/story-eval.js.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./shapes.js'), require('./scenes.js'), require('./ladders.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).story = factory(root.KibitzCraft.text, root.KibitzCraft.shapes, root.KibitzCraft.scenes, root.KibitzCraft.ladders);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T, S, SC, LD) => {
  const MODEL = 'winnow:e4b';
  const MAX_WORDS = 120;           // the scene's last few sentences: these are local readings
  const TIMEOUT_MS = 2500;

  // [key, the question, the shape a yes asks for, the reason shown], in
  // the order a yes is taken: what can't wait first.
  const READINGS = [
    ['landed', 'Did the last sentence or two land something: a decision, a blow, a realisation, or a verdict?', 'short', 'Something just landed.'],
    ['reveal', 'Is something on the page about to be shown that has not been shown yet: someone arriving, a door about to open, a letter not yet read, an answer, a face?', 'delay', 'Something’s about to be shown.'],
    ['setup', 'Has a hope, a plan, a promise or an expectation just been set up, and not yet been tested?', 'reversal', 'A hope was just set up.'],
    ['overwhelm', 'Is someone being buried by too much at once: things, demands or feelings piling up on them?', 'pileOn', 'It’s too much at once.'],
    ['rising', 'Has tension or feeling been climbing over the last few sentences, without reaching its peak yet?', 'building', 'It’s climbing.'],
    ['stock', 'Is the point-of-view character taking stock of a place, a person or a situation?', 'list', 'They’re taking stock.'],
    ['pull', 'Are two things pulling against each other: what someone wants and what they get, two people, or a choice between two bad options?', 'contrast', 'Two things pull apart.'],
    ['fixed', 'Is someone fixated, coming back to one thing again and again?', 'repetition', 'They can’t let it go.'],
    ['opening', 'Has the scene slowed into memory, travel, reflection, or a view taken in slowly?', 'long', 'It’s opening out.']
  ];
  const KEYS = READINGS.map((r) => r[0]);
  const SHAPE_TEXT = {
    short: 'Land a short one.',
    delay: 'Try a delay: hold the subject back to the end.',
    reversal: 'Try a reversal: set it up and flip it.',
    pileOn: 'Pile it on: and, and, and.',
    building: 'Build it: clauses that start the same way.',
    list: 'Try a list: the claim, then the details that prove it.',
    contrast: 'Try a contrast: two halves pulling against each other.',
    repetition: 'Try repetition: one word three times, on purpose.',
    long: 'Let one run long.'
  };

  // How sure the model must be for each reading to count as a yes; a
  // reading that isn't here isn't asked (it failed, or isn't measured yet).
  // Set by tools/story-eval.js on the dev split.
  const THRESHOLDS = {};

  const LADDER_CUT = 3;

  // One request for one reading: the moment and its ladder in the state, a
  // yes/no comparison per rung.
  function ladderQuestion(input, key, ladder = LD.LADDERS[key]) {
    const reading = READINGS.find((r) => r[0] === key);
    if (!reading || !ladder) throw new Error(`No ladder for ${key}`);
    const c = context(input);
    const state = [c, '', 'Reference passages:', ...ladder.map((t, i) => `Passage ${i + 1}: ${t}`)].join('\n');
    return {
      model: MODEL,
      state,
      questions: Object.fromEntries(ladder.map((_, i) => [`r${i + 1}`, {
        type: 'choice',
        instructions: `The question: ${reading[1]} Compare the scene so far, at the moment its last sentence ends, with reference passage ${i + 1}. Does the scene show this more clearly than passage ${i + 1} does?`,
        criteria: { yes: 'Yes, the scene shows it more clearly.', no: 'No, the passage shows it as clearly or more.' }
      }]))
    };
  }

  // The level from a ladder's answers: the sum of the yes-chances (0-5),
  // or null when no rung was answered.
  function ladderLevel(answers) {
    let sum = 0;
    let n = 0;
    for (const [k, a] of Object.entries(answers || {})) {
      if (!/^r\d+$/.test(k) || !a || (a.choice !== 'yes' && a.choice !== 'no')) continue;
      const p = a.probabilities && Number.isFinite(a.probabilities.yes) ? a.probabilities.yes
        : Number.isFinite(a.confidence) ? (a.choice === 'yes' ? a.confidence : 1 - a.confidence) : null;
      if (p === null) continue;
      sum += p;
      n++;
    }
    return n ? sum : null;
  }

  // STRONGEST MOMENTS (beta). Yes/no calls on these readings never got
  // precise enough, but the model ranks well: in a chapter, its 3 strongest
  // moments for a reading usually hold a real one (report-topn.md). So the
  // pass ranks and never claims. SHOWN passed the pre-registered top-3 test;
  // PROVISIONAL passed on the training books but the test had too few
  // chapters to confirm. The rest are held back.
  const STRONGEST = { shown: ['landed', 'opening'], provisional: ['rising', 'reveal'], top: 3, minMoments: 4 };
  const MIN_BEFORE = 40;           // words before a moment: the model needs some scene to read
  const STRONG_LABEL = { landed: 'Lands', opening: 'Opens out', rising: 'Climbs', reveal: 'About to show' };

  // The moments a chapter is ranked over: each narrated paragraph's last
  // sentence (a beat the writer can find), with what the model reads there.
  // A paragraph that's mostly speech isn't a moment.
  function moments(text) {
    const quotes = T.quoteRanges(text);
    const sents = T.sentences(text);
    const end = text.trimEnd().length;
    const out = [];
    let words = 0;
    for (const s of sents) {
      words += s.words;
      const after = text.slice(s.end, s.end + 4);
      if (!(s.end >= end || /^\s*\n/.test(after))) continue;
      if (words - s.words < MIN_BEFORE || T.quotedShare(text, s, quotes) > 0.2) continue;
      out.push({ start: s.start, end: s.end, view: tail(text.slice(0, s.end)) });
    }
    return out;
  }

  // The readings the pass asks about, in the order it lists them.
  const strongestKeys = (cfg = STRONGEST) => cfg.shown.concat(cfg.provisional);

  // Per reading, the moments with the highest chance, best first:
  // [{ key, provisional, picks: [{ index, chance }] }]. Empty with too few
  // moments to rank.
  function strongest(chances, cfg = STRONGEST) {
    const read = chances.filter(Boolean).length;
    if (read < cfg.minMoments) return [];
    return strongestKeys(cfg).map((key) => ({
      key,
      provisional: cfg.provisional.includes(key),
      picks: chances.map((c, index) => ({ index, chance: c && Number.isFinite(c[key]) ? c[key] : null }))
        .filter((x) => x.chance !== null).sort((a, b) => b.chance - a.chance || a.index - b.index).slice(0, cfg.top)
    }));
  }

  // Rhythm rules that name a real rhythm problem speak before the story.
  const RHYTHM_FIRST = new Set(['landLong', 'threeShort', 'funnel', 'sameLength', 'noShort']);

  // The scene's last `max` words, starting at a sentence.
  function tail(scene, max = MAX_WORDS) {
    const sents = T.sentences(scene);
    let words = 0;
    let from = sents.length;
    while (from > 0 && words + sents[from - 1].words <= max) words += sents[--from].words;
    if (from === sents.length && sents.length) from = sents.length - 1;
    return sents.slice(from).map((s) => s.text).join(' ');
  }

  // What the model reads: the narrator, the scene's card, the scene's end.
  function context({ scene, card = null, narrator = '' }) {
    const lines = [];
    if (narrator) lines.push(`Narrator: ${narrator}.`);
    const c = SC.clean(card || {}) || {};
    for (const f of SC.FIELDS) {
      if (!c[f.key]) continue;
      const choice = (f.choices || []).find((x) => x[0] === c[f.key]);
      lines.push(`${f.label}: ${choice ? choice[1] : c[f.key]}`);
    }
    if (lines.length) lines.push('');
    lines.push('The scene so far, up to the sentence just written:', tail(scene));
    return lines.join('\n');
  }

  // One request: a yes/no choice per reading asked (all by default).
  function question(input, keys = KEYS) {
    const asked = READINGS.filter((r) => keys.includes(r[0]));
    return {
      model: MODEL,
      state: context(input),
      questions: Object.fromEntries(asked.map(([key, q]) => [key, {
        type: 'choice',
        instructions: `About the scene as written, at the moment the last sentence ends: ${q}`,
        criteria: { yes: 'Yes, clearly.', no: 'No, or not clearly.' }
      }]))
    };
  }

  // The model's chance of yes for each reading answered.
  function yesChances(answers) {
    const out = {};
    for (const key of KEYS) {
      const a = answers && answers[key];
      if (!a || (a.choice !== 'yes' && a.choice !== 'no')) continue;
      const p = a.probabilities && Number.isFinite(a.probabilities.yes) ? a.probabilities.yes
        : Number.isFinite(a.confidence) ? (a.choice === 'yes' ? a.confidence : 1 - a.confidence) : null;
      if (p !== null) out[key] = p;
    }
    return out;
  }

  // The suggestion the readings ask for: the first yes (by the table's
  // order) whose shape the last sentence didn't already have, and not a
  // list after a three-part sentence. Null when there's no such yes.
  function fromReadings(chances, thresholds = THRESHOLDS, last = null, rhythm = null) {
    const had = last ? S.shapesOf(last) : new Set();
    for (const [key, , shape, why] of READINGS) {
      if (!(key in thresholds) || !(chances[key] >= thresholds[key])) continue;
      if (had.has(shape) || (shape === 'list' && rhythm && rhythm.rule === 'threePart')) continue;
      return { rule: 'story', reading: key, shape, text: SHAPE_TEXT[shape], why };
    }
    return null;
  }

  // Which to show: a real rhythm problem, then the story, then the
  // rhythm's gentler notes.
  function combine(rhythm, story) {
    if (rhythm && RHYTHM_FIRST.has(rhythm.rule)) return rhythm;
    return story || rhythm || null;
  }
  const rhythmSettles = (rhythm) => !!rhythm && RHYTHM_FIRST.has(rhythm.rule);
  const asking = (thresholds = THRESHOLDS) => KEYS.filter((k) => k in thresholds);

  return { STRONGEST, STRONG_LABEL, MIN_BEFORE, moments, strongestKeys, strongest, MODEL, MAX_WORDS, TIMEOUT_MS, LADDER_CUT, ladderQuestion, ladderLevel, READINGS, KEYS, SHAPE_TEXT, THRESHOLDS, tail, context, question, yesChances, fromReadings, combine, rhythmSettles, asking };
});
