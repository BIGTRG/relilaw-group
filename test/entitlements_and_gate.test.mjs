import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { hasEntitlement, grantEntitlement, revokeEntitlement } from '../src/lib/entitlements.mjs';

let db, appPool, legalPool, auditorPool, adminPool, userId, legalUserId;

before(async () => {
  db = await startTestDb();
  adminPool = new pg.Pool({ connectionString: db.adminUrl });
  appPool = new pg.Pool({ connectionString: db.appUrl });
  legalPool = new pg.Pool({ connectionString: db.legalUrl });
  auditorPool = new pg.Pool({ connectionString: db.auditorUrl });

  const u = await appPool.query(
    `insert into app_user (external_ref, email, display_name)
     values ('reli_01TESTUSER', 'maria@example.com', 'Maria Alvarez') returning id`);
  userId = u.rows[0].id;
  const l = await appPool.query(
    `insert into app_user (external_ref, email, display_name)
     values ('reli_01TESTLEGAL', 'counsel@example.com', 'Counsel') returning id`);
  legalUserId = l.rows[0].id;
}, { timeout: 180_000 });

after(async () => {
  for (const p of [appPool, legalPool, auditorPool, adminPool]) await p?.end();
  await db?.stop();
});

test('entitlement: absent → granted → present; duplicate grant is a no-op', async () => {
  const key = 'course:NC-ORG-001';
  assert.equal(await hasEntitlement(appPool, userId, key), false);

  const first = await grantEntitlement(appPool, { userId, key, source: 'purchase:evt_test_1' });
  assert.ok(first);
  // The same webhook delivered twice grants exactly one entitlement (spec test 7).
  const dup = await grantEntitlement(appPool, { userId, key, source: 'purchase:evt_test_1' });
  assert.equal(dup, null);

  const { rowCount } = await appPool.query(
    `select 1 from entitlement where user_id=$1 and key=$2 and revoked_at is null`, [userId, key]);
  assert.equal(rowCount, 1);
  assert.equal(await hasEntitlement(appPool, userId, key), true);
});

test('revocation removes access on the next check (spec test 8)', async () => {
  const key = 'course:NC-ORG-001';
  await revokeEntitlement(appPool, null, { userId, key, reason: 'refund' });
  assert.equal(await hasEntitlement(appPool, userId, key), false);
});

test('expired entitlements do not grant access', async () => {
  const key = 'course:EXPIRED';
  await appPool.query(
    `insert into entitlement (user_id, key, source, expires_at)
     values ($1, $2, 'promo:test', now() - interval '1 day')`, [userId, key]);
  assert.equal(await hasEntitlement(appPool, userId, key), false);
});

test('GATE: the application role cannot write publish_signoff by any SQL', async () => {
  await assert.rejects(
    appPool.query(
      `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id)
       values ('NC-ORG-001', 'v1', $1)`, [legalUserId]),
    /permission denied/i,
  );
  // and no sneaky write via CTE either
  await assert.rejects(
    appPool.query(
      `with x as (insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id)
       values ('NC-ORG-001','v1',$1) returning id) select * from x`, [legalUserId]),
    /permission denied/i,
  );
});

test('GATE: the legal role signs off in one recorded action; sign-off is immutable', async () => {
  // Migration 003: a sign-off must point at a version that is in legal review.
  const { rows: vr } = await appPool.query(
    `insert into content_version (core_course_ref, core_version_ref, created_by) values ('NC-ORG-001', 'v1', $1) returning id`, [legalUserId]);
  for (const [from, to] of [['draft', 'sme_review'], ['sme_review', 'legal_review']]) {
    await appPool.query(`insert into pipeline_transition (version_id, from_state, to_state, actor_user_id, actor_role) values ($1, $2, $3, $4, 'legal')`, [vr[0].id, from, to, legalUserId]);
    await appPool.query(`update content_version set state = $2 where id = $1`, [vr[0].id, to]);
  }
  const { rows } = await legalPool.query(
    `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id, note)
     values ('NC-ORG-001', 'v1', $1, 'reviewed 8 items') returning id, signed_at`, [legalUserId]);
  assert.ok(rows[0].id);
  // immutable for legal and app alike
  await assert.rejects(
    legalPool.query(`update publish_signoff set note='edited' where id=$1`, [rows[0].id]),
    /permission denied/i);
  await assert.rejects(
    legalPool.query(`delete from publish_signoff where id=$1`, [rows[0].id]),
    /permission denied/i);
});

test('auditor role cannot write anywhere (spec test 4)', async () => {
  await assert.rejects(
    auditorPool.query(`insert into audit_event (action) values ('x')`), /permission denied/i);
  await assert.rejects(
    auditorPool.query(`update app_user set display_name='x' where id=$1`, [userId]),
    /permission denied/i);
  const r = await auditorPool.query('select count(*)::int as n from app_user');
  assert.ok(r.rows[0].n >= 2); // but reads work
});

test('audit_event is append-only for the app role', async () => {
  await appPool.query(`insert into audit_event (action, actor_user_id) values ('test', $1)`, [userId]);
  await assert.rejects(appPool.query(`update audit_event set action='tampered'`), /permission denied/i);
  await assert.rejects(appPool.query(`delete from audit_event`), /permission denied/i);
});

test('external_ref is frozen: email may change, the ref may not (spec test 12)', async () => {
  await appPool.query(`update app_user set email='maria.new@example.com' where id=$1`, [userId]);
  await assert.rejects(
    appPool.query(`update app_user set external_ref='reli_SOMETHINGELSE' where id=$1`, [userId]),
    /permanent/);
  const { rows } = await appPool.query(`select external_ref, email from app_user where id=$1`, [userId]);
  assert.equal(rows[0].external_ref, 'reli_01TESTUSER');
  assert.equal(rows[0].email, 'maria.new@example.com');
});

test('no application role is superuser or bypasses RLS (Core lesson #1)', async () => {
  const { rows } = await adminPool.query(
    `select rolname from pg_roles
      where rolname like 'reli_%' and (rolsuper or rolbypassrls)`);
  assert.deepEqual(rows, []);
});
