'use strict';

// KIBITZ: the local decision model, asked from the main process. Kibitz's
// model features (the Zoom pass, the suggester's story layer) ask typed
// questions of a System One model served by Ollaya on this Mac
// (POST /v1/systemone: a state, questions keyed by id, typed answers with
// confidences back). The window never talks to it directly; it goes through
// register()'s IPC handlers, like every other way out of the window.
//
// The manuscript never leaves the computer: only loopback addresses are
// accepted. When nothing answers, Kibitz starts `ollaya serve` itself from
// ~/.local/bin (where Konrad's install put it) and waits for it. (Tests set
// KIBITZ_DECIDE_URL and KIBITZ_OLLAYA_BIN to a fake server and no binary.) Every
// request has a timeout and can be cancelled; an answer that doesn't fit
// its question is dropped, never guessed at. Errors carry a code:
//   NOT_LOCAL, NOT_RUNNING, MODEL_NOT_FOUND, TIMEOUT, CANCELLED,
//   BAD_RESPONSE, or the server's own code (QUEUE_FULL, INPUT_TOO_LONG...).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_URL = 'http://127.0.0.1:11435';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const HEALTH_MS = 1500;
const START_WAIT_MS = 20000;
const TIMEOUT_MS = 90000; // a cold model can take ~30 s to load before it answers

class DecideError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'DecideError';
    this.code = code;
    if (status) this.status = status;
  }
}

const defaultSpawn = (binary) => spawn(binary, ['serve'], { detached: true, stdio: 'ignore' }).unref();

// Does an answer fit the question it answers?
function fits(question, answer) {
  if (!answer || answer.type !== question.type) return false;
  const n = Array.isArray(question.criteria) ? question.criteria.length : question.criteria ? Object.keys(question.criteria).length : 0;
  if (question.type === 'score') return Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= n - 1;
  if (question.type === 'choice') {
    const keys = Array.isArray(question.criteria) ? question.criteria : Object.keys(question.criteria || {});
    return keys.includes(answer.choice);
  }
  if (question.type === 'noul') return Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
  return false;
}

function createDecider({
  url = process.env.KIBITZ_DECIDE_URL || DEFAULT_URL,
  fetch = globalThis.fetch,
  binary = process.env.KIBITZ_OLLAYA_BIN || path.join(os.homedir(), '.local', 'bin', 'ollaya'),
  exists = (p) => fs.existsSync(p),
  spawnServer = defaultSpawn,
  startWaitMs = START_WAIT_MS,
  timeoutMs = TIMEOUT_MS
} = {}) {
  const base = new URL(url);
  if (!LOOPBACK.has(base.hostname)) throw new DecideError('NOT_LOCAL', `Kibitz only asks a model on this computer, not ${base.hostname}`);
  const at = (p) => new URL(p, base).toString();
  let starting = null;

  async function health() {
    try {
      const res = await fetch(at('/'), { signal: AbortSignal.timeout(HEALTH_MS) });
      return res.ok && /Ollaya is running/.test(await res.text());
    } catch { return false; }
  }

  // Answering, or started and answering, or a NOT_RUNNING error. Several
  // callers at once share one start.
  async function ensureRunning() {
    if (await health()) return true;
    if (!starting) {
      starting = (async () => {
        if (!exists(binary)) throw new DecideError('NOT_RUNNING', `Ollaya isn’t running, and isn’t installed at ${binary}`);
        spawnServer(binary);
        const until = Date.now() + startWaitMs;
        while (Date.now() < until) {
          if (await health()) return true;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new DecideError('NOT_RUNNING', 'Ollaya was started but didn’t answer in time');
      })().finally(() => { starting = null; });
    }
    return starting;
  }

  // Ask. Returns { model, answers, dropped }: answers keyed like the
  // questions, only the ones that fit; dropped lists the ids that didn't.
  async function decide({ model, state, questions, signal, timeout = timeoutMs }) {
    if (!model || state === undefined || !questions || !Object.keys(questions).length) throw new DecideError('INVALID_REQUEST', 'model, state and questions are needed');
    await ensureRunning();
    const timer = AbortSignal.timeout(timeout);
    const both = signal ? AbortSignal.any([signal, timer]) : timer;
    let res;
    try {
      res = await fetch(at('/v1/systemone'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions }), signal: both
      });
    } catch (err) {
      if (signal && signal.aborted) throw new DecideError('CANCELLED', 'Cancelled');
      if (timer.aborted) throw new DecideError('TIMEOUT', `No answer in ${Math.round(timeout / 1000)} s`);
      throw new DecideError('NOT_RUNNING', 'Ollaya stopped answering: ' + (err && err.message));
    }
    let body;
    try { body = await res.json(); } catch { throw new DecideError('BAD_RESPONSE', 'The answer wasn’t JSON', res.status); }
    if (!res.ok) throw new DecideError(body && body.code || 'HTTP_' + res.status, body && body.error || res.statusText, res.status);
    if (!body || typeof body.answers !== 'object') throw new DecideError('BAD_RESPONSE', 'The answer had no answers');
    const answers = {};
    const dropped = [];
    for (const [id, q] of Object.entries(questions)) {
      if (fits(q, body.answers[id])) answers[id] = body.answers[id];
      else dropped.push(id);
    }
    return { model: body.model || model, answers, dropped };
  }

  // Load a model before it's needed (a cold one takes ~30 s).
  const warm = (model, opts = {}) => decide({ model, state: 'Ready.', questions: { ready: { type: 'noul', instructions: 'Is this text?' } }, ...opts });

  async function models() {
    await ensureRunning();
    const res = await fetch(at('/v1/models'), { signal: AbortSignal.timeout(HEALTH_MS * 2) });
    const body = await res.json();
    return Array.isArray(body.models) ? body.models : [];
  }

  return { url: base.toString(), health, ensureRunning, decide, warm, models };
}

// The window's way in: ipcRenderer.invoke('kibitz:decide', { id, model,
// state, questions }) and ('kibitz:decide-cancel', id); errors come back as
// { error: { code, message } } rather than thrown, so the window can stay
// quiet about them.
function register(ipcMain, decider = createDecider()) {
  const running = new Map();
  ipcMain.handle('kibitz:decide', async (_e, req = {}) => {
    const ctrl = new AbortController();
    if (req.id) running.set(req.id, ctrl);
    try {
      return await decider.decide({ model: req.model, state: req.state, questions: req.questions, signal: ctrl.signal });
    } catch (err) {
      return { error: { code: err.code || 'ERROR', message: err.message } };
    } finally {
      if (req.id) running.delete(req.id);
    }
  });
  ipcMain.handle('kibitz:decide-cancel', (_e, id) => {
    const ctrl = running.get(id);
    if (ctrl) ctrl.abort();
    return !!ctrl;
  });
  ipcMain.handle('kibitz:decide-warm', async (_e, model) => {
    try { await decider.warm(model); return { ok: true }; } catch (err) { return { error: { code: err.code || 'ERROR', message: err.message } }; }
  });
  return decider;
}

module.exports = { DecideError, createDecider, register, fits, DEFAULT_URL };
