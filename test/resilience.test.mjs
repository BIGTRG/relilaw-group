// SPEC TEST 13: the app degrades legibly when the Core is unreachable — Dojo,
// Library, lesson, course, result and public verify each render a
// design-system callout (HTTP 200 or 503 with a page), no stack trace, no
// blank screen, and verify says "cannot verify right now" rather than a false
// valid or not-found.
// Also the HTTP half of SPEC TEST 8: after the entitlement is revoked, the real
// learner routes deny the very next request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, signUp, grantCourse } from './helpers/e2e.mjs';

let stack, learner, cookie, courseId, lessonId, resultPath, verifyPath;

const get = (path, extra = {}) => fetch(`${stack.base}${path}`, { redirect: 'manual', headers: { cookie, accept: 'text/html', ...extra } });
const post = (path, form) => fetch(`${stack.base}${path}`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(form),
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' } });

before(async () => {
  stack = await startStack();
  learner = await signUp(stack, { email: 'resilient@e2e.test', displayName: 'Rae Silient' });
  cookie = learner.cookie;
  await grantCourse(stack, learner.user.id);
  courseId = stack.core.ids.course;
  lessonId = stack.core.ids.lessonA;
  // walk the loop over HTTP so there is a result and a credential to show
  await post('/api/learn/complete', { lessonId: stack.core.ids.lessonA, next: '/' });
  await post('/api/learn/complete', { lessonId: stack.core.ids.lessonB, next: '/' });
  const started = await post('/api/learn/attempts', { assessmentId: stack.core.ids.assessment });
  const assessPath = started.headers.get('location');
  assert.match(assessPath, /^\/assess\//);
  const attemptId = assessPath.split('/').pop();
  const submitted = await post(`/api/learn/attempts/${attemptId}/submit`, {
    [`item:${stack.core.ids.itemC}`]: 'The employer needs a written authorization signed by the cashier that states the reason, signed on or before payday. A general acknowledgment at hire is not enough. The employee must get advance written notice of the actual amount and notice of the right to withdraw the authorization. For a shortage the employer has to give 7 days written notice of the amount before the payday. Because it is an overtime week the deduction can only bring pay down to minimum wage for the 40 regular hours and cannot touch the 6 overtime hours.',
    [`item:${stack.core.ids.itemS}`]: 'a',
  });
  resultPath = submitted.headers.get('location');
  assert.match(resultPath, /^\/results\//);
  const ref = (await stack.app.query('select public_ref from credential_link where user_id = $1', [learner.user.id])).rows[0]?.public_ref;
  assert.ok(ref, 'the loop produced a credential');
  verifyPath = `/verify/${ref}`;
}, { timeout: 180_000 });
after(async () => { await stack?.stop(); });

function legible(html, where) {
  assert.ok(html.length > 2000, `${where}: not a blank page`);
  assert.ok(!/at .+\.m?js:\d+|Unhandled Runtime Error|CoreUnavailableError|ECONNREFUSED|ECONNRESET|socket hang up/i.test(html), `${where}: no stack trace or raw error leaks`);
  assert.ok(/callout/.test(html) && /data-degraded="core"/.test(html), `${where}: a design-system callout carries the degraded state`);
  assert.ok(/role="status"/.test(html), `${where}: the state is announced to assistive tech`);
}

test('SPEC TEST 13: with the Core unreachable, Dojo, Library, course, lesson and result render a legible degraded state (200 or 503, callout, no stack trace)', { timeout: 120_000 }, async () => {
  // a healthy baseline first
  const okHome = await get('/');
  assert.equal(okHome.status, 200);
  assert.ok(!/data-degraded/.test(await okHome.text()), 'no degraded callout while the Core is up');

  stack.core.down();
  const pages = [['Dojo', '/'], ['Course', `/courses/${courseId}`], ['Lesson player', `/lessons/${lessonId}`], ['Result', resultPath]];
  for (const [name, path] of pages) {
    const res = await get(path);
    assert.ok([200, 503].includes(res.status), `${name}: status ${res.status}`);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    legible(await res.text(), name);
  }
  // The Library is app data; it still lists what the learner holds. Either a
  // normal page or a degraded callout is acceptable, never an error page.
  const lib = await get('/library');
  assert.equal(lib.status, 200);
  const libHtml = await lib.text();
  assert.ok(/Owned|data-degraded="core"/.test(libHtml), 'Library renders the owned course or the degraded callout');
  assert.ok(!/CoreUnavailableError|ECONNRESET/.test(libHtml));

  // form posts degrade to a redirect with a notice, not a 500
  const complete = await post('/api/learn/complete', { lessonId, next: '/' });
  assert.equal(complete.status, 303);
  assert.equal(complete.headers.get('location'), '/?paused=1');
  const paused = await get('/?paused=1');
  legible(await paused.text(), 'Dojo after a paused action');
});

test('SPEC TEST 13: public verify with the Core unreachable says it cannot verify right now, never valid, never not-found', { timeout: 60_000 }, async () => {
  stack.core.down();
  const res = await fetch(`${stack.base}${verifyPath}`, { redirect: 'manual' });
  assert.ok([200, 503].includes(res.status), `status ${res.status}`);
  const html = await res.text();
  assert.match(html, /cannot verify this credential right now/i);
  assert.match(html, /Cannot verify right now/);
  assert.ok(!/This credential is valid/.test(html), 'no false valid');
  assert.ok(!/No credential matches/.test(html), 'no false not-found');
  assert.ok(!/has been revoked/.test(html), 'no false revoked');
  legible(html, 'Verify');
  // an unknown reference while the Core is down is also "cannot verify", not "no match"
  const unknown = await (await fetch(`${stack.base}/verify/LC-NOPE-0000-NONE`, { redirect: 'manual' })).text();
  assert.ok(!/No credential matches/.test(unknown));
  assert.match(unknown, /Cannot verify right now/);
});

test('SPEC TEST 13: when the Core returns, the pages recover without a restart', { timeout: 60_000 }, async () => {
  stack.core.up();
  // the client breaker holds open for up to 15s after a burst of failures
  const t0 = Date.now();
  let html = '';
  while (Date.now() - t0 < 25_000) {
    html = await (await fetch(`${stack.base}${verifyPath}`)).text();
    if (/This credential is valid/.test(html)) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.match(html, /This credential is valid/);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.ok(!/data-degraded/.test(await home.text()));
});

test('SPEC TEST 8 (HTTP): after the entitlement is revoked, the next request to the real learner routes is denied and the Library offers the course for purchase again', { timeout: 60_000 }, async () => {
  const before = await get(`/courses/${courseId}`);
  assert.equal(before.status, 200);
  assert.doesNotMatch(await before.text(), /not in your library/);

  const { revokeEntitlement } = await import('../src/lib/entitlements.mjs');
  const { rows } = await stack.app.query(`select id from entitlement where user_id = $1 and key = 'course:NC-ORG-001' and revoked_at is null`, [learner.user.id]);
  assert.equal(rows.length, 1);
  // The one revocation path (the refund webhook calls exactly this). It also
  // drops the entitlement cache entry, so the NEXT request sees the change.
  const Redis = (await import('ioredis')).default;
  const redis = new Redis(stack.redis.url, { maxRetriesPerRequest: 2 });
  await revokeEntitlement(stack.app, redis, { userId: learner.user.id, key: 'course:NC-ORG-001', reason: 'refund:e2e' });
  redis.disconnect();

  const course = await get(`/courses/${courseId}`);
  assert.equal(course.status, 200);
  assert.match(await course.text(), /not in your library/);
  const lesson = await get(`/lessons/${lessonId}`);
  assert.equal(lesson.status, 404, 'a lesson of a course no longer held is not found');
  const complete = await post('/api/learn/complete', { lessonId, next: '/' });
  assert.equal(complete.status, 303);
  assert.equal(complete.headers.get('location'), '/library');
  const attempt = await post('/api/learn/attempts', { assessmentId: stack.core.ids.assessment });
  assert.equal(attempt.headers.get('location'), '/library');
  const lib = await (await get('/library')).text();
  assert.match(lib, /aria-label="Buy /);
  assert.doesNotMatch(lib, /badge-ok">Owned/);
});
