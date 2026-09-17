// Learning Core client (§1). SERVER ONLY — the Next wrapper imports the
// `server-only` package; the CI grep test independently asserts this module
// and the key never reach a client bundle.
// - The API key is a server secret from env. It never appears in a client
//   bundle (CI test 6) and never in logs.
// - The Core is a remote service that can fail: timeouts, bounded retries
//   with backoff on idempotent reads, a circuit breaker, and a typed
//   CoreUnavailableError the UI renders as a legible degraded state (test 13).
// - Every POST carries an Idempotency-Key (Core convention).

import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';

const TIMEOUT_MS = 5_000;
const READ_RETRIES = 2;           // idempotent GETs only
const BREAKER_THRESHOLD = 5;      // consecutive failures to open
const BREAKER_COOLDOWN_MS = 15_000;

export class CoreUnavailableError extends Error {
  constructor(cause) {
    super('learning core unavailable');
    this.name = 'CoreUnavailableError';
    this.cause = cause;
  }
}

export class CoreRequestError extends Error {
  constructor(status, problem) {
    super(`core responded ${status}: ${problem?.title ?? 'error'}`);
    this.name = 'CoreRequestError';
    this.status = status;
    this.problem = problem; // RFC 9457 body
  }
}

/** Join base + path so a base WITH a path prefix (the GE API Engine mounts the
 *  Core at /v1/learningcore/) is preserved. `new URL('/v1/x', base)` would
 *  drop the prefix. */
export function joinUrl(baseUrl, path) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return new URL(path.replace(/^\/+/, ''), base);
}

/** Mint the permanent opaque learner identifier. Never an email. Never reused. */
export function mintExternalRef() {
  return `reli_${ulid()}`;
}

export function createCoreClient({
  baseUrl = process.env.CORE_BASE_URL,
  apiKey = process.env.CORE_API_KEY,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (!baseUrl || !apiKey) throw new Error('CORE_BASE_URL and CORE_API_KEY are required');

  let consecutiveFailures = 0;
  let openedAt = 0;

  function breakerOpen() {
    if (consecutiveFailures < BREAKER_THRESHOLD) return false;
    if (now() - openedAt > BREAKER_COOLDOWN_MS) return false; // half-open: allow a probe
    return true;
  }

  async function request(method, path, { body, idempotencyKey } = {}) {
    if (breakerOpen()) throw new CoreUnavailableError(new Error('circuit open'));

    const isRead = method === 'GET';
    const attempts = isRead ? 1 + READ_RETRIES : 1;
    let lastErr;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 250 * 2 ** (attempt - 1)));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        const headers = {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
        };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (!isRead) headers['idempotency-key'] = idempotencyKey ?? randomUUID();

        const res = await fetchImpl(joinUrl(baseUrl, path), {
          method, headers, signal: ac.signal,
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (res.status >= 500) {
          lastErr = new CoreRequestError(res.status, await res.json().catch(() => null));
          consecutiveFailures++; if (consecutiveFailures === BREAKER_THRESHOLD) openedAt = now();
          continue; // retry reads; single attempt for writes falls through
        }
        consecutiveFailures = 0;
        if (!res.ok) throw new CoreRequestError(res.status, await res.json().catch(() => null));
        if (res.status === 204) return null;
        return await res.json();
      } catch (e) {
        if (e instanceof CoreRequestError) throw e; // 4xx: caller's problem, no retry
        lastErr = e;
        consecutiveFailures++; if (consecutiveFailures === BREAKER_THRESHOLD) openedAt = now();
      } finally {
        clearTimeout(timer);
      }
    }
    throw new CoreUnavailableError(lastErr);
  }

  return {
    // learners
    upsertLearner: ({ externalRef, displayName }) =>
      request('POST', '/v1/learners', {
        body: { external_ref: externalRef, display_name: displayName },
        idempotencyKey: `learner-${externalRef}`,
      }),
    // catalogue & content
    listCourses: () => request('GET', '/v1/courses'),
    getCourse: id => request('GET', `/v1/courses/${id}`),
    getLesson: id => request('GET', `/v1/lessons/${id}`),
    listSchemes: () => request('GET', '/v1/schemes'),
    getAssessment: id => request('GET', `/v1/assessments/${id}`),
    getAttempt: id => request('GET', `/v1/attempts/${id}`),
    staleContent: (days = 180) => request('GET', `/v1/content/stale?days=${days}`),
    // enrolment & progress
    enroll: ({ learnerId, courseId }) =>
      request('POST', '/v1/enrollments', {
        body: { learner_id: learnerId, course_id: courseId },
        idempotencyKey: `enroll-${learnerId}-${courseId}`,
      }),
    getEnrollment: id => request('GET', `/v1/enrollments/${id}`),
    completeLesson: ({ enrollmentId, lessonId }) =>
      request('POST', `/v1/enrollments/${enrollmentId}/lessons/${lessonId}/complete`),
    // assessment
    startAttempt: ({ enrollmentId, assessmentId }) =>
      request('POST', '/v1/attempts', { body: { enrollment_id: enrollmentId, assessment_id: assessmentId } }),
    answerAttempt: ({ attemptId, answers }) =>
      request('POST', `/v1/attempts/${attemptId}/answers`, { body: { answers } }),
    submitAttempt: id => request('POST', `/v1/attempts/${id}/submit`),
    // grading (admin scope on the tenant key; the answer key is read here on
    // the server and never leaves it)
    getAnswerKey: assessmentId => request('GET', `/v1/assessments/${assessmentId}/answer-key`),
    gradeAttempt: ({ attemptId, grades }) =>
      request('POST', `/v1/attempts/${attemptId}/grade`, { body: { grades }, idempotencyKey: `grade-${attemptId}` }),
    // credentials
    issueCredential: attemptId =>
      request('POST', '/v1/credentials', { body: { attempt_id: attemptId }, idempotencyKey: `cred-${attemptId}` }),
    verifyCredential: ref => request('GET', `/v1/verify/${encodeURIComponent(ref)}`), // public endpoint, still server-side
    _internals: { request }, // for tests
  };
}
