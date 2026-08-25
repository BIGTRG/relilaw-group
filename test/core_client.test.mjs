import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreClient, CoreUnavailableError, CoreRequestError, mintExternalRef,
} from '../src/lib/core-client.mjs';

const jsonRes = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function clientWith(fetchScript) {
  let call = 0;
  const calls = [];
  const client = createCoreClient({
    baseUrl: 'http://core.test',
    apiKey: 'k_test',
    fetchImpl: async (url, opts) => {
      calls.push({ url: String(url), opts });
      const step = fetchScript[Math.min(call, fetchScript.length - 1)];
      call++;
      if (step === 'hang') return new Promise(() => {});
      if (step instanceof Error) throw step;
      return step;
    },
  });
  return { client, calls };
}

test('external_ref is opaque, prefixed, never an email', () => {
  const ref = mintExternalRef();
  assert.match(ref, /^reli_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(mintExternalRef(), ref);
});

test('idempotent reads retry on 5xx and then succeed', async () => {
  const { client, calls } = clientWith([jsonRes(500), jsonRes(502), jsonRes(200, { ok: 1 })]);
  const out = await client.listCourses();
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls.length, 3);
});

test('writes are never retried and always carry an Idempotency-Key', async () => {
  const { client, calls } = clientWith([jsonRes(500)]);
  await assert.rejects(client.enroll({ learnerId: 'l1', courseId: 'c1' }), CoreUnavailableError);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers['idempotency-key'], 'enroll-l1-c1');
});

test('4xx surfaces as CoreRequestError with the problem body, no retry', async () => {
  const { client, calls } = clientWith([jsonRes(404, { title: 'course not found' })]);
  await assert.rejects(client.getCourse('nope'), e =>
    e instanceof CoreRequestError && e.status === 404 && e.problem.title === 'course not found');
  assert.equal(calls.length, 1);
});

test('network failure degrades to CoreUnavailableError, not a stack trace', async () => {
  const { client } = clientWith([new Error('ECONNREFUSED')]);
  await assert.rejects(client.staleContent(), CoreUnavailableError);
});

test('circuit breaker opens after consecutive failures and rejects fast', async () => {
  const { client, calls } = clientWith([new Error('down')]);
  for (let i = 0; i < 2; i++) await client.listCourses().catch(() => {});
  // 2 calls × 3 attempts = 6 failures ≥ threshold 5 → open
  await assert.rejects(client.getCourse('x'), CoreUnavailableError);
  const before = calls.length;
  await client.getCourse('y').catch(() => {});
  assert.equal(calls.length, before, 'open breaker must not hit the network');
});

test('the api key travels as a Bearer header and nowhere else', async () => {
  const { client, calls } = clientWith([jsonRes(200, {})]);
  await client.listCourses();
  assert.equal(calls[0].opts.headers.authorization, 'Bearer k_test');
  assert.ok(!calls[0].url.includes('k_test'));
});
