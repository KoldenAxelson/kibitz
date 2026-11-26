'use strict';

// CRAFT / STORY: the sentence shape suggester's story layer. The rhythm
// layer (suggest.js) reads lengths and punctuation; this one asks the local
// decision model (decide.js) what the scene is doing, and picks the shape
// that fits: a delay before something arrives, a reversal when a hope is
// about to sour, a list when someone sizes up a room. The model only picks
// from a fixed menu (the nine shapes, or nothing); anything unsure is
// dropped, and a rhythm problem (a run of one length, a long one to land)
// still comes first.
//
// It reads the scene so far (its last MAX_WORDS words), the scene's outline
// card (craft/scenes.js answers) and the chapter's narrator.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./shapes.js'), require('./scenes.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).story = factory(root.KibitzCraft.text, root.KibitzCraft.shapes, root.KibitzCraft.scenes);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T, S, SC) => {
  const MODEL = 'winnow:e4b';
  const MAX_WORDS = 300;           // of the scene so far, sent as context
  // Below this the pick is dropped. Set by tools/story-eval.js on the dev
  // split (2026-11-26): the model's confidence over ten choices runs low,
  // and any cut above 0 lost more lift than it gained; "none" is the
  // model's own way of staying quiet (54% of the time).
  const MIN_CONFIDENCE = 0;
  const TIMEOUT_MS = 2500;         // a pick that comes later than this is too late to help

  // Rhythm rules that name a real rhythm problem: these speak before the
  // story layer. The others (threePart, openings, unusedShape) give way.
  const RHYTHM_FIRST = new Set(['landLong', 'threeShort', 'funnel', 'sameLength', 'noShort']);

  // Each choice: when it fits the story (what the model reads), what the
  // writer sees, and the one-line reason.
  const CHOICES = {
    delay: ['Something is about to be revealed or to arrive, and holding it back to the end of the sentence would build suspense.',
      'Try a delay: hold the subject back to the end.', 'Something’s about to arrive.'],
    contrast: ['Two things are pulling against each other: what was expected and what is, two people, or two wants.',
      'Try a contrast: two halves pulling against each other.', 'Two things are pulling apart.'],
    short: ['A blow lands, a decision is made, or a moment should stop the reader cold.',
      'Land a short one.', 'This moment should hit.'],
    list: ['Someone is sizing up a place, a person or a situation, and the details would prove a point.',
      'Try a list: the claim, then the details that prove it.', 'Someone is sizing things up.'],
    repetition: ['A character is fixated or insisting, and one word keeps coming back to them.',
      'Try repetition: one word three times, on purpose.', 'Someone is fixated.'],
    pileOn: ['Things are piling up faster than the character can handle: overwhelm, panic or breathless action.',
      'Pile it on: and, and, and.', 'It’s piling up on them.'],
    building: ['Feeling or argument is rising, step on step, towards a peak.',
      'Build it: clauses that start the same way.', 'It’s rising.'],
    reversal: ['A hope, a plan or an expectation is about to sour or flip.',
      'Try a reversal: set it up and flip it.', 'Something’s about to turn.'],
    long: ['The moment opens out: travel, memory, a mind running on, or a view taken in slowly.',
      'Let one run long.', 'The moment is opening out.'],
    none: ['Nothing in particular: the scene just needs to carry on plainly.', null, null]
  };
  const KEYS = Object.keys(CHOICES);

  // The scene's last `max` words, starting at a sentence.
  function tail(scene, max = MAX_WORDS) {
    const sents = T.sentences(scene);
    let words = 0;
    let from = sents.length;
    while (from > 0 && words + sents[from - 1].words <= max) words += sents[--from].words;
    if (from === sents.length && sents.length) from = sents.length - 1;
    return sents.slice(from).map((s) => s.text).join(' ');
  }

  // What the model is shown: the narrator, the scene's card, the scene.
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
    lines.push('The scene so far:', tail(scene));
    return lines.join('\n');
  }

  function question(input) {
    return {
      model: MODEL,
      state: context(input),
      questions: {
        next: {
          type: 'choice',
          instructions: 'You are reading a novel as it is being written. The writer has just finished the last sentence. Which kind of sentence would serve the story best as the very next one?',
          criteria: Object.fromEntries(KEYS.map((k) => [k, CHOICES[k][0]]))
        }
      }
    };
  }

  // The model's answer as a suggestion ({ rule: 'story', shape, text, why,
  // confidence }), or null: no answer, unsure, or "nothing in particular".
  function pick(answers, minConfidence = MIN_CONFIDENCE) {
    const a = answers && answers.next;
    if (!a || !CHOICES[a.choice]) return null;
    const confidence = a.probabilities && Number.isFinite(a.probabilities[a.choice]) ? a.probabilities[a.choice] : a.confidence;
    if (!Number.isFinite(confidence) || confidence < minConfidence || a.choice === 'none') return null;
    const [, text, why] = CHOICES[a.choice];
    return { rule: 'story', shape: a.choice, text, why, confidence };
  }

  // Which to show: a real rhythm problem first, then the story's pick
  // (unless the last sentence was that shape already, or a three-part
  // sentence just ended and it's a list), then the rhythm's gentler notes.
  function combine(rhythm, story, last = null) {
    if (rhythm && RHYTHM_FIRST.has(rhythm.rule)) return rhythm;
    if (story) {
      const had = last ? S.shapesOf(last) : new Set();
      if (!had.has(story.shape) && !(rhythm && rhythm.rule === 'threePart' && story.shape === 'list')) return story;
    }
    return rhythm || null;
  }

  // Whether the rhythm layer's answer settles it without asking the model.
  const rhythmSettles = (rhythm) => !!rhythm && RHYTHM_FIRST.has(rhythm.rule);

  return { MODEL, MAX_WORDS, MIN_CONFIDENCE, TIMEOUT_MS, KEYS, CHOICES, tail, context, question, pick, combine, rhythmSettles };
});
