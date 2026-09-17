// SPEC TEST 12: a learner whose email changes keeps the same external_ref and
// credential. The external_ref is frozen by a database trigger; the Core knows
// the learner only by it; the public verification of the credential is
// unchanged before and after the change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { createLearningService, ProfileError } from '../src/lib/learning.mjs';
import { grantEntitlement } from '../src/lib/entitlements.mjs';
import { resolveVerification } from '../src/lib/verify.mjs';

let db, app, user, svc, core;
const COURSE = '11111111-1111-4111-8111-111111111111';
const ASSESS = '44444444-4444-4444-8444-444444444444';
const REF = 'LC-KEEP-ME-0001';

function fakeCore() {
  const learners = new Map(); // external_ref -> { id, display_name }
  let attempts = 0;
  const state = { learners, upserts: 0 };
  return {
    state,
    upsertLearner: async ({ externalRef, displayName }) => {
      state.upserts++;
      const existing = learners.get(externalRef);
      const rec = existing ? { ...existing, display_name: displayName } : { id: `aaaaaaaa-0000-4000-8000-00000000000${learners.size + 1}`, display_name: displayName };
      learners.set(externalRef, rec);
      return { id: rec.id, external_ref: externalRef, display_name: displayName };
    },
    listSchemes: async () => ({ items: [{ id: 's1', ranks: [{ id: 'r3', name: 'Orange', position: 3, meta: { fill: '#CC6B2C' } }] }] }),
    getCourse: async id => ({ id, title: 'NC-ORG-001', rank_id: 'r3', modules: [], lessons: [], assessments: [] }),
    enroll: async () => ({ id: 'bbbbbbbb-0000-4000-8000-000000000001' }),
    getEnrollment: async id => ({ enrollment_id: id, lessons_total: 0, lessons_completed: 0, percent_complete: 100, complete: true, completed_lesson_ids: [] }),
    getAssessment: async id => ({ id, course_id: COURSE, title: 'Final', pass_percent: 80, items: [{ id: 'i1', kind: 'single', points: 1, prompt: [], options: [] }] }),
    startAttempt: async () => ({ id: `cccccccc-0000-4000-8000-00000000000${++attempts}` }),
    answerAttempt: async () => ({ ok: true }),
    submitAttempt: async id => ({ attempt_id: id, status: 'scored', score_percent: 100, passed: true, items: [] }),
    issueCredential: async () => ({ id: 'dddddddd-0000-4000-8000-000000000001', public_ref: REF }),
    verifyCredential: async ref => (ref === REF
      ? { public_ref: REF, status: 'valid', issued_at: '2026-09-17T00:00:00Z', learner_name: learners.get('reli_KEEPREF0001')?.display_name, course_title: 'NC-ORG-001', issuer: 'RELI', rank_name: 'Orange', competencies: [] }
      : null),
  };
}

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  user = (await app.query(`insert into app_user (external_ref, email, display_name) values ('reli_KEEPREF0001', 'old@example.org', 'Old Name')
    returning id, external_ref, email, display_name, status`)).rows[0];
  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-ORG-001', $1, 'NC', 'orange', 19900)`, [COURSE]);
  await grantEntitlement(app, { userId: user.id, key: 'course:NC-ORG-001', source: 'comp:test' });
  core = fakeCore();
  svc = createLearningService({ db: app, core });
});
after(async () => { await app.end(); await db.stop(); });

test('SPEC TEST 12: a learner whose email changes keeps the same external_ref, Core learner id and credential; verify still resolves', async () => {
  const { attempt } = await svc.startAssessment(user, ASSESS);
  const { credential } = await svc.submitAssessment(user, attempt.id, [{ item_id: 'i1', response: ['a'] }]);
  assert.equal(credential.public_ref, REF);
  const before = (await app.query('select u.external_ref, l.core_learner_id from app_user u join learner_link l on l.user_id = u.id where u.id = $1', [user.id])).rows[0];
  const v1 = await resolveVerification({ core, db: app, ref: REF });
  assert.equal(v1.state, 'valid');

  const updated = await svc.updateProfile(user, { email: 'New.Address@Example.org', displayName: 'New Name' });
  assert.equal(updated.email, 'new.address@example.org');
  assert.equal(updated.external_ref, before.external_ref, 'external_ref unchanged');

  const after = (await app.query('select u.external_ref, u.email, l.core_learner_id from app_user u join learner_link l on l.user_id = u.id where u.id = $1', [user.id])).rows[0];
  assert.equal(after.external_ref, before.external_ref);
  assert.equal(after.core_learner_id, before.core_learner_id, 'same Core learner');
  assert.equal(core.state.learners.size, 1, 'no second learner was created in the Core');
  assert.equal(core.state.learners.get(before.external_ref).display_name, 'New Name', 'the Core follows the name through the same external_ref');

  const creds = await app.query('select public_ref from credential_link where user_id = $1', [user.id]);
  assert.deepEqual(creds.rows, [{ public_ref: REF }]);
  const v2 = await resolveVerification({ core, db: app, ref: REF });
  assert.equal(v2.state, 'valid');
  assert.equal(v2.record.holder, 'New Name');
  assert.equal(v2.record.publicRef, REF);

  // the external_ref is unchangeable by anyone at the database level
  await assert.rejects(() => app.query(`update app_user set external_ref = 'reli_SOMETHINGELSE' where id = $1`, [user.id]), /permanent/);
  const adminPool = new pg.Pool({ connectionString: db.adminUrl });
  await assert.rejects(() => adminPool.query(`update app_user set external_ref = 'reli_SOMETHINGELSE' where id = $1`, [user.id]), /permanent/);
  await adminPool.end();
});

test('SPEC TEST 12: an email already in use, or an invalid one, is refused without touching identity', async () => {
  await app.query(`insert into app_user (external_ref, email, display_name) values ('reli_OTHER00002', 'taken@example.org', 'Taken')`);
  await assert.rejects(() => svc.updateProfile({ ...user, email: 'new.address@example.org', display_name: 'New Name' }, { email: 'taken@example.org' }), ProfileError);
  await assert.rejects(() => svc.updateProfile(user, { email: 'not-an-email' }), ProfileError);
  const row = (await app.query('select external_ref, email from app_user where id = $1', [user.id])).rows[0];
  assert.equal(row.external_ref, 'reli_KEEPREF0001');
  assert.equal(row.email, 'new.address@example.org');
});
