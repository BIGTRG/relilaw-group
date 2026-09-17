// The legal gate (§6 module 05). Spec tests 1 and 2, end to end on a real
// Postgres with the real roles: staff cannot publish by route, by crafted
// request or by SQL as the application role; eight open items block
// NC-ORG-001; one legal sign-off clears it; the record is immutable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { createPipeline, publishedSignature, placeholderReviewItems, upsertReviewItems, PUBLISH_REFUSAL, PipelineError } from '../src/lib/pipeline.mjs';
import { createPipelineHandlers } from '../src/lib/pipeline-routes.mjs';

let db, app, admin, legal, auditor;
let staff, counsel, author;      // users
let staffSession, legalSession, authorSession, legalNoMfa;
let pipeline, studio, consoleH;
let versionId;

const user = async (ref, email, name) => (await app.query(
  `insert into app_user (external_ref, email, display_name) values ($1, $2, $3) returning id`, [ref, email, name])).rows[0].id;
const grant = (uid, role) => app.query(`insert into role_grant (user_id, role) values ($1, $2)`, [uid, role]);

const jsonPost = (path, body) => new Request(`https://studio.example.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
});
const formPost = (path, fields) => new Request(`https://studio.example.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  admin = new pg.Pool({ connectionString: db.adminUrl });
  legal = new pg.Pool({ connectionString: db.legalUrl });
  auditor = new pg.Pool({ connectionString: db.auditorUrl });

  staff = await user('reli_STAFF00001', 'staff@example.org', 'Sam Staff');
  counsel = await user('reli_LEGAL00001', 'counsel@example.org', 'Dana Counsel');
  author = await user('reli_AUTHOR0001', 'author@example.org', 'Avery Author');
  await grant(staff, 'staff'); await grant(counsel, 'legal'); await grant(author, 'author');

  staffSession = { userId: staff, roles: ['staff'], door: 'console', mfaVerified: true };
  legalSession = { userId: counsel, roles: ['legal'], door: 'studio', mfaVerified: true };
  legalNoMfa = { userId: counsel, roles: ['legal'], door: 'studio', mfaVerified: false };
  authorSession = { userId: author, roles: ['author'], door: 'studio', mfaVerified: true };

  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents)
                   values ('NC-ORG-001', '2a7eff5b-0000-4000-8000-000000000001', 'NC Wage and Hour', 'orange', 19900)`);
  await upsertReviewItems(app, placeholderReviewItems('NC-ORG-001', 8));

  pipeline = createPipeline({ db: app, legalUrl: db.legalUrl });
  studio = createPipelineHandlers({ pipeline, door: 'studio' });
  consoleH = createPipelineHandlers({ pipeline, door: 'console' });

  const v = await pipeline.createDraft({ courseRef: 'NC-ORG-001', versionRef: 'v1', title: 'Orange Belt', actor: { userId: author, roles: ['author'] } });
  versionId = v.id;
}, { timeout: 180_000 });

after(async () => {
  for (const p of [app, admin, legal, auditor]) await p?.end();
  await db?.stop();
});

test('pipeline: draft -> sme_review -> legal_review by an author; transitions logged with actor and role', async () => {
  let v = await pipeline.transition({ versionId, to: 'sme_review', reason: 'ready for SME', actor: { userId: author, roles: ['author'] } });
  assert.equal(v.state, 'sme_review');
  v = await pipeline.transition({ versionId, to: 'legal_review', reason: 'SME happy', actor: { userId: author, roles: ['author'] } });
  assert.equal(v.state, 'legal_review');
  const log = await pipeline.transitions(versionId);
  assert.deepEqual(log.map(t => [t.from_state, t.to_state, t.actor_role]), [['draft', 'sme_review', 'author'], ['sme_review', 'legal_review', 'author']]);
  // illegal jump refused by code and by SQL
  await assert.rejects(pipeline.transition({ versionId, to: 'draft', actor: { userId: author, roles: ['author'] } }), /role cannot/);
  await assert.rejects(app.query(
    `insert into pipeline_transition (version_id, from_state, to_state, actor_role) values ($1, 'draft', 'legal_review', 'author')`, [versionId]),
    /does not match current state/);
});

test('SPEC TEST 1: a staff admin cannot publish jurisdiction content by any route', async () => {
  // (a) staff route call on the Console door -> 403 with the refusal text
  let res = await consoleH.signOff(jsonPost('/api/console/pipeline/signoff', { versionId, reason: 'ship it' }), { session: staffSession });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).detail, PUBLISH_REFUSAL);

  // (b) crafted requests: staff session presented to the Studio's sign-off handler,
  //     a transition straight to `published`, and force/override flags
  res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: 'x' }), { session: staffSession });
  assert.equal(res.status, 403);
  res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: 'x' }), { session: { ...staffSession, door: 'studio' } });
  assert.equal(res.status, 403);
  res = await consoleH.transition(jsonPost('/api/console/pipeline/transition', { versionId, to: 'published' }), { session: staffSession });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).detail, PUBLISH_REFUSAL);
  res = await consoleH.transition(jsonPost('/api/console/pipeline/transition', { versionId, to: 'legal_review', force_publish: true }), { session: staffSession });
  assert.equal(res.status, 403);
  res = await consoleH.transition(formPost('/api/console/pipeline/transition', { versionId, to: 'published' }), { session: staffSession });
  assert.equal(res.status, 303);
  assert.match(decodeURIComponent(res.headers.get('location')), /Only a legal reviewer can publish/);
  // a staff session with the legal role's capability asserted client-side is still staff
  await assert.rejects(pipeline.signOff({ versionId, reason: 'x', actor: { userId: staff, roles: ['staff'], mfaVerified: true } }), e => e instanceof PipelineError && e.status === 403);
  await assert.rejects(pipeline.transition({ versionId, to: 'published', actor: { userId: staff, roles: ['staff'] } }), e => e.code === 'publish_forbidden');

  // (c) the application database role: a direct INSERT into publish_signoff is denied…
  await assert.rejects(app.query(
    `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id) values ('NC-ORG-001', 'v1', $1)`, [staff]),
    /permission denied/i);
  // …a transition to published without a sign-off is refused by the trigger…
  await assert.rejects(app.query(
    `insert into pipeline_transition (version_id, from_state, to_state, actor_user_id, actor_role) values ($1, 'legal_review', 'published', $2, 'staff')`, [versionId, staff]),
    /only a legal reviewer/i);
  await assert.rejects(app.query(
    `insert into pipeline_transition (version_id, from_state, to_state, actor_user_id, actor_role) values ($1, 'legal_review', 'published', $2, 'legal')`, [versionId, staff]),
    /GATE/);
  // …and so is flipping the state column directly.
  await assert.rejects(app.query(`update content_version set state = 'published' where id = $1`, [versionId]), /without a matching pipeline_transition|GATE/);
  const { rows } = await app.query('select state from content_version where id = $1', [versionId]);
  assert.equal(rows[0].state, 'legal_review');
});

test('SPEC TEST 2: eight open items block NC-ORG-001; one legal sign-off clears it and is recorded immutably', async () => {
  const items = await pipeline.reviewItems('NC-ORG-001');
  assert.equal(items.filter(i => i.status === 'open').length, 8);
  let gate = await pipeline.gateStatus(versionId);
  assert.equal(gate.publishable, false);
  assert.match(gate.blockers.join(' '), /8 attorney-review items open/);

  // legal cannot sign while items are open — by code, by route, and by SQL as reli_legal
  await assert.rejects(pipeline.signOff({ versionId, reason: 'try', actor: { userId: counsel, roles: ['legal'], mfaVerified: true } }), e => e.code === 'items_open');
  let res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: 'try' }), { session: legalSession });
  assert.equal(res.status, 409);
  await assert.rejects(legal.query(
    `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id) values ('NC-ORG-001', 'v1', $1)`, [counsel]),
    /open attorney-review items remain/);

  // only legal resolves items: author and staff are refused
  await assert.rejects(pipeline.resolveReviewItem({ itemId: items[0].id, actor: { userId: author, roles: ['author'] } }), e => e.status === 403);
  res = await studio.resolveItem(jsonPost('/api/studio/pipeline/resolve', { itemId: items[0].id, versionId }), { session: { ...staffSession, door: 'studio' } });
  assert.equal(res.status, 403);

  // resolve 7: still blocked
  const open = items.filter(i => i.status === 'open');
  for (const it of open.slice(0, 7)) await pipeline.resolveReviewItem({ itemId: it.id, actor: { userId: counsel, roles: ['legal'] } });
  gate = await pipeline.gateStatus(versionId);
  assert.equal(gate.open_items, 1);
  assert.equal(gate.publishable, false);
  await assert.rejects(pipeline.signOff({ versionId, reason: 'try', actor: { userId: counsel, roles: ['legal'], mfaVerified: true } }), e => e.code === 'items_open');

  // resolve the 8th via the route (legal, MFA) — still not published: sign-off is a separate act
  res = await studio.resolveItem(jsonPost('/api/studio/pipeline/resolve', { itemId: open[7].id, versionId }), { session: legalSession });
  assert.equal(res.status, 200);
  gate = await pipeline.gateStatus(versionId);
  assert.equal(gate.open_items, 0);
  assert.equal(gate.signed, false);
  assert.equal(gate.publishable, false);
  assert.equal((await pipeline.getVersion(versionId)).state, 'legal_review');

  // legal without MFA is refused; legal with MFA but no reason is refused
  res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: 'x' }), { session: legalNoMfa });
  assert.equal(res.status, 403);
  res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: '  ' }), { session: legalSession });
  assert.equal(res.status, 400);

  // exactly one action: legal reviewer, MFA verified, with a reason
  res = await studio.signOff(jsonPost('/api/studio/pipeline/signoff', { versionId, reason: 'Reviewed all 22 lessons; 8 items resolved.' }), { session: legalSession });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.state, 'published');
  assert.ok(body.signoffId);

  const v = await pipeline.getVersion(versionId);
  assert.equal(v.state, 'published');
  assert.equal(v.reviewer_name, 'Dana Counsel');
  assert.ok(v.signed_at && v.published_at);
  const sig = await publishedSignature(app, 'NC-ORG-001');
  assert.equal(sig.reviewerName, 'Dana Counsel');
  assert.equal(sig.versionRef, 'v1');

  const log = await pipeline.transitions(versionId);
  const last = log.at(-1);
  assert.deepEqual([last.from_state, last.to_state, last.actor_role, last.actor_name], ['legal_review', 'published', 'legal', 'Dana Counsel']);
  const audit = await app.query(`select action from audit_event where object_ref = $1 order by id`, [versionId]);
  assert.ok(audit.rows.some(r => r.action === 'pipeline.published'));

  // the sign-off row cannot be updated or deleted by any role
  for (const [name, pool] of [['app', app], ['legal', legal], ['auditor', auditor]]) {
    await assert.rejects(pool.query(`update publish_signoff set note = 'edited' where id = $1`, [body.signoffId]), /permission denied/i, name);
    await assert.rejects(pool.query(`delete from publish_signoff where id = $1`, [body.signoffId]), /permission denied/i, name);
  }
  // the transition log is immutable for every role
  for (const [name, pool] of [['app', app], ['legal', legal], ['auditor', auditor]]) {
    await assert.rejects(pool.query(`update pipeline_transition set to_state = 'draft' where id = $1`, [last.id]), /permission denied/i, name);
    await assert.rejects(pool.query(`delete from pipeline_transition where id = $1`, [last.id]), /permission denied/i, name);
  }
  // a published version is frozen, even for reli_legal
  await assert.rejects(app.query(`update content_version set title = 'renamed' where id = $1`, [versionId]), /immutable/);
  await assert.rejects(legal.query(`update content_version set state = 'draft' where id = $1`, [versionId]), /immutable/);
  await assert.rejects(app.query(`delete from content_version where id = $1`, [versionId]), /permission denied|immutable/i);
  await assert.rejects(pipeline.transition({ versionId, to: 'draft', actor: { userId: counsel, roles: ['legal'] } }), e => e.status === 409);
  // a second sign-off for the same version is refused (unique + not in legal review)
  await assert.rejects(legal.query(
    `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id) values ('NC-ORG-001', 'v1', $1)`, [counsel]),
    /not in legal review|duplicate/);
});

test('pipeline: an edit is a new draft that walks the whole path again', async () => {
  const v2 = await pipeline.createDraft({ courseRef: 'NC-ORG-001', versionRef: 'v2', title: 'Orange Belt, revised', actor: { userId: counsel, roles: ['legal'] } });
  assert.equal(v2.state, 'draft');
  // cannot be signed from draft, even with zero open items
  await assert.rejects(legal.query(
    `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id) values ('NC-ORG-001', 'v2', $1)`, [counsel]),
    /not in legal review/);
  await assert.rejects(pipeline.signOff({ versionId: v2.id, reason: 'x', actor: { userId: counsel, roles: ['legal'], mfaVerified: true } }), e => e.code === 'not_in_review');
  // the published signature still points at v1
  assert.equal((await publishedSignature(app, 'NC-ORG-001')).versionRef, 'v1');
});

test('pipeline: no bypass words exist in the pipeline code', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['src/lib/pipeline.mjs', 'src/lib/pipeline-routes.mjs', 'src/lib/console-http.mjs', 'db/migrations/003_pipeline.sql']) {
    const text = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    // The words may appear only in comments/refusals; no code path may branch on them.
    assert.doesNotMatch(text, /process\.env\.[A-Z_]*(FORCE|BYPASS|SKIP_GATE|ALLOW_PUBLISH)/, f);
    assert.doesNotMatch(text, /if\s*\([^)]*(force|bypass|override)[^)]*\)\s*\{[^}]*(published|signOff|publish_signoff)/i, f);
  }
});
