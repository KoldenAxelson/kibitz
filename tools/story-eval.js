#!/usr/bin/env node
'use strict';

// Kibitz: does the story layer read a scene the way its author did? At
// each boundary in private/eval/story/boundaries.json (a narrated sentence
// in a public-domain novel has just ended), the model (craft/story.js)
// picks the shape the next sentence should take; a hit is when the
// author's actual next sentence has that shape (craft/shapes.js).
//
// A raw hit rate flatters a model that just picks common shapes, so each
// threshold is compared with the same picks shuffled across the
// boundaries: what that mix of choices would score by luck. The gap
// ("lift") is what reading the scene adds. Also: how often it speaks
// (coverage), the rhythm layer's own hit rate and lift for reference, and
// speed once warm.
//
//   node tools/story-eval.js [--dir private/eval/story] [--split dev|test]
//                            [--min 0.4] [--model winnow:e4b]
//
// The dev split chooses the threshold; the test split, read once with a
// --min fixed in advance, has the last word. Writes report-<split>.md/.json.

const fs = require('fs');
const path = require('path');
const St = require('../craft/story.js');
const S = require('../craft/shapes.js');
const T = require('../craft/text.js');
const Sg = require('../craft/suggest.js');
const { createDecider } = require('../decide.js');

const THRESHOLDS = [0, 0.3, 0.4, 0.5, 0.6, 0.7];
const pct = (x) => (x === null || !Number.isFinite(x) ? '–' : Math.round(x * 100) + '%');
const pts = (x) => (x === null || !Number.isFinite(x) ? '–' : (x >= 0 ? '+' : '') + Math.round(x * 100));

// A seeded shuffle, so a report reads the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// Hit rate of `picks` (shape per item) against `actual` (shape sets), and
// the mean hit rate of the same picks shuffled.
function lift(picks, actual, rounds = 500) {
  const n = picks.length;
  if (!n) return { n, hit: null, chance: null, lift: null };
  const hit = picks.filter((p, i) => actual[i].has(p)).length / n;
  const rand = rng(42);
  let total = 0;
  for (let r = 0; r < rounds; r++) {
    const order = picks.map((p) => [rand(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    total += order.filter((p, i) => actual[i].has(p)).length / n;
  }
  const chance = total / rounds;
  return { n, hit, chance, lift: hit - chance };
}

function rhythmAt(context) {
  const sents = T.sentences(context);
  const used = new Set(sents.flatMap((s) => [...S.shapesOf(s)]));
  return Sg.suggest(sents, { chapter: { sentences: sents.length, shapesUsed: used } });
}

function summarize(rows, total) {
  const byThreshold = THRESHOLDS.map((min) => {
    const spoke = rows.filter((r) => r.pick && r.pick !== 'none' && r.p >= min);
    return { min, coverage: spoke.length / total, ...lift(spoke.map((r) => r.pick), spoke.map((r) => new Set(r.actual))) };
  });
  const rh = rows.filter((r) => r.rhythm);
  const rhythm = { coverage: rh.length / total, ...lift(rh.map((r) => r.rhythm), rh.map((r) => new Set(r.actual))) };
  const ms = rows.map((r) => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (f) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(f * ms.length))] : null);
  const picks = {};
  for (const r of rows) if (r.pick) picks[r.pick] = (picks[r.pick] || 0) + 1;
  return { byThreshold, rhythm, speed: { p50: q(0.5), p90: q(0.9) }, picks };
}

function report(split, model, s, total, failed) {
  const lines = [`# Story layer: ${split} split`, '',
    `${total} boundaries, model ${model}${failed ? `, ${failed} unanswered` : ''}. A hit: the author's next sentence has the picked shape. Lift: hit rate minus the same picks shuffled.`, '',
    '| Speaks when sure of | Coverage | Hit rate | By luck | Lift |', '|---|---|---|---|---|'];
  for (const t of s.byThreshold) lines.push(`| ≥ ${t.min} | ${pct(t.coverage)} (${t.n}) | ${pct(t.hit)} | ${pct(t.chance)} | ${pts(t.lift)} |`);
  lines.push(`| rhythm layer | ${pct(s.rhythm.coverage)} (${s.rhythm.n}) | ${pct(s.rhythm.hit)} | ${pct(s.rhythm.chance)} | ${pts(s.rhythm.lift)} |`, '',
    `Speed once warm: median ${s.speed.p50} ms, 90th percentile ${s.speed.p90} ms.`, '',
    `Picks: ${Object.entries(s.picks).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`, '');
  return lines.join('\n');
}

async function run({ dir = 'private/eval/story', split = 'dev', model = St.MODEL, decider = createDecider(), log = console.log } = {}) {
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'boundaries.json'), 'utf8')).filter((b) => b.split === split);
  if (!all.length) throw new Error(`No boundaries in the ${split} split.`);
  await decider.warm(model);
  const rows = [];
  let failed = 0;
  for (const b of all) {
    const q = St.question({ scene: b.context });
    const t0 = Date.now();
    let res;
    try {
      res = await decider.decide({ model, state: q.state, questions: q.questions, timeout: 30000 });
    } catch (err) {
      failed++;
      log(`${b.id}: ${err.code || err.message}`);
      continue;
    }
    const a = res.answers.next;
    const r = St.pick(res.answers, 0);
    const rh = rhythmAt(b.context);
    rows.push({
      id: b.id, ms: Date.now() - t0,
      pick: a ? a.choice : null, p: r ? r.confidence : a && a.choice === 'none' ? 1 : 0,
      rhythm: rh && rh.shape, actual: [...S.shapesOf(b.next)]
    });
  }
  const s = summarize(rows, all.length);
  const md = report(split, model, s, all.length, failed);
  fs.writeFileSync(path.join(dir, `report-${split}.md`), md);
  fs.writeFileSync(path.join(dir, `report-${split}.json`), JSON.stringify({ split, model, rows, ...s }, null, 1) + '\n');
  log(md);
  return s;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
  run({ dir: opt('dir'), split: opt('split'), model: opt('model') }).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { run, lift, summarize, rhythmAt, THRESHOLDS };
