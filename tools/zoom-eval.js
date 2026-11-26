#!/usr/bin/env node
'use strict';

// Kibitz: how close does each local decision model come to Konrad's feel
// for zoom levels? Reads paragraphs.json and his labels.md (one [n] per
// sentence, 1-5, empty for "can't decide"), asks every model in every
// way (craft/zoom.js VARIANTS) through decide.js, and reports per pairing:
// average distance in levels, share within one level, rank agreement,
// agreement on the three flags, the same after stretching the model's
// scale to his, and speed. Not right and wrong: how close together.
//
//   node tools/zoom-eval.js [--dir private/eval/zoom] [--models a,b] [--variants a,b]
//                           [--set konrad|reference] [--split dev|test|train|all]
//                           [--stretch a,b]
//
// --set konrad (the default) measures against Konrad's labels.md on
// paragraphs.json; --set reference against Claude's rubric labels
// (mine.json) on reference.json, one split of it (dev by default: test is
// kept for the last word). --stretch a,b uses a fixed stretch (fitted on
// another split) instead of fitting on the labels being measured: the
// honest way to read the test split.
//
// Refuses to run before there are labels, so nobody sees a model's
// answers first. Writes report.md and report.json beside the labels.

const fs = require('fs');
const path = require('path');
const Z = require('../craft/zoom.js');
const { createDecider } = require('../decide.js');

const DEFAULT_MODELS = ['winnow:e4b', 'decider', 'laya:en'];

function parseLabels(md) {
  const out = new Map();
  let id = null;
  for (const line of md.split('\n')) {
    const h = /^##\s+(p\d+)\b/.exec(line);
    if (h) { id = h[1]; out.set(id, []); continue; }
    const l = /^\[\s*([1-5](?:\.\d+)?)?\s*\]\s/.exec(line);
    if (l && id) out.get(id).push(l[1] ? Number(l[1]) : null);
  }
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x) => (x === null ? '–' : Math.round(x * 100) + '%');
const num = (x, d = 2) => (x === null ? '–' : x.toFixed(d));

function loadSet(dir, set, split) {
  if (set === 'reference') {
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'reference.json'), 'utf8'));
    const mine = JSON.parse(fs.readFileSync(path.join(dir, 'mine.json'), 'utf8'));
    const paragraphs = all.filter((p) => split === 'all' || p.split === split);
    return { paragraphs, labels: new Map(paragraphs.map((p) => [p.id, mine[p.id] || []])), who: 'Claude’s rubric labels', tag: `reference-${split}` };
  }
  return {
    paragraphs: JSON.parse(fs.readFileSync(path.join(dir, 'paragraphs.json'), 'utf8')),
    labels: parseLabels(fs.readFileSync(path.join(dir, 'labels.md'), 'utf8')),
    who: 'Konrad’s feel', tag: 'konrad'
  };
}

async function run({ dir = 'private/eval/zoom', models = DEFAULT_MODELS, variants = Z.VARIANTS, set = 'konrad', split = 'dev', stretch = null, decider = createDecider(), log = console.log } = {}) {
  const { paragraphs, labels, who, tag } = loadSet(dir, set, split);
  const human = paragraphs.map((p) => {
    const ls = labels.get(p.id) || [];
    if (ls.length !== p.sentences.length) throw new Error(`${p.id}: ${ls.length} labels for ${p.sentences.length} sentences; was a line added or removed in labels.md?`);
    return ls;
  });
  const labelled = human.flat().filter(Number.isFinite).length;
  if (!labelled) throw new Error('No labels yet: fill in labels.md first (the models’ answers stay unseen until then).');
  log(`${paragraphs.length} paragraphs, ${labelled} of ${human.flat().length} sentences labelled`);

  const rows = [];
  const raw = {};
  for (const model of models) {
    const t0 = Date.now();
    try { await decider.warm(model); } catch (err) { log(`${model}: ${err.code || ''} ${err.message}`); continue; }
    const load = (Date.now() - t0) / 1000;
    for (const variant of variants) {
      const levels = [];
      const confidences = [];
      let dropped = 0;
      const t1 = Date.now();
      for (const p of paragraphs) {
        const got = new Array(p.sentences.length).fill(null);
        for (const req of Z.questions(p.sentences, variant)) {
          try {
            const r = await decider.decide({ model, state: req.state, questions: req.questions });
            dropped += r.dropped.length;
            Z.levels(r.answers, p.sentences.length).forEach((x, i) => {
              if (x) { got[i] = x.level; confidences.push(x.confidence); }
            });
          } catch { dropped += Object.keys(req.questions).length; } // a request that fails counts its questions as dropped
        }
        levels.push(got);
      }
      const secs = (Date.now() - t1) / 1000;
      const sentences = paragraphs.reduce((n, p) => n + p.sentences.length, 0);
      const fit = stretch || Z.stretchFit(levels.flat(), human.flat());
      const stretched = levels.map((ls) => ls.map((x) => (Number.isFinite(x) ? Z.stretch(x, fit) : null)));
      const c = Z.compare(human, levels);
      const s = Z.compare(human, stretched);
      const row = { model, variant, load, perSentence: secs / sentences, dropped, confidence: avg(confidences), raw: c, stretched: s, fit };
      rows.push(row);
      raw[`${model} / ${variant}`] = levels;
      log(`${model} / ${variant}: distance ${num(c.distance)}, within one ${pct(c.withinOne)}, flags ${pct(avg(Object.values(c.flagAgree)))}; stretched ${num(s.distance)} / ${pct(s.withinOne)} / ${pct(avg(Object.values(s.flagAgree)))}; ${num(row.perSentence)} s a sentence`);
    }
  }
  const flagsOf = (c) => avg(Object.values(c.flagAgree).filter((x) => x !== null));
  // closest first: flags are judged on few paragraphs and swing on a single
  // call, so distance leads and flags break ties
  rows.sort((a, b) => (a.stretched.distance - b.stretched.distance) || (flagsOf(b.stretched) - flagsOf(a.stretched)));
  // The bar to clear: a "model" that reads nothing and always answers the
  // median of the labels. (It also never raises a flag, unless the median
  // is at an extreme.) A real model is only worth having if it beats this.
  const known = human.flat().filter(Number.isFinite).sort((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)];
  const flat = human.map((ls) => ls.map((x) => (Number.isFinite(x) ? median : null)));
  const baseline = { model: 'baseline', variant: `always ${median}`, raw: Z.compare(human, flat) };
  baseline.stretched = baseline.raw;
  const beats = (r) => r.stretched.distance < baseline.raw.distance && flagsOf(r.stretched) >= flagsOf(baseline.raw);
  log(`baseline / always ${median}: distance ${num(baseline.raw.distance)}, within one ${pct(baseline.raw.withinOne)}, flags ${pct(flagsOf(baseline.raw))}`);
  const md = [`# Zoom levels: models against ${who} (${tag})`, '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${paragraphs.length} paragraphs · ${labelled} labelled sentences`, '',
    (stretch ? `Stretch fixed in advance: ${num(stretch.a)} + ${num(stretch.b)} × level (not fitted on these labels).\n\n` : '') + 'Distance: average gap in levels (lower is closer). Within one: share of sentences no more than a level apart. Rank: Spearman correlation of the two orderings. Flags: how often the two agree on each paragraph\'s flags (ends on the close-up / never comes down / climbs back only to where it opened). Stretched: the model\'s scale fitted to the labels with a straight line (fitted on these same labels, so a little flattering).', '',
    '| Model | Asked | Distance | Within one | Rank | Flags | Stretched distance | Stretched within one | Stretched flags | Confidence | s / sentence | Dropped | Load s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  md.push(`| *baseline* | *always ${median}* | ${num(baseline.raw.distance)} | ${pct(baseline.raw.withinOne)} | – | ${pct(flagsOf(baseline.raw))} | | | | | | | |`);
  for (const r of rows) {
    md.push(`| ${r.model} | ${r.variant} | ${num(r.raw.distance)} | ${pct(r.raw.withinOne)} | ${num(r.raw.rank)} | ${pct(flagsOf(r.raw))} | ${num(r.stretched.distance)} | ${pct(r.stretched.withinOne)} | ${pct(flagsOf(r.stretched))} | ${num(r.confidence)} | ${num(r.perSentence)} | ${r.dropped} | ${num(r.load, 1)} |`);
  }
  if (rows.length) {
    const best = rows[0];
    const winners = rows.filter(beats);
    md.push('', winners.length
      ? `Beating the baseline (closer, and no worse on flags, after stretching): ${winners.map((r) => `${r.model} / ${r.variant}`).join(', ')}.`
      : `**No model beats the baseline** (always answering ${median}) on both distance and flags, even after stretching.`);
    md.push('', `Closest: **${best.model}**, asked by **${best.variant}**: flags agree ${pct(flagsOf(best.stretched))} of the time after stretching (ends on the close-up ${pct(best.stretched.flagAgree.endsClose)}, never comes down ${pct(best.stretched.flagAgree.neverDown)}, only back ${pct(best.stretched.flagAgree.onlyBack)}); stretch ${num(best.fit.a)} + ${num(best.fit.b)} × level.`);
  }
  const name = tag === 'konrad' ? 'report' : `report-${tag}`;
  fs.writeFileSync(path.join(dir, name + '.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ rows, baseline, human, levels: raw }, null, 2) + '\n');
  return Object.assign(rows, { baseline, beats: rows.filter(beats).map((r) => `${r.model}/${r.variant}`) });
}

if (require.main === module) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  run({
    dir: arg('dir', 'private/eval/zoom'),
    models: arg('models', DEFAULT_MODELS.join(',')).split(','),
    variants: arg('variants', Z.VARIANTS.join(',')).split(','),
    set: arg('set', 'konrad'),
    split: arg('split', 'dev'),
    stretch: arg('stretch') ? (([a, b]) => ({ a: Number(a), b: Number(b) }))(arg('stretch').split(',')) : null
  }).then((rows) => {
    if (!rows.length) { console.error('No model answered.'); process.exit(1); }
    console.log('\nReport written beside the labels, in ' + arg('dir', 'private/eval/zoom'));
  }).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { run, parseLabels };
