'use strict';

// CRAFT / SCENES: the questions an outline card can ask, and the shape of
// the whole book. The questions come from the scene methods in the Writing
// Techniques notes (Nancy Lamb's checks, the octave): what the scene's
// question is, what moves it forward, whether it ends "yes, but" or "no,
// and", its one tentpole moment and its one revelation. A chapter's card
// also knows its narrator and, if the writer says so, its pace.
//
// bookShape() measures what a card can't see: chapter lengths in a row,
// dialogue share per chapter, runs of dialogue-heavy chapters (they drag),
// runs of fast chapters with no breather, and which narrator has gone
// longest without a chapter. Prompts, never verdicts.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.KibitzCraft = root.KibitzCraft || {}).scenes = factory(root.KibitzCraft.text);
})(typeof globalThis !== 'undefined' ? globalThis : this, (T) => {
  // The fields every card has. A choice field's value is one of its keys;
  // each choice is [key, label, short label for the card].
  const FIELDS = [
    { key: 'question', label: 'The question', prompt: 'What does the reader want answered by the end of this scene?' },
    { key: 'forward', label: 'What moves it on', prompt: 'New information, a decision not acted on yet, or a complication?',
      choices: [['information', 'New information', 'New information'], ['decision', 'A decision, not acted on yet', 'Decision'], ['complication', 'A complication', 'Complication']] },
    { key: 'outcome', label: 'How it ends', prompt: 'Success brings “yes, but”; failure brings “no, and”.',
      choices: [['yesBut', 'Yes, but', 'Yes, but'], ['noAnd', 'No, and', 'No, and']] },
    { key: 'tentpole', label: 'Tentpole', prompt: 'The one moment this scene is built around.' },
    { key: 'revelation', label: 'Revelation', prompt: 'The one thing the reader learns here.' }
  ];
  // ...and the fields only a chapter's card has.
  const CHAPTER_FIELDS = [
    { key: 'narrator', label: 'Narrator', prompt: 'Whose chapter is this?' },
    { key: 'pace', label: 'Pace', prompt: 'Leave empty to judge by length.', choices: [['fast', 'Fast', 'Fast'], ['breather', 'A breather', 'Breather']] }
  ];

  const HEAVY_DIALOGUE = 0.45;   // share of a chapter's words in speech
  const HEAVY_RUN = 3;           // dialogue-heavy chapters in a row
  const FAST_RUN = 3;            // fast chapters in a row with no breather
  const SHORT_CHAPTER = 0.6;     // a chapter under this share of the median length reads fast
  const NARRATOR_GAP = 4;        // chapters since a narrator's last before it's mentioned

  const ALL = FIELDS.concat(CHAPTER_FIELDS);
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const num = (n) => NUMBER_WORDS[n] || String(n);
  const field = (key) => ALL.find((f) => f.key === key);

  // A card's answers, cleaned: text trimmed to one line, choices checked,
  // empty ones dropped. null when nothing is left.
  function clean(answers, chapter = false) {
    if (!answers || typeof answers !== 'object') return null;
    const out = {};
    for (const f of chapter ? ALL : FIELDS) {
      const v = answers[f.key];
      if (typeof v !== 'string') continue;
      const s = v.replace(/\s+/g, ' ').trim();
      if (!s) continue;
      if (f.choices && !f.choices.some(([k]) => k === s)) continue;
      out[f.key] = s;
    }
    return Object.keys(out).length ? out : null;
  }

  // What a card shows of its answers: the question, then short tags.
  function summary(answers) {
    const a = clean(answers, true) || {};
    const label = (key) => field(key).choices.find(([k]) => k === a[key])[2];
    const tags = [];
    if (a.narrator) tags.push(a.narrator);
    if (a.forward) tags.push(label('forward'));
    if (a.outcome) tags.push(label('outcome'));
    if (a.tentpole) tags.push('Tentpole');
    if (a.revelation) tags.push('Revelation');
    if (a.pace) tags.push(label('pace'));
    return { question: a.question || '', tags };
  }

  // How many of the five scene questions a card has answered.
  const answered = (answers) => FIELDS.filter((f) => (clean(answers) || {})[f.key]).length;

  // chapters: [{ id, name, text, narrator?, pace? }] in book order (text one
  // paragraph a line). Returns { rows, notes }: a row per chapter with its
  // words, dialogue share, pace ('fast' | 'breather' | 'steady') and
  // whether the writer set it; notes: [{ from, to, text }] (row indices).
  function bookShape(chapters) {
    const rows = chapters.map((c) => {
      const text = c.text || '';
      const words = T.wordCount(text);
      return {
        id: c.id, name: c.name, narrator: (c.narrator || '').trim(), words,
        dialogue: words ? T.quotedShare(text, { start: 0, end: text.length }) : 0,
        pace: c.pace === 'fast' || c.pace === 'breather' ? c.pace : null,
        paceSet: c.pace === 'fast' || c.pace === 'breather'
      };
    });
    const lengths = rows.map((r) => r.words).filter(Boolean).sort((a, b) => a - b);
    const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
    for (const r of rows) if (!r.pace) r.pace = r.words && median && r.words <= median * SHORT_CHAPTER ? 'fast' : 'steady';

    const notes = [];
    const runs = (test, min, say) => {
      let from = -1;
      rows.concat([null]).forEach((r, i) => {
        if (r && test(r)) { if (from < 0) from = i; return; }
        if (from >= 0 && i - from >= min) notes.push({ from, to: i - 1, text: say(i - from, rows[from], rows[i - 1]) });
        from = -1;
      });
    };
    const span = (a, b) => (a === b ? a.name : `${a.name} to ${b.name}`);
    runs((r) => r.words && r.dialogue >= HEAVY_DIALOGUE, HEAVY_RUN,
      (n, a, b) => `${span(a, b)}: ${num(n)} dialogue-heavy chapters in a row. Two or three in a row drag; break them with one that moves.`);
    runs((r) => r.pace === 'fast', FAST_RUN,
      (n, a, b) => `${span(a, b)}: ${num(n)} fast chapters with no breather. Let the rubber band go before it snaps.`);

    // narrators: how long since each last had a chapter
    const last = new Map();
    rows.forEach((r, i) => { if (r.narrator) last.set(r.narrator, i); });
    const since = [...last].map(([name, i]) => ({ name, gap: rows.length - 1 - i })).sort((a, b) => b.gap - a.gap);
    if (since.length > 1 && since[0].gap >= NARRATOR_GAP) {
      const i = last.get(since[0].name);
      notes.push({ from: i, to: i, text: `${since[0].name} hasn’t narrated since ${rows[i].name}, ${num(since[0].gap)} chapters ago. Their return is a small reintroduction.` });
    }
    return { rows, median, narrators: since, notes };
  }

  return { FIELDS, CHAPTER_FIELDS, HEAVY_DIALOGUE, clean, summary, answered, bookShape };
});
