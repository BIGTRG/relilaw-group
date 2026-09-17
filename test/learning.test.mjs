// Learning service (M2): the seam between app users and the Core.
// Runs on embedded Postgres as reli_app with a scripted fake Core, so the
// entitlement gate, the id links and the credential recording are exercised
// without network. The Core's own behaviour is covered by its own suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { createLearningService, NotEntitledError } from '../src/lib/learning.mjs';
import { grantEntitlement } from '../src/lib/entitlements.mjs';

let db, app, admin, user, svc, core;
const COURSE = '11111111-1111-4111-8111-111111111111';
const LESSON_A = '22222222-2222-4222-8222-222222222222';
const LESSON_B = '33333333-3333-4333-8333-333333333333';
const ASSESS = '44444444-4444-4444-8444-444444444444';

function fakeCore() {
  const state = { learners: 0, enrolls: 0, completed: new Set(), attempts: new Map(), creds: 0, calls: [] };
  const rec = (m, p) => state.calls.push(`${m} ${p}`);
  return {
    state,
    upsertLearner: async ({ externalRef }) => { rec('POST', '/v1/learners'); state.learners++; return { id: 'aaaaaaaa-0000-4000-8000-000000000001', external_ref: externalRef }; },
    listSchemes: async () => ({ items: [{ id: 's1', name: 'Ladder', ranks: [
      { id: 'r1', name: 'White', position: 1, meta: { fill: '#D8DCE0' } }, { id: 'r3', name: 'Orange', position: 3, meta: { fill: '#CC6B2C' } }] }] }),
    getCourse: async id => ({ id, title: 'Sample', summary: '', rank_id: 'r3', status: 'published',
      modules: [{ id: 'm1', title: 'M1', position: 1 }],
      lessons: [{ id: LESSON_A, module_id: 'm1', title: 'A', position: 1, status: 'published' }, { id: LESSON_B, module_id: 'm1', title: 'B', position: 2, status: 'published' }],
      assessments: [{ id: ASSESS, title: 'Final', pass_percent: 80, status: 'published' }] }),
    getLesson: async id => ({ id, course_id: COURSE, title: id === LESSON_A ? 'A' : 'B', status: 'published', blocks: [], citations: [] }),
    enroll: async () => { rec('POST', '/v1/enrollments'); state.enrolls++; return { id: 'bbbbbbbb-0000-4000-8000-000000000001' }; },
    getEnrollment: async id => ({ enrollment_id: id, lessons_total: 2, lessons_completed: state.completed.size,
      percent_complete: state.completed.size * 50, complete: state.completed.size === 2, completed_lesson_ids: [...state.completed] }),
    completeLesson: async ({ lessonId }) => { state.completed.add(lessonId); return { ok: true }; },
    getAssessment: async id => ({ id, course_id: COURSE, title: 'Final', pass_percent: 80, items: [{ id: 'i1', kind: 'single', prompt: [], options: [], points: 1 }] }),
    startAttempt: async () => { const id = `cccccccc-0000-4000-8000-00000000000${state.attempts.size + 1}`; state.attempts.set(id, 'in_progress'); return { id }; },
    answerAttempt: async () => ({ ok: true }),
    submitAttempt: async id => { state.attempts.set(id, 'scored'); return { attempt_id: id, status: 'scored', score_percent: 100, passed: true, items: [{ item_id: 'i1', points: 1, points_awarded: 1 }] }; },
    issueCredential: async () => { state.creds++; return { id: 'dddddddd-0000-4000-8000-000000000001', public_ref: 'LC-TEST-REF1' }; },
    getAttempt: async id => ({ id, status: state.attempts.get(id), passed: true, score_percent: 100, items: [] }),
  };
}

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  admin = new pg.Pool({ connectionString: db.adminUrl });
  const u = await app.query(
    `insert into app_user (external_ref, email, display_name) values ('reli_TESTLEARNER01', 'l@example.org', 'Test Learner') returning id, external_ref, display_name`);
  user = u.rows[0];
  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-TEST-001', $1, 'Sample', 'orange', 19900)`, [COURSE]);
  core = fakeCore();
  svc = createLearningService({ db: app, core });
});
after(async () => { await app.end(); await admin.end(); await db.stop(); });

test('catalogue shows the product locked until an entitlement exists; enrollment is refused without one', async () => {
  const cat = await svc.catalogue(user);
  assert.equal(cat.length, 1);
  assert.equal(cat[0].entitled, false);
  await assert.rejects(() => svc.courseView(user, COURSE), NotEntitledError);
  assert.equal(core.state.enrolls, 0, 'no Core enrollment may be created for an unentitled user');
});

test('after a grant: one Core learner, one Core enrollment, both linked and idempotent', async () => {
  await grantEntitlement(app, { userId: user.id, key: 'course:NC-TEST-001', source: 'test' });
  const v1 = await svc.courseView(user, COURSE);
  const v2 = await svc.courseView(user, COURSE);
  assert.equal(v1.enrollmentId, v2.enrollmentId);
  assert.equal(core.state.learners, 1);
  assert.equal(core.state.enrolls, 1);
  const links = await app.query('select count(*)::int as n from enrollment_link where user_id = $1', [user.id]);
  assert.equal(links.rows[0].n, 1);
  assert.equal(v1.next.id, LESSON_A);
  assert.equal(v1.assessment.id, ASSESS);
});

test('lesson view orders prev/next and completion flows through the Core, never asserted locally', async () => {
  const a = await svc.lessonView(user, LESSON_A);
  assert.equal(a.prev, null); assert.equal(a.next.id, LESSON_B); assert.equal(a.done, false);
  await svc.completeLesson(user, LESSON_A);
  const b = await svc.lessonView(user, LESSON_B);
  assert.equal(b.prev.id, LESSON_A); assert.equal(b.next, null);
  const again = await svc.lessonView(user, LESSON_A);
  assert.equal(again.done, true);
  await svc.completeLesson(user, LESSON_B);
  assert.equal((await svc.courseView(user, COURSE)).progress.complete, true);
});

test('assessment: attempt is linked to its owner; a pass records the credential ref; others cannot read it', async () => {
  const { attempt } = await svc.startAssessment(user, ASSESS);
  const { result, credential } = await svc.submitAssessment(user, attempt.id, [{ item_id: 'i1', response: ['b'] }]);
  assert.equal(result.passed, true);
  assert.equal(credential.public_ref, 'LC-TEST-REF1');
  const cl = await app.query('select public_ref, core_course_id from credential_link where user_id = $1', [user.id]);
  assert.equal(cl.rows[0].public_ref, 'LC-TEST-REF1');
  assert.equal(cl.rows[0].core_course_id, COURSE);
  const other = (await app.query(
    `insert into app_user (external_ref, email, display_name) values ('reli_OTHER0001', 'o@example.org', 'Other') returning id, external_ref, display_name`)).rows[0];
  await assert.rejects(() => svc.attemptView(other, attempt.id), NotEntitledError);
  const view = await svc.attemptView(user, attempt.id);
  assert.equal(view.credentialRef, 'LC-TEST-REF1');
});

test('home: current rank comes from the Core rank on the credentialed course; degraded Core yields a legible state', async () => {
  const home = await svc.home(user);
  assert.equal(home.degraded, false);
  assert.equal(home.currentOrder, 3, 'Orange (position 3) after the credential');
  assert.deepEqual(home.ranks.map(r => r.color), ['#D8DCE0', '#CC6B2C']);
  const { CoreUnavailableError } = await import('../src/lib/core-client.mjs');
  const broken = createLearningService({ db: app, core: { ...core, listSchemes: async () => { throw new CoreUnavailableError(new Error('down')); } } });
  const h2 = await broken.home(user);
  assert.equal(h2.degraded, true);
});

test('no learning table is ever written by anyone but reli_app paths; auditor is read-only', async () => {
  const auditor = new pg.Pool({ connectionString: db.auditorUrl });
  await assert.rejects(() => auditor.query(`insert into learner_link (user_id, core_learner_id) values ($1, gen_random_uuid())`, [user.id]));
  const r = await auditor.query('select count(*)::int as n from enrollment_link');
  assert.equal(r.rows[0].n, 1);
  await auditor.end();
});
