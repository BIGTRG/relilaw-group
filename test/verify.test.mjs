// Public verify (§6 module 07) and the credential registry. Spec test 9
// (a revoked credential's page shows revoked, with reason) and spec test 10
// (per-IP rate limit, clean 429). Real Postgres, fake Core, in-memory Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { createRedisStub } from './helpers/redis_stub.mjs';
import { listCredentials, revokeCredential, localRevocation } from '../src/lib/registry.mjs';
import { createConsoleHandlers } from '../src/lib/console-routes.mjs';
import {
  createVerifyLimiter, resolveVerification, handleVerifyRequest, renderLimitedDocument, limitedResponse, rankMetaByName, resetRankCache, clientIp,
} from '../src/lib/verify.mjs';
import { CoreUnavailableError, CoreRequestError } from '../src/lib/core-client.mjs';

let db, app, holder, staff;
const COURSE = '2a7eff5b-0000-4000-8000-000000000001';
const CRED = 'dddddddd-2222-4111-8111-111111111111';
const REF = 'RELI-7K2M-Q9XA';

function fakeCore(over = {}) {
  const record = { public_ref: REF, status: 'active', learner_name: 'Maria Alvarez', course_title: 'NC Wage and Hour', rank_name: 'Orange', issuer: 'RELI', issued_at: '2026-09-01T12:00:00Z', revoked_at: null };
  return {
    record,
    verifyCredential: async ref => {
      if (over.down) throw new CoreUnavailableError(new Error('down'));
      if (ref !== REF) throw new CoreRequestError(404, { title: 'not found' });
      return { ...record, ...over.record };
    },
    listSchemes: async () => ({ items: [{ id: 's1', ranks: [{ id: 'r1', name: 'White', position: 1, meta: { fill: '#D8DCE0' } }, { id: 'r3', name: 'Orange', position: 3, meta: { fill: '#CC6B2C', ink: '#FFFFFF' } }] }] }),
  };
}

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  holder = (await app.query(`insert into app_user (external_ref, email, display_name) values ('reli_HOLDER0001', 'maria@example.org', 'Maria Alvarez') returning id`)).rows[0].id;
  staff = (await app.query(`insert into app_user (external_ref, email, display_name) values ('reli_STAFF00003', 'staff3@example.org', 'Sam Staff') returning id`)).rows[0].id;
  await app.query(`insert into role_grant (user_id, role) values ($1, 'staff')`, [staff]);
  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-ORG-001', $1, 'NC Wage and Hour', 'orange', 19900)`, [COURSE]);
  await app.query(`insert into credential_link (core_credential_id, user_id, core_course_id, public_ref) values ($1, $2, $3, $4)`, [CRED, holder, COURSE, REF]);
}, { timeout: 180_000 });

after(async () => { await app?.end(); await db?.stop(); });

test('verify: a valid credential resolves with holder, course, issuer and the rank colour from scheme meta', async () => {
  resetRankCache();
  const v = await resolveVerification({ core: fakeCore(), db: app, ref: REF });
  assert.equal(v.state, 'valid');
  assert.equal(v.record.holder, 'Maria Alvarez');
  assert.equal(v.record.issuedAt, '2026-09-01');
  assert.equal(v.rank.fill, '#CC6B2C');
  assert.equal((await rankMetaByName(fakeCore(), 'white')).fill, '#D8DCE0');
  assert.equal(await rankMetaByName(fakeCore(), 'Sensei'), null);
  // shapes that are not credentials never reach the Core
  assert.equal((await resolveVerification({ core: { verifyCredential: async () => { throw new Error('must not be called'); } }, db: app, ref: 'ab' })).state, 'invalid');
  assert.equal((await resolveVerification({ core: fakeCore(), db: app, ref: 'RELI-NOPE-0000' })).state, 'missing');
  assert.equal((await resolveVerification({ core: fakeCore({ down: true }), db: app, ref: REF })).state, 'paused');
});

test('registry: list and search credentials; revocation needs staff and a reason, is one-way, and is audited', async () => {
  const all = await listCredentials(app);
  assert.equal(all.length, 1);
  assert.equal((await listCredentials(app, { q: 'maria' })).length, 1);
  assert.equal((await listCredentials(app, { q: 'zzz' })).length, 0);
  await assert.rejects(revokeCredential(app, { credentialId: CRED, reason: 'x', actor: { userId: holder, roles: ['learner'] } }), e => e.status === 403);
  await assert.rejects(revokeCredential(app, { credentialId: CRED, reason: '', actor: { userId: staff, roles: ['staff'] } }), e => e.code === 'reason_required');
  // the SQL layer also demands a reason
  await assert.rejects(app.query(`update credential_link set revoked_at = now() where core_credential_id = $1`, [CRED]), /requires a reason/);
});

test('SPEC TEST 9: a revoked credential\'s public verify page shows revoked, with reason', async () => {
  const handlers = createConsoleHandlers({ pools: { app, auditor: app } });
  const res = await handlers.revokeCredential(new Request('https://admin.example.test/api/console/registry/revoke', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ credentialId: CRED, reason: 'Assessment integrity: identity could not be confirmed' }),
  }), { session: { userId: staff, roles: ['staff'], door: 'console', mfaVerified: true } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.publicRef, REF);
  assert.equal(body.coreRevoked, false); // the Core has no revoke endpoint yet; recorded locally
  const local = await localRevocation(app, REF);
  assert.match(local.revoke_reason, /integrity/);
  // the Core still says active (it has not been told); the page overlays the registry
  const v = await resolveVerification({ core: fakeCore(), db: app, ref: REF });
  assert.equal(v.state, 'revoked');
  assert.equal(v.record.revokeReason, 'Assessment integrity: identity could not be confirmed');
  assert.ok(v.record.revokedAt);
  // and when the Core itself reports revoked, the page agrees and still carries the reason
  const v2 = await resolveVerification({ core: fakeCore({ record: { status: 'revoked', revoked_at: '2026-09-16T00:00:00Z' } }), db: app, ref: REF });
  assert.equal(v2.state, 'revoked');
  assert.equal(v2.record.revokedAt, '2026-09-16');
  assert.match(v2.record.revokeReason, /integrity/);
  // revocation is permanent: cannot be cleared, re-worded, or repeated
  await assert.rejects(app.query(`update credential_link set revoked_at = null where core_credential_id = $1`, [CRED]), /permanent/);
  await assert.rejects(app.query(`update credential_link set revoke_reason = 'softer' where core_credential_id = $1`, [CRED]), /permanent/);
  await assert.rejects(revokeCredential(app, { credentialId: CRED, reason: 'again', actor: { userId: staff, roles: ['staff'] } }), e => e.status === 404);
  const audit = await app.query(`select * from audit_event where action = 'credential.revoked'`);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].meta.public_ref, REF);
});

test('SPEC TEST 10: public verify is rate-limited per IP and returns a clean 429', async () => {
  const redis = createRedisStub();
  const limiter = createVerifyLimiter(redis, { limit: 5, windowS: 60 });
  for (let i = 0; i < 5; i++) assert.equal((await limiter.check('203.0.113.7')).allowed, true);
  const over = await limiter.check('203.0.113.7');
  assert.equal(over.allowed, false);
  assert.equal(over.retryAfter, 60);
  // another IP is unaffected
  assert.equal((await limiter.check('203.0.113.8')).allowed, true);

  // the page-level entry: the 31st request from one IP is limited and the Core is not asked
  const redis2 = createRedisStub();
  let coreCalls = 0;
  const core = { ...fakeCore(), verifyCredential: async ref => { coreCalls++; return fakeCore().record; } };
  let last;
  for (let i = 0; i < 31; i++) last = await handleVerifyRequest({ core, db: app, redis: redis2, ref: REF, ip: '198.51.100.9' });
  assert.equal(last.limited, true);
  assert.equal(coreCalls, 30);

  // the 429 itself: right status, Retry-After, a complete HTML document with no stack, no script
  const res = await limitedResponse({ retryAfter: 60 });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Too many requests from your connection/);
  assert.match(html, /<main id="main"/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /at .*\.mjs:\d+/); // no stack trace
  assert.match(html, /provides education about employment law/); // UPL notice present
  assert.equal(await renderLimitedDocument({ retryAfter: 30 }), await renderLimitedDocument({ retryAfter: 30 }));

  // client IP resolution behind nginx
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })), '203.0.113.1');
  assert.equal(clientIp(new Headers()), '0.0.0.0');
});
