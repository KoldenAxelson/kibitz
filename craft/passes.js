'use strict';

// CRAFT / PASSES: the revision passes. Each reads a chapter's text (one
// paragraph a line) and returns what it found, never a changed word:
//
//   { findings: [{ start, end, label, note, marks? }], summary: [lines] }
//
// start/end are offsets into the text (null for a finding about the whole
// chapter, like two speakers who sound alike). `marks` lists the exact
// stretches to underline when that isn't the whole start..end (a run's
// opening words, every use of an echoed word). Notes come from the Writing
// Techniques notes; each is a question to ask, not a verdict.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./shapes.js'), require('./cut.js'), require('./echoes.js'),
      require('./landings.js'), require('./voice.js'), require('./lexicon.js'));
  } else {
    const K = (root.KibitzCraft = root.KibitzCraft || {});
    K.passes = factory(K.text, K.shapes, K.cut, K.echoes, K.landings, K.voice, K.lexicon);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (T, S, C, E, L, V, X) => {
  const PASSES = [
    { key: 'cut', label: 'Words to Cut', about: 'The words-to-cut table, chains of prepositional phrases and runs of tiny words.' },
    { key: 'rhythm', label: 'Rhythm', about: 'Runs of one length, openings that repeat, weak landings and the shapes this chapter uses.' },
    { key: 'echoes', label: 'Echoes', about: 'Words that come back within forty words.' },
    { key: 'pov', label: 'Point of View', about: 'Thought tags, filter verbs and faces the narrator can’t see.' },
    { key: 'clutter', label: 'Clutter', about: 'Chains of prepositions, doubled body language, tiny words and trips between rooms.' },
    { key: 'dialogue', label: 'Dialogue', about: 'Beats, tags, adverbs on “said” and speakers who sound alike.' },
    { key: 'description', label: 'Description', about: 'A long silent opening, paragraphs that only see, and eye and hair colour.' },
    { key: 'time', label: 'Time and Cast', about: 'Whether the chapter says when it is, and paragraphs that bring on too many names.' },
    // Zoom asks the local model (decide.js), so it isn't one of run()'s:
    // app/passes.js runs it, with craft/zoom.js
    { key: 'zoom', label: 'Zoom', about: 'Each paragraph’s climb from detail to idea, read by the local model: where it ends on the close-up, never comes down, or comes back only to where it started.', model: true },
    // Beta (feature storyBeta): the local model ranks the chapter's moments
    // per reading and lists its strongest three (craft/story.js strongest)
    { key: 'strongest', label: 'Strongest Moments', about: 'The local model’s three strongest candidates per reading: where something lands, opens out, climbs or is about to be shown. Candidates, not verdicts.', model: true, feature: 'storyBeta' }
  ];

  const RUN_MIN = 4;            // sentences in a row for a rhythm run
  const SAME_OPENING_MIN = 3;   // sentences in a row on the same first word
  const SILENT_OPENING = 300;   // words before anyone speaks
  const SIGHT_PARAGRAPH = 40;   // words before a paragraph's senses count
  const TRANSIT_MAX = 12;       // words in a sentence that only moves someone
  const DIALOGUE_RUN = 4;       // lines in a row before beats are judged
  const NEW_NAMES_MAX = 2;      // new names a paragraph may bring

  const CUT_NOTES = {
    weasel: 'Does the sentence lose anything without it?',
    puff: 'A plainer word: use, begin, try.',
    filter: 'Show the thing seen, not the seeing.',
    time: 'Let the event arrive on its own.',
    empty: 'Name the thing.',
    inflation: 'A stronger noun or verb instead.',
    hedge: 'Commit to it: that reads as authority.',
    doubled: 'One word does it: sat, nodded, whispered.',
    chain: 'Three or more prepositional phrases in a row. Cut one or two.',
    tiny: 'A run of tiny words. Try cutting the sentence’s second half.'
  };
  const CUT_LABELS = Object.fromEntries(C.KINDS.concat(C.RUN_KINDS).map((k) => [k.key, k.label]));

  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const num = (n) => NUMBER_WORDS[n] || String(n);
  const Num = (n) => num(n).charAt(0).toUpperCase() + num(n).slice(1);
  const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
  const rate = (n, words) => (words ? Math.round(n / words * 10000) / 10 : 0);
  const finding = (start, end, label, note, marks) => (marks ? { start, end, label, note, marks } : { start, end, label, note });

  function* matches(text, source, flags = 'giu') {
    const re = new RegExp(source, flags);
    for (const m of text.matchAll(re)) yield m;
  }

  /* ---- Words to Cut ---- */
  function cut(text) {
    const r = C.find(text);
    const findings = r.hits.map((h) => finding(h.start, h.end, CUT_LABELS[h.kind], CUT_NOTES[h.kind]));
    const top = Object.entries(r.counts).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => `${CUT_LABELS[k].toLowerCase()} ${n}`);
    return {
      findings,
      summary: [
        `${r.total} ${r.total === 1 ? 'mark' : 'marks'} in ${r.words} words: ${rate(r.total, r.words)} per thousand.`,
        top.length ? `Most often: ${top.join(', ')}. Any one is fine once.` : 'Nothing from the table.'
      ]
    };
  }

  /* ---- Rhythm ---- */
  function rhythm(text) {
    const sents = T.sentences(text);
    const findings = [];
    if (!sents.length) return { findings, summary: ['No sentences yet.'] };
    for (const run of S.sameLengthRuns(sents.map((s) => s.words))) {
      const k = run.to - run.from + 1;
      if (k < RUN_MIN) continue;
      const span = run.min === run.max ? `${run.min} words` : `${run.min} to ${run.max} words`;
      findings.push(finding(sents[run.from].start, sents[run.to].end, 'Same length',
        `${Num(k)} sentences in a row of ${span}. Break the run with a short one or a long one.`));
    }
    let from = -1;
    const closeSubjects = (to) => {
      if (from >= 0 && to - from >= RUN_MIN) {
        findings.push(finding(sents[from].start, sents[to - 1].end, 'Subject first',
          `${Num(to - from)} sentences in a row open on their subject. Open one on a clause, or a word and a comma.`));
      }
      from = -1;
    };
    sents.forEach((s, i) => {
      const subject = s.words > S.SHORT_MAX && S.opening(s).kind === 'subject';
      if (subject && from < 0) from = i;
      if (!subject) closeSubjects(i);
    });
    closeSubjects(sents.length);
    const rows = L.find(text, sents);
    let run = [];
    const closeOpenings = () => {
      if (run.length >= SAME_OPENING_MIN) {
        const word = run[0].opening.word;
        findings.push(finding(run[0].opening.start, run[run.length - 1].opening.end, 'Same opening',
          `${Num(run.length)} sentences in a row open with “${word}”.`, run.map((r) => ({ start: r.opening.start, end: r.opening.end }))));
      }
      run = [];
    };
    for (const row of rows) {
      if (!row.sameOpening) closeOpenings();
      run.push(row);
    }
    closeOpenings();
    for (const row of rows) {
      if (row.weak) findings.push(finding(row.landing.start, row.landing.end, 'Weak landing', `Ends on “${row.landing.word}”. Can the strongest word go last?`));
    }
    const lengths = sents.map((s) => s.words);
    const used = new Set(sents.flatMap((s) => [...S.shapesOf(s)]));
    const unused = S.SHAPES.filter((s) => !used.has(s.key)).map((s) => s.label.toLowerCase());
    const summary = [
      `${plural(sents.length, 'sentence')}, ${Math.min(...lengths)} to ${Math.max(...lengths)} words, ${Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)} on average.`,
      used.size ? `Shapes used: ${S.SHAPES.filter((s) => used.has(s.key)).map((s) => s.label.toLowerCase()).join(', ')}.` : 'No sentence shapes stand out yet.',
      unused.length ? `Not yet: ${unused.join(', ')}.` : 'All nine shapes are here.'
    ];
    if (!lengths.some((n) => n < 4)) summary.push('Nothing under four words in the whole chapter. Add one.');
    return { findings: sorted(findings), summary };
  }
  /* ---- Echoes ---- */
  function echoes(text) {
    // names have to come back; they aren't echoes (a word always written
    // with a capital, and not one of the NOT_NAMES, counts as a name here)
    const isName = (e) => e.hits.every((h) => /^\p{Lu}/u.test(h.word)) && !X.NOT_NAMES.has(e.key);
    const found = E.find(text).filter((e) => !isName(e));
    const findings = found.map((e) => finding(e.hits[0].start, e.hits[0].end, `“${e.hits[0].word}” ×${e.count}`,
      'Back within forty words. Make the repeat stronger on purpose, or swap one.', e.hits.map((h) => ({ start: h.start, end: h.end }))));
    return { findings, summary: [found.length ? `${Num(found.length)} ${found.length === 1 ? 'word echoes' : 'words echo'}. Chosen echoes can stay.` : 'No word comes back within forty words.'] };
  }

  /* ---- Point of View ---- */
  function pov(text) {
    const quotes = T.quoteRanges(text);
    const prose = (m) => !T.inRanges(m.index, quotes);
    const findings = [];
    const seen = new Set();
    const add = (m, label, note) => {
      if (!prose(m) || seen.has(m.index)) return;
      seen.add(m.index);
      findings.push(finding(m.index, m.index + m[0].length, label, note));
    };
    for (const m of matches(text, '\\b(?:I|he|she|they|we|\\p{Lu}\\p{Ll}+)\\s+(?:thought|wondered)(?:\\s+to\\s+(?:myself|himself|herself|themselves|ourselves))?\\b', 'gu')) {
      add(m, 'Thought tag', 'In close point of view the narration can carry the thought without a tag.');
    }
    for (const m of matches(text, '\\b(?:I|he|she|they|we)\\s+(?:could\\s+)?(?:see|saw|hear|heard|feel|felt|notice|noticed|watch|watched|realize|realized|realise|realised|smell|smelled|smelt|sense|sensed)\\b', 'giu')) {
      add(m, 'Filter', 'Show what’s seen or heard, without the pane of glass.');
    }
    for (const m of matches(text, '\\b(?:' + X.OWN_FACE.join('|') + ')\\b', 'giu')) {
      add(m, 'Whose face?', 'If this face is the narrator’s own, they can’t see it.');
    }
    const outside = text.replace(/["“][^"”]*["”]/g, ' ');
    const first = (outside.match(/\bI\b/g) || []).length;
    const third = (outside.match(/\b(?:he|she)\b/gi) || []).length;
    const told = first > third ? 'Told in the first person.' : third ? 'Told in the third person.' : '';
    const counts = [['Thought tag', 'thought tags'], ['Filter', 'filters'], ['Whose face?', 'faces seen from outside']]
      .map(([l, words]) => [words, findings.filter((f) => f.label === l).length]).filter(([, n]) => n);
    return {
      findings: sorted(findings),
      summary: [told, counts.length ? counts.map(([words, n]) => `${words} ${n}`).join(', ') + '.' : 'No slips found.'].filter(Boolean)
    };
  }

  /* ---- Clutter ---- */
  function clutter(text) {
    const findings = [];
    for (const r of C.chains(text)) findings.push(finding(r.start, r.end, 'Preposition chain', CUT_NOTES.chain));
    for (const r of C.tinyRuns(text)) findings.push(finding(r.start, r.end, 'Tiny words', CUT_NOTES.tiny));
    for (const h of C.find(text).hits) if (h.kind === 'doubled') findings.push(finding(h.start, h.end, 'Doubled', CUT_NOTES.doubled));
    const quotes = T.quoteRanges(text);
    for (const s of T.sentences(text)) {
      if (s.words > TRANSIT_MAX || /[,;:]|\band\b/i.test(s.text) || T.quotedShare(text, s, quotes) > 0) continue;
      const ws = T.words(s.text).map((w) => w.word.toLowerCase());
      const verb = ws.findIndex((w) => X.MOTION.has(w));
      if (verb >= 0 && verb <= 3 && ws.slice(verb + 1).some((w) => X.DIRECTIONS.has(w))) {
        findings.push(finding(s.start, s.end, 'Just a trip', 'This sentence only moves someone. Can the scene skip the trip?'));
      }
    }
    return { findings: sorted(findings), summary: [findings.length ? `${plural(findings.length, 'thing')} to look at.` : 'Nothing cluttered.'] };
  }

  /* ---- Dialogue ---- */
  // A loud tag right after the closing mark: '," she hissed' / '," hissed Owen'
  const TAG_AFTER = /["”»][,.!?—]?\s*(?:(\p{Lu}\p{Ll}+|he|she|they|I|we)\s+(\p{Ll}+)|(\p{Ll}+)\s+(?:\p{Lu}\p{Ll}+|he|she|they))/gu;
  const NOT_ADVERBS = new Set(['only', 'early', 'likely', 'reply', 'family', 'friendly', 'lovely', 'lonely', 'ugly', 'silly']);

  function dialogue(text) {
    const findings = [];
    const quotes = T.quoteRanges(text);
    const paras = T.paragraphs(text);
    const lines = V.lines(text);
    const speech = new Set(V.SPEECH_VERBS);
    // each paragraph that holds speech: does it carry a tag, an action beat?
    const talk = paras.map((p) => {
      const mine = lines.filter((l) => l.paragraph === p.index);
      if (!mine.length) return null;
      const outside = quotes.filter((q) => q.start >= p.start && q.end <= p.end)
        .reduceRight((acc, q) => acc.slice(0, q.start - p.start) + ' ' + acc.slice(q.end - p.start), p.text);
      const rest = T.words(outside).map((w) => w.word).filter((w) => !speech.has(w.toLowerCase()) && !/^(?:he|she|they|I|we|you|it)$/i.test(w) &&
        !mine.some((l) => l.speaker && l.speaker.split(' ').includes(w)));
      return { para: p, tagged: mine.some((l) => l.how === 'tag'), beat: mine.some((l) => l.how === 'beat') || rest.length >= 3 };
    });
    let run = [];
    const close = () => {
      if (run.length >= DIALOGUE_RUN) {
        const a = run[0].para;
        const b = run[run.length - 1].para;
        if (run.every((r) => r.beat)) {
          findings.push(finding(a.start, b.end, 'A beat on every line', `${Num(run.length)} lines in a row each come with an action. Let a few stand alone.`, [{ start: a.start, end: a.end }]));
        } else if (run.every((r) => !r.beat && !r.tagged)) {
          findings.push(finding(a.start, b.end, 'Floating voices', `${Num(run.length)} lines with no tag and no beat. Can the reader tell who’s speaking?`, [{ start: a.start, end: a.end }]));
        }
      }
      run = [];
    };
    talk.forEach((t, i) => {
      if (!t || (run.length && talk[i - 1] === null)) close();
      if (t) run.push(t);
    });
    close();
    for (const m of matches(text, '\\b(?:said|says|asked|replied|whispered|shouted|answered)\\s+(\\p{L}+ly)\\b', 'giu')) {
      if (T.inRanges(m.index, quotes) || NOT_ADVERBS.has(m[1].toLowerCase())) continue;
      findings.push(finding(m.index, m.index + m[0].length, 'Adverb on the tag', 'Let the line carry the tone; “said” on its own disappears.'));
    }
    for (const m of text.matchAll(TAG_AFTER)) {
      const verb = (m[2] || m[3] || '').toLowerCase();
      if (!X.LOUD_TAGS.has(verb)) continue;
      const at = m.index + m[0].toLowerCase().lastIndexOf(verb);
      findings.push(finding(at, at + verb.length, 'Loud tag', `“${verb}” draws the eye. “Said” disappears; an action beat shows.`));
    }
    const by = [...V.bySpeaker(text)].filter(([, v]) => v.lines.length >= 3 && v.profile.words >= 25);
    for (let i = 0; i < by.length; i++) {
      for (let j = i + 1; j < by.length; j++) {
        const [a, pa] = [by[i][0], by[i][1].profile];
        const [b, pb] = [by[j][0], by[j][1].profile];
        const gap = V.compare(pa, pb);
        if (gap.sentenceGap < 2 && gap.contractionGap < 3 && gap.hedgeGap < 1.5 && gap.questionGap < 0.2) {
          findings.push(finding(null, null, 'Sound alike', `${a} and ${b} sound alike: about ${Math.round(pa.meanSentence)} words a sentence each, and the same habits. Give one a habit the other lacks.`));
        }
      }
    }
    const spoken = T.quotedShare(text, { start: 0, end: text.length }, quotes);
    const summary = [lines.length ? `Dialogue is ${Math.round(spoken * 100)}% of the words, in ${plural(lines.length, 'line')}.` : 'No dialogue in this chapter.'];
    for (const [name, v] of [...V.bySpeaker(text)].sort((x, y) => y[1].lines.length - x[1].lines.length).slice(0, 4)) {
      const per = v.profile.meanSentence;
      summary.push(`${name}: ${plural(v.lines.length, 'line')}, ${per} ${per === 1 ? 'word' : 'words'} a sentence, ${v.profile.contractionsPer100} contractions per hundred words.`);
    }
    return { findings: sorted(findings), summary };
  }

  /* ---- Description ---- */
  function description(text) {
    const findings = [];
    const quotes = T.quoteRanges(text);
    const paras = T.paragraphs(text);
    const firstSpeech = quotes.length ? quotes[0].start : text.length;
    const before = T.wordCount(text.slice(0, firstSpeech));
    if (paras.length && before >= SILENT_OPENING) {
      const last = paras.filter((p) => p.end <= firstSpeech).pop() || paras[0];
      findings.push(finding(paras[0].start, last.end, 'A silent opening', `${before} words before anyone speaks. Open on a person or a line, or cut to the part that moves.`,
        [{ start: paras[0].start, end: paras[0].end }]));
    }
    const totals = { sight: 0, sound: 0, smell: 0, touch: 0, taste: 0 };
    for (const p of paras) {
      const ws = T.words(p.text);
      const count = { sight: [], sound: [], smell: [], touch: [], taste: [] };
      for (const w of ws) {
        const lw = w.word.toLowerCase();
        for (const sense of Object.keys(count)) if (X.SENSES[sense].has(lw)) count[sense].push(w);
      }
      for (const sense of Object.keys(count)) totals[sense] += count[sense].length;
      const quiet = ['sound', 'smell', 'touch', 'taste'].every((k) => !count[k].length);
      if (ws.length >= SIGHT_PARAGRAPH && count.sight.length >= 2 && quiet && T.quotedShare(text, p, quotes) < 0.2) {
        findings.push(finding(p.start, p.end, 'Only sight', 'Every detail here is seen. A sound, a smell, a texture?',
          count.sight.map((w) => ({ start: p.start + w.start, end: p.start + w.end }))));
      }
    }
    for (const m of matches(text, '\\b(?:' + X.EYE_HAIR.join('|') + ')\\b')) {
      if (T.inRanges(m.index, quotes)) continue;
      findings.push(finding(m.index, m.index + m[0].length, 'Eye and hair colour', 'Leading with these? Something only this person has says more.'));
    }
    return {
      findings: sorted(findings),
      summary: [`Senses in this chapter: ${Object.entries(totals).map(([k, n]) => `${k} ${n}`).join(', ')}.`]
    };
  }

  /* ---- Time and Cast ---- */
  // Names: capitalised words that are never written in lowercase here, that
  // turn up somewhere other than a sentence's first word, and aren't on the
  // NOT_NAMES list. Neighbours join ("Andre Silva", "Row Nine").
  function names(text, sents) {
    const ws = T.words(text);
    const starts = new Set(sents.map((s) => s.start));
    const lower = new Set(ws.filter((w) => /^\p{Ll}/u.test(w.word)).map((w) => w.word.toLowerCase()));
    const cap = (w) => /^\p{Lu}\p{Ll}/u.test(w.word) && !X.NOT_NAMES.has(w.word.toLowerCase().replace(/’/g, "'")) && !lower.has(w.word.toLowerCase());
    const midSentence = new Set(ws.filter((w) => cap(w) && !starts.has(w.start) && !/["“(]$/.test(text.slice(Math.max(0, w.start - 1), w.start))).map((w) => w.word));
    const out = [];
    for (let i = 0; i < ws.length; i++) {
      if (!cap(ws[i]) || !midSentence.has(ws[i].word)) continue;
      let j = i;
      while (j + 1 < ws.length && cap(ws[j + 1]) && text.slice(ws[j].end, ws[j + 1].start) === ' ') j++;
      out.push({ name: text.slice(ws[i].start, ws[j].end), start: ws[i].start, end: ws[j].end });
      i = j;
    }
    return out;
  }

  function time(text) {
    const findings = [];
    const sents = T.sentences(text);
    const opening = sents.slice(0, 2);
    if (opening.length && !opening.some((s) => X.TIME_RE.test(s.text))) {
      findings.push(finding(opening[0].start, opening[opening.length - 1].end, 'When are we?',
        'The chapter’s first two sentences don’t say when we are. A time, a day, a meal, “later”?'));
    }
    const all = names(text, sents);
    const firstSeen = new Map();
    for (const n of all) if (!firstSeen.has(n.name)) firstSeen.set(n.name, n);
    for (const p of T.paragraphs(text)) {
      const fresh = [...firstSeen.values()].filter((n) => n.start >= p.start && n.end <= p.end);
      if (fresh.length > NEW_NAMES_MAX) {
        findings.push(finding(p.start, p.end, 'Too many new names', `${Num(fresh.length)} new names in one paragraph: ${fresh.map((n) => n.name).join(', ')}. Readers hold two at a time.`,
          fresh.map((n) => ({ start: n.start, end: n.end }))));
      }
    }
    const tally = new Map();
    for (const n of all) tally.set(n.name, (tally.get(n.name) || 0) + 1);
    const cast = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, c]) => `${name} ${c}`);
    return { findings: sorted(findings), summary: [cast.length ? `Names: ${cast.join(', ')}.` : 'No names yet.'] };
  }

  function sorted(findings) {
    return findings.sort((a, b) => (a.start === null) - (b.start === null) || a.start - b.start || a.end - b.end);
  }

  const RUN = { cut, rhythm, echoes, pov, clutter, dialogue, description, time };

  // Runs one pass over a chapter's text.
  function run(key, text) {
    if (!RUN[key]) throw new Error('No such pass: ' + key);
    const out = RUN[key](text);
    out.summary = out.summary.map((line) => line.charAt(0).toUpperCase() + line.slice(1));
    return out;
  }

  return { PASSES, run, names };
});
