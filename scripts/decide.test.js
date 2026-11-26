'use strict';

// decide.js: Kibitz's client for the local decision model, against a fake
// Ollaya on a random port. Loopback only, starting the server when it's
// down, answers checked, timeouts, cancelling, errors by code, and the
// window's IPC way in.

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createDecider, register, fits } = require('../decide.js');

// A fake Ollaya: `reply(body)` decides each answer; it can start "down".
function fakeOllaya({ reply, down = false, delay = 0 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (server.down) { req.socket.destroy(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => setTimeout(() => {
      if (req.method === 'GET' && req.url === '/') { res.end('Ollaya is running'); return; }
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'winnow:e4b' }] })); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const [status, out] = reply(body);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    }, delay));
  });
  server.down = down;
  server.seen = seen;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;
const Q = { s0: { type: 'score', criteria: ['a', 'b', 'c', 'd', 'e'] }, s1: { type: 'choice', criteria: { x: 'X', y: 'Y' } } };
const good = (body) => [200, { model: body.model, answers: { s0: { type: 'score', score: 1.5, confidence: 0.6 }, s1: { type: 'choice', choice: 'y', confidence: 0.3 } } }];

test('only a model on this computer', () => {
  assert.throws(() => createDecider({ url: 'http://example.com:11435' }), { code: 'NOT_LOCAL' });
  assert.throws(() => createDecider({ url: 'http://192.168.1.20:11435' }), { code: 'NOT_LOCAL' });
  assert.doesNotThrow(() => createDecider({ url: 'http://localhost:11435' }));
  assert.doesNotThrow(() => createDecider({ url: 'http://[::1]:11435' }));
});

test('a question answered, the answers checked', async (t) => {
  const server = await fakeOllaya({ reply: () => [200, { model: 'winnow:e4b', answers: { s0: { type: 'score', score: 9 }, s1: { type: 'choice', choice: 'y', confidence: 0.3 } } }] });
  t.after(() => server.close());
  const d = createDecider({ url: urlOf(server) });
  const r = await d.decide({ model: 'winnow:e4b', state: 'Text.', questions: Q });
  assert.deepEqual(r, { model: 'winnow:e4b', answers: { s1: { type: 'choice', choice: 'y', confidence: 0.3 } }, dropped: ['s0'] });
  assert.deepEqual(server.seen[0], { model: 'winnow:e4b', state: 'Text.', questions: Q });
});

test('what fits a question', () => {
  assert.equal(fits({ type: 'score', criteria: [1, 2, 3] }, { type: 'score', score: 2 }), true);
  assert.equal(fits({ type: 'score', criteria: [1, 2, 3] }, { type: 'score', score: 2.5 }), false);
  assert.equal(fits({ type: 'choice', criteria: ['a', 'b'] }, { type: 'choice', choice: 'b' }), true);
  assert.equal(fits({ type: 'choice', criteria: { a: 1 } }, { type: 'choice', choice: 'z' }), false);
  assert.equal(fits({ type: 'noul' }, { type: 'noul', noul: 0.4 }), true);
  assert.equal(fits({ type: 'noul' }, { type: 'score', score: 0 }), false);
  assert.equal(fits({ type: 'noul' }, undefined), false);
});

test('the server\'s errors come back by code', async (t) => {
  const server = await fakeOllaya({ reply: () => [404, { error: 'model "nope" not found', code: 'MODEL_NOT_FOUND' }] });
  t.after(() => server.close());
  const d = createDecider({ url: urlOf(server) });
  await assert.rejects(d.decide({ model: 'nope', state: 'x', questions: Q }), { code: 'MODEL_NOT_FOUND', status: 404 });
  await assert.rejects(d.decide({ model: 'x', state: 'x', questions: {} }), { code: 'INVALID_REQUEST' });
});

test('too slow is a timeout; cancelled is cancelled', async (t) => {
  const server = await fakeOllaya({ reply: good, delay: 400 });
  t.after(() => server.close());
  const d = createDecider({ url: urlOf(server) });
  await assert.rejects(d.decide({ model: 'm', state: 'x', questions: Q, timeout: 100 }), { code: 'TIMEOUT' });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 50);
  await assert.rejects(d.decide({ model: 'm', state: 'x', questions: Q, signal: ctrl.signal }), { code: 'CANCELLED' });
});

test('nothing answering: Ollaya is started once, and waited for', async (t) => {
  const server = await fakeOllaya({ reply: good, down: true });
  t.after(() => server.close());
  let spawned = 0;
  const d = createDecider({
    url: urlOf(server), exists: () => true,
    spawnServer: () => { spawned++; setTimeout(() => { server.down = false; }, 300); }
  });
  const [a, b] = await Promise.all([
    d.decide({ model: 'm', state: 'x', questions: Q }),
    d.decide({ model: 'm', state: 'y', questions: Q })
  ]);
  assert.equal(spawned, 1);
  assert.deepEqual(Object.keys(a.answers), ['s0', 's1']);
  assert.deepEqual(b.dropped, []);
});

test('nothing answering and nothing installed, or a start that never answers', async (t) => {
  const server = await fakeOllaya({ reply: good, down: true });
  t.after(() => server.close());
  const missing = createDecider({ url: urlOf(server), exists: () => false });
  await assert.rejects(missing.decide({ model: 'm', state: 'x', questions: Q }), { code: 'NOT_RUNNING', message: /isn’t installed/ });
  const stuck = createDecider({ url: urlOf(server), exists: () => true, spawnServer: () => {}, startWaitMs: 500 });
  await assert.rejects(stuck.decide({ model: 'm', state: 'x', questions: Q }), { code: 'NOT_RUNNING', message: /didn’t answer/ });
});

test('warm-up and the model list', async (t) => {
  const server = await fakeOllaya({ reply: (b) => [200, { model: b.model, answers: { ready: { type: 'noul', noul: 0.9 } } }] });
  t.after(() => server.close());
  const d = createDecider({ url: urlOf(server) });
  assert.deepEqual((await d.warm('winnow:e4b')).answers, { ready: { type: 'noul', noul: 0.9 } });
  assert.deepEqual(await d.models(), [{ name: 'winnow:e4b' }]);
  assert.equal(await d.health(), true);
});

test('the window\'s way in: answers, errors as values, cancelling by id', async (t) => {
  const server = await fakeOllaya({ reply: good, delay: 300 });
  t.after(() => server.close());
  const handlers = new Map();
  register({ handle: (name, fn) => handlers.set(name, fn) }, createDecider({ url: urlOf(server) }));
  assert.deepEqual([...handlers.keys()], ['kibitz:decide', 'kibitz:decide-cancel', 'kibitz:decide-warm']);
  const ok = await handlers.get('kibitz:decide')(null, { id: 'a', model: 'm', state: 'x', questions: Q });
  assert.deepEqual(Object.keys(ok.answers), ['s0', 's1']);
  const pending = handlers.get('kibitz:decide')(null, { id: 'b', model: 'm', state: 'x', questions: Q });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await handlers.get('kibitz:decide-cancel')(null, 'b'), true);
  assert.deepEqual((await pending).error.code, 'CANCELLED');
  assert.equal(await handlers.get('kibitz:decide-cancel')(null, 'nobody'), false);
  const bad = await handlers.get('kibitz:decide')(null, { model: 'm', state: 'x', questions: {} });
  assert.equal(bad.error.code, 'INVALID_REQUEST');
});
