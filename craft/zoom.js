'use strict';

// CRAFT / ZOOM: the zoom levels of the "uneven U" (Writing Techniques,
// "Point of view": open a little wide, push in to the close-up, then pull
// back out further than you started). Each sentence sits somewhere from 1
// (the detail itself) to 5 (the book's big idea). A decision model labels
// them (questions() builds what it's asked; levels() reads its answers);
// flags() says what the paragraph's curve does wrong:
//
//   endsClose   it ends on the close-up: the reader is left holding a detail
//   neverDown   it never comes down to anything concrete
//   onlyBack    it pushes in, then climbs back only to where it opened
//
// compare() measures how close a model is to a person's labels: not right
// or wrong, how close together.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).zoom = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  // What the Zoom pass asks, chosen by measurement (private/eval/zoom/,
  // 2026-11-26): winnow:e4b asked per paragraph, its scale stretched by a
  // line fitted on the reference set's training split. On the untouched
  // test split: 0.42 levels from the rubric on average, 91% within one,
  // rank 0.77, flags agreeing 89% (always-3: 0.65, 85%, 74%).
  const CHOSEN = { model: 'winnow:e4b', variant: 'paragraph', stretch: { a: -0.68, b: 1.14 } };
  const MIN_SENTENCES = 3;      // a shorter paragraph has no curve to judge
  const MAX_SPOKEN = 0.5;       // paragraphs mostly in speech are left out
  // The rubric (private/eval/zoom/rubric.md, v2): Hayot's five levels by
  // distance from the evidence, read for fiction, where the evidence is the
  // story world's particulars.
  const LEVELS = [
    'Level 1, the particular: one concrete thing the reader could see, hear or touch: an object, a single gesture, a sound, a line of speech',
    'Level 2, the scene: a concrete moment or event as it happens, or several observable details together',
    'Level 3, the interpretation: what the particulars mean in the story: feelings, motives, judgements, character traits, habits, summary over time',
    'Level 4, the context: the world around the scene: a place in general, a society and its customs, a kind of person, history',
    'Level 5, the big idea: a general truth about life or human nature, true beyond this story'
  ];
  // One public-domain example per level, from the reference set's training
  // split (never from the paragraphs a model is measured on).
  const EXAMPLES = [
    'He pulled up the blind and rang the bell loudly.',
    'It was the dusk of a winter’s day.',
    'In understanding Darcy was the superior.',
    'They all knew each other, and felt like one large family, among whom existed the most amicable relations.',
    'I have often thought that few people know what secrecy there is in the young under terror.'
  ];
  const ANCHORED = LEVELS.map((d, i) => `${d}. Example: "${EXAMPLES[i]}"`);
  const CLOSE = 1.5;        // at or under: the close-up
  const CONCRETE = 2.5;     // never at or under this: never came down
  const DIP = 0.5;          // how far under the opening counts as pushing in
  const SAME = 0.25;        // how close to the opening counts as "only back"

  const INSTRUCTION = (s) => `How far does this sentence zoom out, from concrete detail to big idea: "${s}"`;

  // The ways of asking, for the evaluation to choose between. Each returns
  // one or more requests: { state, questions }, questions keyed s0, s1...
  //   paragraph  the paragraph as state, a score question per sentence
  //   sentence   one request per sentence, the sentence alone as state
  //   choice     the paragraph as state, a five-way choice per sentence
  //   anchored   as paragraph, each level with an example sentence
  const VARIANTS = {
    paragraph: (sentences) => [{
      state: sentences.join(' '),
      questions: Object.fromEntries(sentences.map((s, i) => ['s' + i, { type: 'score', instructions: INSTRUCTION(s), criteria: LEVELS }]))
    }],
    sentence: (sentences) => sentences.map((s, i) => ({
      state: s,
      questions: { ['s' + i]: { type: 'score', instructions: 'How far does this sentence zoom out, from concrete detail to big idea?', criteria: LEVELS } }
    })),
    anchored: (sentences) => [{
      state: sentences.join(' '),
      questions: Object.fromEntries(sentences.map((s, i) => ['s' + i, { type: 'score', instructions: INSTRUCTION(s), criteria: ANCHORED }]))
    }],
    choice: (sentences) => [{
      state: sentences.join(' '),
      questions: Object.fromEntries(sentences.map((s, i) => ['s' + i, {
        type: 'choice', instructions: INSTRUCTION(s), criteria: Object.fromEntries(LEVELS.map((d, k) => [String(k + 1), d]))
      }]))
    }]
  };
  const questions = (sentences, variant = 'paragraph') => VARIANTS[variant](sentences);

  // A model's answers → [{ level, confidence } | null] in sentence order.
  // A score's expected level (0-based) becomes 1-5; a choice's probabilities
  // are averaged into an expected level the same way.
  function levels(answers, count) {
    return Array.from({ length: count }, (_, i) => {
      const a = answers && answers['s' + i];
      if (!a || typeof a !== 'object') return null;
      if (a.type === 'score' && Number.isFinite(a.score)) return { level: a.score + 1, confidence: a.confidence ?? 0 };
      if (a.type === 'choice' && a.probabilities) {
        let sum = 0;
        let mass = 0;
        for (const [k, p] of Object.entries(a.probabilities)) { sum += Number(k) * p; mass += p; }
        return mass ? { level: sum / mass, confidence: a.confidence ?? 0 } : null;
      }
      return null;
    });
  }

  // What a paragraph's curve does wrong. `ls` are its sentences' levels in
  // order (numbers, nulls skipped). Paragraphs under three sentences have
  // no curve to judge.
  function flags(ls) {
    const v = ls.filter((x) => Number.isFinite(x));
    const out = { endsClose: false, neverDown: false, onlyBack: false };
    if (v.length < 3) return out;
    const first = v[0];
    const last = v[v.length - 1];
    const low = Math.min(...v.slice(1, -1));
    out.endsClose = last <= CLOSE;
    out.neverDown = Math.min(...v) > CONCRETE;
    out.onlyBack = low < first - DIP && last > low + DIP && last <= first + SAME;
    return out;
  }

  // A straight line a + b·level fitted to a person's labels, to undo a
  // model's habit of bunching its scores in the middle.
  function stretchFit(model, human) {
    const pairs = model.map((m, i) => [m, human[i]]).filter(([m, h]) => Number.isFinite(m) && Number.isFinite(h));
    if (pairs.length < 2) return { a: 0, b: 1 };
    const mx = pairs.reduce((s, [m]) => s + m, 0) / pairs.length;
    const my = pairs.reduce((s, [, h]) => s + h, 0) / pairs.length;
    const vxx = pairs.reduce((s, [m]) => s + (m - mx) ** 2, 0);
    const vxy = pairs.reduce((s, [m, h]) => s + (m - mx) * (h - my), 0);
    const b = vxx ? vxy / vxx : 1;
    return { a: my - b * mx, b };
  }
  const stretch = (level, fit) => Math.min(5, Math.max(1, fit.a + fit.b * level));

  // How close a model's levels are to a person's, over paragraphs:
  // human / model are arrays (one per paragraph) of arrays of levels (null
  // for none). Returns the average distance, the share within one level,
  // the rank correlation, and per flag how often the two agree.
  function compare(human, model) {
    const pairs = [];
    human.forEach((hs, p) => hs.forEach((h, i) => {
      const m = model[p] && model[p][i];
      if (Number.isFinite(h) && Number.isFinite(m)) pairs.push([h, m]);
    }));
    const n = pairs.length;
    const distance = n ? pairs.reduce((s, [h, m]) => s + Math.abs(h - m), 0) / n : null;
    const withinOne = n ? pairs.filter(([h, m]) => Math.abs(h - m) <= 1).length / n : null;
    const flagAgree = {};
    let judged = 0;
    for (const key of ['endsClose', 'neverDown', 'onlyBack']) flagAgree[key] = 0;
    human.forEach((hs, p) => {
      if (hs.filter(Number.isFinite).length < 3) return;
      judged++;
      const fh = flags(hs);
      const fm = flags(model[p] || []);
      for (const key of Object.keys(flagAgree)) if (fh[key] === fm[key]) flagAgree[key]++;
    });
    for (const key of Object.keys(flagAgree)) flagAgree[key] = judged ? flagAgree[key] / judged : null;
    return { sentences: n, paragraphs: judged, distance, withinOne, rank: spearman(pairs), flagAgree };
  }

  function ranks(xs) {
    const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }
  function spearman(pairs) {
    if (pairs.length < 3) return null;
    const rh = ranks(pairs.map(([h]) => h));
    const rm = ranks(pairs.map(([, m]) => m));
    const mean = (pairs.length + 1) / 2;
    let num = 0;
    let dh = 0;
    let dm = 0;
    for (let i = 0; i < pairs.length; i++) {
      num += (rh[i] - mean) * (rm[i] - mean);
      dh += (rh[i] - mean) ** 2;
      dm += (rm[i] - mean) ** 2;
    }
    return dh && dm ? num / Math.sqrt(dh * dm) : null;
  }

  // The paragraphs of a chapter's text (one a line) that have a curve to
  // read: three sentences or more, not mostly speech. Each with its
  // sentences and offsets.
  function paragraphsToRead(text) {
    const quotes = T.quoteRanges(text);
    return T.paragraphs(text).map((p) => ({ ...p, sentences: T.sentences(p.text).map((s) => ({ ...s, start: s.start + p.start, end: s.end + p.start })) }))
      .filter((p) => p.sentences.length >= MIN_SENTENCES && T.quotedShare(text, p, quotes) <= MAX_SPOKEN);
  }

  const FLAG_TEXT = {
    neverDown: ['Never comes down', 'Ground it in one thing the reader can see.'],
    endsClose: ['Ends on the close-up', 'Pull back out at the end.'],
    onlyBack: ['Back where it started', 'End wider than you began.']
  };

  // One entry per paragraph read (levels already stretched; null where the
  // model gave none), in order: its curve and sentences for the panel to
  // draw, and, when its curve goes wrong, the flags with the sentence each
  // is about underlined (the first for neverDown, else the last). A
  // paragraph whose curve is fine gets an empty label and no marks.
  function findings(paragraphs, levelsByParagraph) {
    const out = [];
    paragraphs.forEach((p, i) => {
      const ls = levelsByParagraph[i];
      if (!ls || ls.filter(Number.isFinite).length < MIN_SENTENCES) return;
      const f = flags(ls);
      const keys = ['neverDown', 'endsClose', 'onlyBack'].filter((k) => f[k]);
      const marks = keys.map((k) => (k === 'neverDown' ? p.sentences[0] : p.sentences[p.sentences.length - 1]))
        .filter((s, j, all) => all.indexOf(s) === j).map((s) => ({ start: s.start, end: s.end }));
      out.push({
        start: p.start, end: p.end,
        label: keys.map((k) => FLAG_TEXT[k][0]).join(' · '),
        note: keys.map((k) => FLAG_TEXT[k][1]).join(' '),
        marks,
        curve: ls.map((x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null)),
        sentences: p.sentences.map((s) => ({ start: s.start, end: s.end }))
      });
    });
    return { findings: out, summary: out.length ? [] : ['No paragraph of three sentences or more yet.'] };
  }

  return { CHOSEN, MIN_SENTENCES, LEVELS, EXAMPLES, paragraphsToRead, findings, VARIANTS: Object.keys(VARIANTS), questions, levels, flags, stretchFit, stretch, compare };
});
