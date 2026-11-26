#!/usr/bin/env node
'use strict';

// Kibitz: how well does the local model read a scene? For each boundary in
// private/eval/story/boundaries.json (a narrated sentence in a public-domain
// novel has just ended), the model answers craft/story.js's yes/no
// readings ("Is something about to be shown?") in one request; Claude's
// labels (labels.json, written before any model answer was seen) say what
// the answer should be.
//
//   node tools/story-eval.js --split dev     per reading, the chance of
//       "yes" that best separates (best F1 among cuts with precision ≥ 0.6
//       and recall ≥ 0.4, else best F1); writes thresholds.json
//   node tools/story-eval.js --split test    reads once with those cuts:
//       a reading passes with precision ≥ 0.6, recall ≥ 0.4 and at least 8
//       real yeses to judge by
//
//   node tools/story-eval.js --ladder --split dev|test    take three:
//       each reading's ladder (craft/ladders.js), cut fixed at level 3;
//       writes report-ladder-<split>.md/.json
//
// Also: speed once warm (--time-only a,b also times a request asking only
// those readings, the ones that could ship). Writes report-<split>.md/.json (with every answer).

const fs = require('fs');
const path = require('path');
const St = require('../craft/story.js');
const { createDecider } = require('../decide.js');

const L = require('../craft/ladders.js');
const CUTS = Array.from({ length: 19 }, (_, i) => Math.round((0.05 + i * 0.05) * 100) / 100);
const BAR = { precision: 0.6, recall: 0.4, minYes: 8 };
const pct = (x) => (x === null || !Number.isFinite(x) ? '–' : Math.round(x * 100) + '%');

function score(rows, key, cut) {
  let tp = 0, fp = 0, fn = 0;
  for (const r of rows) {
    const said = r.chances[key] >= cut;
    const truth = r.truth.includes(key);
    if (said && truth) tp++;
    else if (said) fp++;
    else if (truth) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { cut, yes: tp + fn, said: tp + fp, tp, precision, recall, f1 };
}

// The dev split's cut for one reading.
function chooseCut(rows, key) {
  const all = CUTS.map((c) => score(rows, key, c));
  const ok = all.filter((s) => s.precision >= BAR.precision && s.recall >= BAR.recall);
  const pool = ok.length ? ok : all;
  return pool.reduce((best, s) => (s.f1 > best.f1 ? s : best), pool[0]);
}

const passes = (s) => s.yes >= BAR.minYes && s.precision >= BAR.precision && s.recall >= BAR.recall;

// AUC: how often a real yes gets a higher score than a real no.
function auc(rows, key, get) {
  const ys = rows.filter((r) => r.truth.includes(key)).map(get).filter(Number.isFinite);
  const ns = rows.filter((r) => !r.truth.includes(key)).map(get).filter(Number.isFinite);
  if (!ys.length || !ns.length) return null;
  let c = 0;
  for (const y of ys) for (const n of ns) c += y > n ? 1 : y === n ? 0.5 : 0;
  return c / (ys.length * ns.length);
}

// Take three: each reading's ladder, a fixed cut (level ≥ St.LADDER_CUT)
// set before any run, so dev and test are both read once.
async function runLadders({ dir = 'private/eval/story', split = 'test', decider = createDecider(), log = console.log } = {}) {
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const sources = new Set(L.SOURCES);
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'boundaries.json'), 'utf8')).filter((b) => b.split === split && !sources.has(b.id));
  if (!all.length) throw new Error(`No boundaries in the ${split} split.`);
  await decider.warm(St.MODEL);
  const rows = [];
  for (const b of all) {
    const levels = {};
    const t0 = Date.now();
    for (const key of St.KEYS) {
      const q = St.ladderQuestion({ scene: b.context }, key);
      try {
        const res = await decider.decide({ model: q.model, state: q.state, questions: q.questions, timeout: 60000 });
        levels[key] = St.ladderLevel(res.answers);
      } catch (err) {
        log(`${b.id} ${key}: ${err.code || err.message}`);
      }
    }
    rows.push({ id: b.id, ms: Date.now() - t0, levels, truth: labels[b.id] || [] });
  }
  let before = null;
  try { before = JSON.parse(fs.readFileSync(path.join(dir, `report-${split}.json`), 'utf8')).rows; } catch { before = null; }
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const qn = (f) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(f * ms.length))] : null);
  const results = St.KEYS.map((key) => {
    const s = score(rows.map((r) => ({ chances: { [key]: r.levels[key] }, truth: r.truth })), key, St.LADDER_CUT);
    const keep = new Set(rows.map((r) => r.id));
    const prev = before ? auc(before.filter((r) => keep.has(r.id)), key, (r) => r.chances[key]) : null;
    return { key, ...s, pass: passes(s), auc: auc(rows, key, (r) => r.levels[key]), aucBefore: prev };
  });
  const lines = [`# Story readings by ladder: ${split} split`, '',
    `${rows.length} boundaries (ladder sources left out), ${St.MODEL}. A reading counts at level ≥ ${St.LADDER_CUT} of 5 (fixed in advance). Bar: precision ≥ ${pct(BAR.precision)}, recall ≥ ${pct(BAR.recall)}, at least ${BAR.minYes} real yeses.`, '',
    '| Reading | Real yeses | Said yes | Precision | Recall | Ranks right (ladder) | Ranks right (yes/no, take two) | Passes |', '|---|---|---|---|---|---|---|---|'];
  for (const r of results) lines.push(`| ${r.key} | ${r.yes} | ${r.said} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.auc)} | ${pct(r.aucBefore)} | ${r.pass ? 'yes' : r.yes < BAR.minYes ? 'too few to judge' : 'no'} |`);
  lines.push('', `All nine ladders per moment, warm: median ${qn(0.5)} ms, 90th percentile ${qn(0.9)} ms.`, '');
  const md = lines.join('\n');
  fs.writeFileSync(path.join(dir, `report-ladder-${split}.md`), md);
  fs.writeFileSync(path.join(dir, `report-ladder-${split}.json`), JSON.stringify({ split, model: St.MODEL, cut: St.LADDER_CUT, results, rows }, null, 1) + '\n');
  log(md);
  return results;
}

async function run({ dir = 'private/eval/story', split = 'dev', timeOnly = null, decider = createDecider(), log = console.log } = {}) {
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'boundaries.json'), 'utf8')).filter((b) => b.split === split);
  if (!all.length) throw new Error(`No boundaries in the ${split} split.`);
  let fixed = null;
  if (split === 'test') {
    const file = path.join(dir, 'thresholds.json');
    if (!fs.existsSync(file)) throw new Error('Run the dev split first: the test split reads its cuts from thresholds.json.');
    fixed = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  await decider.warm(St.MODEL);
  const rows = [];
  for (const b of all) {
    if (!(b.id in labels)) throw new Error(`No label for ${b.id}.`);
    const q = St.question({ scene: b.context });
    const t0 = Date.now();
    try {
      const res = await decider.decide({ model: q.model, state: q.state, questions: q.questions, timeout: 30000 });
      rows.push({ id: b.id, ms: Date.now() - t0, chances: St.yesChances(res.answers), truth: labels[b.id] });
    } catch (err) {
      log(`${b.id}: ${err.code || err.message}`);
    }
  }
  const quantiles = (xs) => {
    const ms = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return (f) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(f * ms.length))] : null);
  };
  const q = quantiles(rows.map((r) => r.ms));
  // Speed of a smaller request: only the readings that could ship (their
  // answers aren't scored; the scored ones come from the full request).
  let small = null;
  if (timeOnly && timeOnly.length) {
    const times = [];
    for (const b of all) {
      const sq = St.question({ scene: b.context }, timeOnly);
      const t0 = Date.now();
      try { await decider.decide({ model: sq.model, state: sq.state, questions: sq.questions, timeout: 30000 }); times.push(Date.now() - t0); } catch { /* counted as missing */ }
    }
    small = quantiles(times);
  }
  const results = St.KEYS.map((key) => {
    const s = fixed ? score(rows, key, fixed[key]) : chooseCut(rows, key);
    return { key, ...s, pass: passes(s) };
  });
  const lines = [`# Story readings: ${split} split`, '',
    `${rows.length} of ${all.length} boundaries answered by ${St.MODEL}. ${fixed ? 'Cuts fixed from the dev split.' : 'Cuts chosen here.'} Bar: precision ≥ ${pct(BAR.precision)}, recall ≥ ${pct(BAR.recall)}, at least ${BAR.minYes} real yeses.`, '',
    '| Reading | Real yeses | Cut | Said yes | Precision | Recall | Passes |', '|---|---|---|---|---|---|---|'];
  for (const r of results) lines.push(`| ${r.key} | ${r.yes} | ${r.cut} | ${r.said} | ${pct(r.precision)} | ${pct(r.recall)} | ${r.pass ? 'yes' : r.yes < BAR.minYes ? 'too few to judge' : 'no'} |`);
  lines.push('', `Speed once warm, all nine in one request: median ${q(0.5)} ms, 90th percentile ${q(0.9)} ms.`);
  if (small) lines.push(`Asking only ${timeOnly.join(', ')}: median ${small(0.5)} ms, 90th percentile ${small(0.9)} ms.`);
  lines.push('');
  const md = lines.join('\n');
  fs.writeFileSync(path.join(dir, `report-${split}.md`), md);
  fs.writeFileSync(path.join(dir, `report-${split}.json`), JSON.stringify({ split, model: St.MODEL, results, rows }, null, 1) + '\n');
  if (!fixed) fs.writeFileSync(path.join(dir, 'thresholds.json'), JSON.stringify(Object.fromEntries(results.map((r) => [r.key, r.cut])), null, 1) + '\n');
  log(md);
  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
  (args.includes('--ladder') ? runLadders({ dir: opt('dir'), split: opt('split') }) : run({ dir: opt('dir'), split: opt('split'), timeOnly: opt('time-only') ? opt('time-only').split(',') : null })).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { run, runLadders, auc, score, chooseCut, passes, CUTS, BAR };
