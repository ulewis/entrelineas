import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationQueue, Transcript } from '../docs/core.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const task = (id, text, revision = 1, final = false) => ({ id, text, revision, final, receivedAt: performance.now() });

test('slow translation coalesces changing speech, preserves completed phrases, and never runs concurrently', async () => {
  const started = [], finished = [], releases = [];
  const queue = new TranslationQueue({
    delay: 0,
    translate: text => new Promise(resolve => { started.push(text); releases.push(resolve); }),
    onResult: result => finished.push(result)
  });
  queue.enqueue(task('one', 'hello', 1, true));
  queue.enqueue(task('two', 'we', 1));
  queue.enqueue(task('two', 'we are', 2));
  queue.enqueue(task('two', 'we are ready', 3, true));
  queue.enqueue(task('three', 'next', 1));
  assert.deepEqual(started, ['hello']);
  releases.shift()('hola'); await settle();
  assert.deepEqual(started, ['hello', 'we are ready']);
  releases.shift()('estamos listos'); await settle();
  assert.deepEqual(started, ['hello', 'we are ready', 'next']);
  releases.shift()('siguiente'); await settle();
  assert.deepEqual(finished.map(item => item.text), ['hola', 'estamos listos', 'siguiente']);
  queue.reset();
});

test('rapid interim results keep the earliest pending deadline instead of starving output', async () => {
  let clock = 0;
  const calls = [];
  const queue = new TranslationQueue({ delay: 140, now: () => clock, translate: async text => { calls.push(text); return text; }, onResult() {} });
  queue.enqueue({ ...task('one', 'we', 1), receivedAt: 0 });
  clock = 100;
  queue.enqueue({ ...task('one', 'we are', 2), receivedAt: 100 });
  assert.equal(queue.pending.get('one').queuedAt, 0);
  clock = 150;
  queue.enqueue({ ...task('one', 'we are ready', 3), receivedAt: 150 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls, ['we are ready']);
  queue.reset();
});

test('clearing a session suppresses an in-flight result without overlapping a new translation', async () => {
  const releases = [], results = [];
  const queue = new TranslationQueue({ translate: () => new Promise(resolve => releases.push(resolve)), onResult: item => results.push(item) });
  queue.enqueue(task('old', 'old audio', 1, true));
  queue.reset();
  queue.enqueue(task('new', 'new audio', 1, true));
  assert.equal(releases.length, 1);
  releases.shift()('viejo'); await settle();
  assert.equal(results.length, 0);
  releases.shift()('nuevo'); await settle();
  assert.deepEqual(results.map(item => item.text), ['nuevo']);
  queue.reset();
});

test('a translation failure does not discard later finalized speech', async () => {
  const errors = [], results = [];
  const queue = new TranslationQueue({
    translate: async text => { if (text === 'bad') throw new Error('unavailable'); return text; },
    onResult: item => results.push(item), onError: (error, item) => errors.push(item.id)
  });
  queue.enqueue(task('one', 'bad', 1, true));
  queue.enqueue(task('two', 'good', 1, true));
  await settle();
  assert.deepEqual(errors, ['one']);
  assert.deepEqual(results.map(item => item.id), ['two']);
  queue.reset();
});

test('a stale partial translation cannot replace a newer final translation', () => {
  const transcript = new Transcript();
  transcript.update('one', 'We are', false, 1);
  transcript.update('one', 'We are ready.', true, 2);
  transcript.apply({ id: 'one', revision: 2, final: true, text: 'Estamos listos.', elapsed: 40 });
  assert.equal(transcript.apply({ id: 'one', revision: 1, final: false, text: 'Somos', elapsed: 300 }), null);
  assert.equal(transcript.update('one', 'We', false, 3), null);
  assert.match(transcript.exportText(), /EN: We are ready\.\nES: Estamos listos\./);
});

test('long meetings retain a bounded recent history and removed rows ignore late results', () => {
  const transcript = new Transcript(2);
  transcript.update('one', 'First', true, 1);
  transcript.update('two', 'Second', true, 2);
  transcript.update('three', 'Third', false, 3);
  assert.equal(transcript.rows.size, 2);
  assert.equal(transcript.rows.has('one'), false);
  assert.equal(transcript.apply({ id: 'one', revision: 1, text: 'Primero' }), null);
  assert.match(transcript.exportText(), /Traducción pendiente/);
  transcript.clear();
  assert.equal(transcript.exportText(), '');
});
