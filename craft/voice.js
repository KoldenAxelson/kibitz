'use strict';

// CRAFT / VOICE: who says what, and how each speaker sounds. The test from
// the notes is a page of one line from each character with no tags, and a
// reader who can still tell who said what; this measures the things that
// make that possible: sentence length, contractions, hedges, questions,
// and the words a speaker leans on.
//
// Speakers come from tags ('"Go," Owen said.', 'said Owen') and, failing
// that, from a beat in the same paragraph ('Owen shrugged. "Go."'). A
// pronoun is kept as written ("he"); untagged lines have speaker null.
// Working out who an untagged line belongs to is the dialogue pass's job.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'), require('./cut.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).voice = factory(root.KibitzCraft.text, root.KibitzCraft.cut);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T, C) => {
  const SPEECH_VERBS = ('said says say asked asks ask replied replies answered answers whispered whispers shouted shouts ' +
    'yelled yells muttered mutters murmured murmurs called calls cried cries snapped snaps told tells added adds ' +
    'continued continues began begins went goes repeated repeats admitted admits insisted insists').split(' ');
  const PRONOUN = '(?:he|she|they|I|we|you|it)';
  const NAME = '(?:\\p{Lu}[\\p{L}’\'-]*(?:\\s\\p{Lu}[\\p{L}’\'-]*)?)';
  const VERB = `(?:${SPEECH_VERBS.join('|')})`;
  // After the closing mark: ', Owen said' / ' said Owen' / ', he asked'
  const TAG_AFTER = new RegExp(`^[,.!?—\\s]*(?:(${NAME}|${PRONOUN})\\s+${VERB}\\b|${VERB}\\s+(${NAME}|${PRONOUN})\\b)`, 'u');
  // Before the opening mark: 'Owen said, '
  const TAG_BEFORE = new RegExp(`(?:^|[.!?]\\s+)(${NAME}|${PRONOUN})\\s+${VERB}[,:]?\\s*$`, 'u');
  // A beat: a sentence in the paragraph that opens on a name ('Owen
  // shrugged.') or a title ('The Sergeant laughed.')
  const BEAT = new RegExp(`^((?:The\\s+)?${NAME})\\s+\\p{Ll}`, 'u');
  const NOT_NAMES = new Set(['The', 'A', 'An', 'Then', 'But', 'And', 'So', 'When', 'If', 'This', 'That', 'There', 'Still', 'Yes', 'No',
    'He', 'She', 'They', 'I', 'We', 'You', 'It', 'His', 'Her', 'Their', 'My', 'Our', 'Your', 'Its']);
  const nameBeat = (sentence) => {
    const m = BEAT.exec(sentence.text);
    if (!m) return null;
    const name = m[1].replace(/^The\s+/, 'the ');
    return NOT_NAMES.has(name.split(' ')[0]) ? null : name;
  };

  const clean = (s) => s.replace(/^["“«]|["”»]$/g, '').trim();
  const asSpeaker = (s) => (/^(?:he|she|they|I|we|you|it)$/i.test(s) ? s.toLowerCase().replace(/^i$/, 'I') : s);

  // Every quoted line, with a guess at its speaker:
  // [{ start, end, text, paragraph, speaker, how }]
  // how: 'tag' (said Owen), 'beat' (Owen shrugged.), 'paragraph' (another
  // line in a paragraph whose speaker is known: one speaker per paragraph)
  // or null.
  function lines(text) {
    const found = guess(text);
    for (const line of found) {
      if (line.speaker) continue;
      const known = found.find((l) => l.paragraph === line.paragraph && l.speaker && l.how !== 'paragraph');
      if (known) { line.speaker = known.speaker; line.how = 'paragraph'; }
    }
    return found;
  }

  function guess(text) {
    const paras = T.paragraphs(text);
    return T.quoteRanges(text).map((q) => {
      const para = paras.find((p) => q.start >= p.start && q.start < p.end);
      const after = text.slice(q.end, para.end);
      const before = text.slice(para.start, q.start);
      let speaker = null;
      let how = null;
      const a = TAG_AFTER.exec(after);
      const b = TAG_BEFORE.exec(before);
      if (a) { speaker = a[1] || a[2]; how = 'tag'; }
      else if (b) { speaker = b[1]; how = 'tag'; }
      else {
        // the nearest beat: the last named sentence before the line, else
        // the first after it, outside quotation marks
        const outside = (s) => !T.inRanges(para.start + s.start, T.quoteRanges(para.text).map((r) => ({ start: r.start + para.start, end: r.end + para.start })));
        const sents = T.sentences(para.text).filter(outside);
        const offset = q.start - para.start;
        const named = (list) => list.map(nameBeat).filter(Boolean);
        const beat = named(sents.filter((s) => s.end <= offset)).pop() || named(sents.filter((s) => s.start >= q.end - para.start))[0];
        if (beat) { speaker = beat; how = 'beat'; }
      }
      return { start: q.start, end: q.end, text: clean(text.slice(q.start, q.end)), paragraph: para.index, speaker: speaker && asSpeaker(speaker), how };
    });
  }

  // How a body of speech sounds. Rates are per hundred words.
  function profile(texts) {
    const all = (Array.isArray(texts) ? texts : [texts]).join('\n');
    const sents = T.sentences(all);
    const ws = T.words(all);
    const n = ws.length;
    const lengths = sents.map((s) => s.words).sort((a, b) => a - b);
    const per100 = (count) => (n ? Math.round(count / n * 1000) / 10 : 0);
    const contractions = ws.filter((w) => /\p{L}['’]\p{L}/u.test(w.word) && !/['’]s$/i.test(w.word)).length;
    const hedges = C.find(all, { hedgesInDialogue: true }).counts.hedge;
    const tally = new Map();
    for (const w of ws) {
      const key = T.stem(w.word);
      if (T.STOP_WORDS.has(key) || key.length < 3) continue;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    return {
      words: n,
      sentences: sents.length,
      meanSentence: sents.length ? Math.round(n / sents.length * 10) / 10 : 0,
      medianSentence: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
      contractionsPer100: per100(contractions),
      hedgesPer100: per100(hedges),
      questionShare: sents.length ? sents.filter((s) => /\?["”»']*$/.test(s.text)).length / sents.length : 0,
      exclamationShare: sents.length ? sents.filter((s) => /!["”»']*$/.test(s.text)).length / sents.length : 0,
      topWords: [...tally].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 10).map(([word, count]) => ({ word, count }))
    };
  }

  // Each tagged speaker's lines and profile: Map speaker → { lines, profile }.
  // Pronoun speakers are left out; they can't be told apart here.
  function bySpeaker(text) {
    const out = new Map();
    for (const line of lines(text)) {
      if (!line.speaker || /^(?:he|she|they|I|we|you|it)$/.test(line.speaker)) continue;
      if (!out.has(line.speaker)) out.set(line.speaker, { lines: [] });
      out.get(line.speaker).lines.push(line);
    }
    for (const v of out.values()) v.profile = profile(v.lines.map((l) => l.text));
    return out;
  }

  // How far apart two profiles are, measure by measure, plus the share of
  // their top words they have in common (0: none, 1: all).
  function compare(a, b) {
    const top = (p) => new Set(p.topWords.map((w) => w.word));
    const ta = top(a);
    const tb = top(b);
    const union = new Set([...ta, ...tb]);
    const shared = [...ta].filter((w) => tb.has(w));
    return {
      sentenceGap: Math.round(Math.abs(a.meanSentence - b.meanSentence) * 10) / 10,
      contractionGap: Math.round(Math.abs(a.contractionsPer100 - b.contractionsPer100) * 10) / 10,
      hedgeGap: Math.round(Math.abs(a.hedgesPer100 - b.hedgesPer100) * 10) / 10,
      questionGap: Math.round(Math.abs(a.questionShare - b.questionShare) * 100) / 100,
      sharedTopWords: union.size ? Math.round(shared.length / union.size * 100) / 100 : 0
    };
  }

  return { SPEECH_VERBS, lines, profile, bySpeaker, compare };
});
