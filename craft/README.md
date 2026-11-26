# craft/: Kibitz's rules engine

Pure functions that read prose and report what they find, with offsets.
No DOM, no disk, no network, nothing saved. The sentence shape suggester
and the revision passes are built on these; the window paints the results
with the CSS Highlight API.

Each file runs in two places:
- **Node:** `require('./craft')` (or one file), for the tests.
- **The window:** a plain `<script>` in this order: text, shapes, cut,
  echoes, landings, voice, suggest, lexicon, passes. Each hangs off `window.KibitzCraft`.

| File | What it gives |
|---|---|
| `text.js` | `paragraphs`, `sentences` (abbreviations, initials, decimals, ellipses and speech tags handled), `words`, `wordCount`, `quoteRanges`, `inRanges`, `quotedShare`, `stem`, `STOP_WORDS` |
| `shapes.js` | `opening` (subject, clause, shortComma, conjunction, dialogue), `shapesOf` (the nine shapes: delay, contrast, short, list, repetition, pileOn, building, reversal, long), `sameLengthRuns`, `funnels`, `rhythm` |
| `cut.js` | `find`: the words-to-cut table (weasel, puff, filter, time, empty, inflation, hedge, doubled), preposition chains and tiny-word runs, with counts per thousand words; hedges in speech let off by default |
| `echoes.js` | `find`: words that come back within 40 words |
| `landings.js` | `find`: each sentence's opening and landing word, same openings in a row, weak landings |
| `suggest.js` | The suggester's rhythm layer: `suggest` (eight rules, first match wins, one shape and one reason), `atSentenceEnd`, `shouldShow` (cooldown) |
| `lexicon.js` | Word lists for the passes: the five senses, time words, loud tags, motion verbs, own-face and eye/hair patterns, words that aren't names |
| `passes.js` | The eight revision passes: `run(key, text)` → `{ findings: [{ start, end, label, note, marks? }], summary }`; `PASSES` (menu order, labels, about); `names` |
| `voice.js` | `lines` (quoted lines with a guessed speaker: tag, beat or paragraph), `profile`, `bySpeaker`, `compare` |

Conventions:
- Offsets are into the text passed in. Paragraphs are lines: flatten a
  chapter's `<p>`s with `\n`.
- Everything is a heuristic and leans towards staying quiet. Thresholds are
  named constants at the top of each file.
- The rules come from Konrad's Writing Techniques notes; a change to a rule
  should say which part of the notes it follows.
- Tests: `scripts/craft-*.test.js` (run by `npm test`). Every module must
  keep `craft-window.test.js` passing, which loads them the window's way.
