// Auth module tests on a real embedded PostgreSQL + in-memory Redis stub.
// Covers: signup, login, lockout, TOTP enrollment/verify, recovery codes,
// session MFA gate, per-user revocation, crypto sealing.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { generate } from 'otplib';
import { startTestDb } from './helpers/pg.mjs';
import { createRedisStub } from './helpers/redis_stub.mjs';
import { createAccounts } from '../src/lib/auth/accounts.mjs';
import { createTotp } from '../src/lib/auth/totp.mjs';
import { createSessionStore } from '../src/lib/session.mjs';
import { sealSecret, openSecret } from '../src/lib/infra/crypto.mjs';

process.env.AUTH_KEK = Buffer.from('k'.repeat(32)).toString('base64');

const ctx = {};

test.before(async () => {
  ctx.pgm = await startTestDb();
  ctx.db = new pg.Pool({ connectionString: ctx.pgm.appUrl, max: 4 });
  ctx.redis = createRedisStub();
  ctx.accounts = createAccounts({ db: ctx.db, redis: ctx.redis });
  ctx.totp = createTotp({ db: ctx.db });
  ctx.sessions = createSessionStore(ctx.redis);
});

test.after(async () => {
  await ctx.db?.end();
  await ctx.pgm?.stop();
});

test('crypto: seal/open roundtrip, tamper detected', () => {
  const sealed = sealSecret('JBSWY3DPEHPK3PXP');
  assert.equal(openSecret(sealed), 'JBSWY3DPEHPK3PXP');
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => openSecret(tampered));
});

test('signup creates user with learner role and frozen external_ref', async () => {
  const user = await ctx.accounts.createUser({
    email: 'maria@example.com', displayName: 'Maria', password: 'correct-horse-battery',
  });
  assert.ok(user.external_ref.startsWith('reli_'));
  const { rows } = await ctx.db.query(
    `select role from role_grant where user_id = $1`, [user.id]);
  assert.deepEqual(rows.map(r => r.role), ['learner']);
  ctx.user = user;

  await assert.rejects(
    ctx.accounts.createUser({ email: 'maria@example.com', displayName: 'M', password: 'another-long-password' }),
    err => err.code === 'email_taken');
  await assert.rejects(
    ctx.accounts.createUser({ email: 'short@example.com', displayName: 'S', password: 'short' }),
    err => err.code === 'weak_password');
});

test('login verifies password and reports roles', async () => {
  const result = await ctx.accounts.verifyLogin({
    email: 'maria@example.com', password: 'correct-horse-battery' });
  assert.equal(result.user.id, ctx.user.id);
  assert.deepEqual(result.roles, ['learner']);
  assert.equal(await ctx.accounts.verifyLogin({
    email: 'maria@example.com', password: 'wrong-password-entirely' }), null);
  assert.equal(await ctx.accounts.verifyLogin({
    email: 'nobody@example.com', password: 'whatever-long-thing' }), null);
});

test('lockout after repeated failures, then locked error', async () => {
  const email = 'locked@example.com';
  await ctx.accounts.createUser({ email, displayName: 'L', password: 'a-perfectly-fine-password' });
  for (let i = 0; i < 10; i++) {
    await ctx.accounts.verifyLogin({ email, password: 'bad-password-attempt' });
  }
  await assert.rejects(
    ctx.accounts.verifyLogin({ email, password: 'a-perfectly-fine-password' }),
    err => err.code === 'locked');
});

test('totp: enroll, confirm with live code, verify, recovery codes single-use', async () => {
  const { secret } = await ctx.totp.beginEnrollment({
    userId: ctx.user.id, email: 'maria@example.com' });
  assert.equal(await ctx.totp.isEnrolled(ctx.user.id), false);

  assert.equal(await ctx.totp.confirmEnrollment({ userId: ctx.user.id, code: '000000' }), null);
  const confirmed = await ctx.totp.confirmEnrollment({
    userId: ctx.user.id, code: await generate({ secret }) });
  assert.equal(confirmed.recoveryCodes.length, 10);
  assert.equal(await ctx.totp.isEnrolled(ctx.user.id), true);

  assert.equal(await ctx.totp.verifyCode({
    userId: ctx.user.id, code: await generate({ secret }) }), true);
  assert.equal(await ctx.totp.verifyCode({ userId: ctx.user.id, code: '111111' }), false);

  const rc = confirmed.recoveryCodes[0];
  assert.equal(await ctx.totp.consumeRecoveryCode({ userId: ctx.user.id, code: rc }), true);
  assert.equal(await ctx.totp.consumeRecoveryCode({ userId: ctx.user.id, code: rc }), false);
});

test('sessions: studio/console refuse without MFA; dojo does not', async () => {
  await assert.rejects(
    ctx.sessions.create({ userId: ctx.user.id, roles: ['author'], door: 'studio' }),
    /mfa required/);
  const dojo = await ctx.sessions.create({
    userId: ctx.user.id, roles: ['learner'], door: 'dojo' });
  assert.ok(dojo.token);
  const studio = await ctx.sessions.create({
    userId: ctx.user.id, roles: ['author'], door: 'studio', mfaVerified: true });
  assert.ok(studio.token);
});

test('sessions: role-door mismatch refused', async () => {
  await assert.rejects(
    ctx.sessions.create({ userId: ctx.user.id, roles: ['learner'], door: 'console', mfaVerified: true }),
    /role cannot enter/);
});

test('logout-all revokes every session via generation counter', async () => {
  const a = await ctx.sessions.create({ userId: ctx.user.id, roles: ['learner'], door: 'dojo' });
  const b = await ctx.sessions.create({ userId: ctx.user.id, roles: ['learner'], door: 'dojo' });
  assert.ok(await ctx.sessions.get(a.token));
  await ctx.sessions.destroyAllForUser(ctx.user.id);
  assert.equal(await ctx.sessions.get(a.token), null);
  assert.equal(await ctx.sessions.get(b.token), null);
  const c = await ctx.sessions.create({ userId: ctx.user.id, roles: ['learner'], door: 'dojo' });
  assert.ok(await ctx.sessions.get(c.token));
});
