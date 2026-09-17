// Console modules. Spec test 3 (org admin cannot reach attempt detail by any
// route, including a crafted request) and spec test 4 (an auditor session
// cannot write anywhere), plus pricing audit and the billing ledger.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { createRedisStub } from './helpers/redis_stub.mjs';
import { createSessionStore } from '../src/lib/session.mjs';
import { authorizeDoor, authorizeAction, connFor } from '../src/lib/console-auth.mjs';
import {
  complianceReport, complianceMembers, COMPLIANCE_SQL, COMPLIANCE_MEMBERS_SQL, COMPLIANCE_FORBIDDEN_FIELDS,
  listProducts, updatePrice, billingLedger, staleContent,
} from '../src/lib/console.mjs';
import { createConsoleHandlers } from '../src/lib/console-routes.mjs';
import { createPipelineHandlers } from '../src/lib/pipeline-routes.mjs';
import { createPipeline } from '../src/lib/pipeline.mjs';
import { createLearningService } from '../src/lib/learning.mjs';
import { revokeCredential } from '../src/lib/registry.mjs';

let db, app, auditor, pools, orgId, orgAdmin, employee, staff, auditorUser, handlers;
const COURSE = '2a7eff5b-0000-4000-8000-000000000001';
const ATTEMPT = 'aaaaaaaa-1111-4111-8111-111111111111';

const user = async (ref, email, name) => (await app.query(
  `insert into app_user (external_ref, email, display_name) values ($1, $2, $3) returning id`, [ref, email, name])).rows[0].id;

const jsonPost = (path, body) => new Request(`https://admin.example.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
});

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  auditor = new pg.Pool({ connectionString: db.auditorUrl });
  pools = { app, auditor };

  orgId = (await app.query(`insert into org (name) values ('Acme Staffing') returning id`)).rows[0].id;
  orgAdmin = await user('reli_ORGADMIN01', 'boss@acme.test', 'Olive Orgadmin');
  employee = await user('reli_EMPLOYEE01', 'emp@acme.test', 'Eli Employee');
  staff = await user('reli_STAFF00002', 'staff2@example.org', 'Sam Staff');
  auditorUser = await user('reli_AUDITOR001', 'audit@example.org', 'Ada Auditor');
  await app.query(`insert into role_grant (user_id, role, org_id) values ($1, 'org_admin', $2), ($3, 'employee', $2)`, [orgAdmin, orgId, employee]);
  await app.query(`insert into role_grant (user_id, role) values ($1, 'staff'), ($2, 'auditor')`, [staff, auditorUser]);

  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-ORG-001', $1, 'NC Wage and Hour', 'orange', 19900)`, [COURSE]);
  // the employee enrolled, attempted, passed and holds a credential
  await app.query(`insert into enrollment_link (user_id, core_course_id, core_enrollment_id) values ($1, $2, 'bbbbbbbb-1111-4111-8111-111111111111')`, [employee, COURSE]);
  await app.query(`insert into attempt_link (core_attempt_id, user_id, core_enrollment_id, core_assessment_id) values ($1, $2, 'bbbbbbbb-1111-4111-8111-111111111111', 'cccccccc-1111-4111-8111-111111111111')`, [ATTEMPT, employee]);
  await app.query(`insert into credential_link (core_credential_id, user_id, core_course_id, public_ref) values ('dddddddd-1111-4111-8111-111111111111', $1, $2, 'RELI-TEST-0001')`, [employee, COURSE]);
  await app.query(`insert into stripe_event (id, type, payload, processed_at) values ('evt_test_1', 'checkout.session.completed', '{"data":{"object":{"id":"cs_1","amount_total":19900,"currency":"usd"}}}', now())`);
  await app.query(`insert into entitlement (user_id, key, source) values ($1, 'course:NC-ORG-001', 'seat:acme')`, [employee]);

  handlers = createConsoleHandlers({ pools });
}, { timeout: 180_000 });

after(async () => {
  for (const p of [app, auditor]) await p?.end();
  await db?.stop();
});

test('SPEC TEST 3: an org admin cannot reach attempt detail or question-level scores by any route', async () => {
  const orgSession = { userId: orgAdmin, roles: ['org_admin'], door: 'dojo', mfaVerified: false };

  // (a) the org admin cannot open a Console or Studio session at all
  const sessions = createSessionStore(createRedisStub());
  await assert.rejects(sessions.create({ userId: orgAdmin, roles: ['org_admin'], door: 'console', mfaVerified: true }), /cannot enter/);
  await assert.rejects(sessions.create({ userId: orgAdmin, roles: ['org_admin'], door: 'studio', mfaVerified: true }), /cannot enter/);
  assert.equal(authorizeDoor({ session: orgSession, door: 'console' }).status, 403);
  // crafted: an org_admin session object claiming the console door and MFA is still refused
  assert.equal(authorizeDoor({ session: { ...orgSession, door: 'console', mfaVerified: true }, door: 'console' }).status, 403);

  // (b) the compliance query is the only report path and it cannot see attempts
  for (const sql of [COMPLIANCE_SQL, COMPLIANCE_MEMBERS_SQL]) {
    assert.doesNotMatch(sql, /attempt/i);
    assert.doesNotMatch(sql, /score|answer|points/i);
  }
  const report = await complianceReport(app, { orgScope: orgId });
  assert.equal(report.length, 1);
  assert.equal(report[0].members, 2);
  assert.equal(report[0].completed, 1);
  const members = await complianceMembers(app, orgId);
  for (const row of [...report, ...members]) {
    for (const k of Object.keys(row)) assert.doesNotMatch(k, COMPLIANCE_FORBIDDEN_FIELDS, `field ${k} leaked`);
  }
  // scope: an org admin's view is pinned to their org; another org id yields nothing
  const other = (await app.query(`insert into org (name) values ('Other Co') returning id`)).rows[0].id;
  assert.equal((await complianceReport(app, { orgScope: other }))[0].members, 0);

  // (c) crafted request through the learner API: the org admin asks for the employee's attempt
  const learning = createLearningService({ db: app, core: { getAttempt: async () => { throw new Error('the Core must never be asked'); }, getAssessment: async () => ({}) } });
  await assert.rejects(learning.attemptView({ id: orgAdmin }, ATTEMPT), /not entitled: attempt/);
  await assert.rejects(learning.submitAssessment({ id: orgAdmin }, ATTEMPT, []), /not entitled: attempt/);

  // (d) crafted Console requests with the org admin's session are 403 before any query runs
  const pipeline = createPipeline({ db: app, legalUrl: db.legalUrl });
  const ph = createPipelineHandlers({ pipeline, door: 'console' });
  let res = await ph.board(new Request('https://admin.example.test/api/console/pipeline', { headers: { accept: 'application/json' } }), { session: { ...orgSession, door: 'console', mfaVerified: true } });
  assert.equal(res.status, 403);
  res = await handlers.updatePrice(jsonPost('/api/console/catalogue/price', { code: 'NC-ORG-001', priceCents: 1 }), { session: { ...orgSession, door: 'console', mfaVerified: true } });
  assert.equal(res.status, 403);
});

test('SPEC TEST 4: an auditor session cannot write anywhere in the system', async () => {
  const auditorSession = { userId: auditorUser, roles: ['auditor'], door: 'console', mfaVerified: true };
  const auth = authorizeDoor({ session: auditorSession, door: 'console' });
  assert.equal(auth.ok, true);
  assert.equal(auth.readOnly, true);
  // the session is bound to the reli_auditor pool
  assert.equal(connFor(auditorSession, pools), auditor);
  // every write capability is refused at the authorisation layer
  for (const cap of ['change_price_or_entitlement', 'revoke_credential', 'draft_content', 'publish_jurisdiction_content', 'assign_seats']) {
    assert.equal(authorizeAction({ session: auditorSession, door: 'console', capability: cap }).status, 403, cap);
  }
  // every write route is 403
  let res = await handlers.updatePrice(jsonPost('/api/console/catalogue/price', { code: 'NC-ORG-001', priceCents: 100 }), { session: auditorSession });
  assert.equal(res.status, 403);
  res = await handlers.revokeCredential(jsonPost('/api/console/registry/revoke', { credentialId: 'dddddddd-1111-4111-8111-111111111111', reason: 'x' }), { session: auditorSession });
  assert.equal(res.status, 403);
  const pipeline = createPipeline({ db: auditor, legalUrl: db.legalUrl });
  const ph = createPipelineHandlers({ pipeline, door: 'console' });
  res = await ph.createDraft(jsonPost('/api/console/pipeline/draft', { courseRef: 'NC-ORG-001', versionRef: 'v9' }), { session: auditorSession });
  assert.equal(res.status, 403);
  res = await ph.transition(jsonPost('/api/console/pipeline/transition', { versionId: '00000000-0000-4000-8000-000000000000', to: 'sme_review' }), { session: auditorSession });
  assert.equal(res.status, 403);
  // an auditor who also holds staff is not widened: the auditor role adds nothing, and
  // a pure auditor mixed in a crafted roles array with a fake role is still refused
  assert.equal(authorizeAction({ session: { ...auditorSession, roles: ['auditor', 'partner'] }, door: 'console', capability: 'change_price_or_entitlement' }).status, 403);

  // and the database role says no even if every line above were deleted
  const tables = (await auditor.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map(r => r.tablename);
  assert.ok(tables.length > 20);
  for (const t of tables) {
    await assert.rejects(auditor.query(`delete from ${t}`), /permission denied/i, `delete ${t}`);
  }
  await assert.rejects(auditor.query(`update product set price_cents = 1`), /permission denied/i);
  await assert.rejects(auditor.query(`insert into audit_event (action) values ('x')`), /permission denied/i);
  await assert.rejects(auditor.query(`insert into content_version (core_course_ref, core_version_ref) values ('X', 'v')`), /permission denied/i);
  await assert.rejects(updatePrice(auditor, { code: 'NC-ORG-001', priceCents: 1, actor: { userId: auditorUser, roles: ['auditor', 'staff'] } }), /permission denied/i);
  await assert.rejects(revokeCredential(auditor, { credentialId: 'dddddddd-1111-4111-8111-111111111111', reason: 'x', actor: { userId: auditorUser, roles: ['auditor', 'staff'] } }), /permission denied/i);
  // reads work, and the read models render for an auditor
  assert.equal((await listProducts(auditor)).length, 1);
  assert.equal((await complianceReport(auditor)).length >= 1, true);
  assert.equal((await billingLedger(auditor)).events.length, 1);
  assert.equal((await app.query(`select price_cents from product where code = 'NC-ORG-001'`)).rows[0].price_cents, 19900);
});

test('catalogue: staff changes a price and the change is audited with before and after', async () => {
  const staffSession = { userId: staff, roles: ['staff'], door: 'console', mfaVerified: true };
  const res = await handlers.updatePrice(jsonPost('/api/console/catalogue/price', { code: 'NC-ORG-001', price: '249.00', reason: 'launch pricing' }), { session: staffSession });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).price_cents, 24900);
  const { rows } = await app.query(`select * from audit_event where action = 'product.price_changed' and object_ref = 'NC-ORG-001'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from_state, '19900');
  assert.equal(rows[0].to_state, '24900');
  assert.equal(rows[0].reason, 'launch pricing');
  // bad input
  const bad = await handlers.updatePrice(jsonPost('/api/console/catalogue/price', { code: 'NC-ORG-001', priceCents: -5 }), { session: staffSession });
  assert.equal(bad.status, 400);
  // form post redirects back with the notice
  const form = await handlers.updatePrice(new Request('https://admin.example.test/api/console/catalogue/price', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=NOPE&price=1',
  }), { session: staffSession });
  assert.equal(form.status, 303);
  assert.match(form.headers.get('location'), /^\/catalogue\?notice=/);
});

test('billing ledger is read-only and lists events and entitlements; stale query degrades legibly', async () => {
  const { events, entitlements } = await billingLedger(app);
  assert.equal(events[0].type, 'checkout.session.completed');
  assert.equal(entitlements[0].source, 'seat:acme');
  const down = await staleContent({ staleContent: async () => { const e = new Error('down'); e.name = 'CoreUnavailableError'; throw e; } });
  assert.equal(down.degraded, true);
  const up = await staleContent({ staleContent: async d => ({ items: [{ ref: 'x', verified_on: null }], days: d }) }, 90);
  assert.equal(up.items.length, 1);
  assert.equal(up.days, 90);
});
