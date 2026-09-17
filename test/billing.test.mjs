// Payments (M3, §8): hosted Checkout builder, webhook idempotency (spec test 7),
// signature rejection, refund/dispute revocation (spec test 8), and the mail
// adapter's ledger. Real Postgres (embedded), real Stripe signature maths
// (stripe-node's own helpers), a fake Stripe network, a fake Core.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import Stripe from 'stripe';
import { startTestDb } from './helpers/pg.mjs';
import { createRedisStub } from './helpers/redis_stub.mjs';
import { hasEntitlement, revokeEntitlement } from '../src/lib/entitlements.mjs';
import { createLearningService } from '../src/lib/learning.mjs';
import {
  buildCheckoutParams, paymentMethodTypesFor, createCheckoutSession, AlreadyOwnedError, UnknownProductError,
  ACH_DEFAULT_THRESHOLD_CENTS,
} from '../src/lib/billing/checkout.mjs';
import { handleStripeEvent, HANDLED_EVENTS } from '../src/lib/billing/webhook.mjs';
import { STRIPE_API_VERSION, verifyWebhook } from '../src/lib/billing/stripe.mjs';
import { createMailer, createMemoryTransport } from '../src/lib/mail/index.mjs';
import { enrolmentConfirmation, credentialIssued, receipt } from '../src/lib/mail/templates.mjs';

let db, app, user, redis, learning, core;
const COURSE = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://app.example.test';
const SECRET = 'whsec_test_secret_for_unit_tests';
const stripe = new Stripe('sk_test_unit', { apiVersion: STRIPE_API_VERSION });

const product = { code: 'NC-ORG-001', title: 'North Carolina Wage & Hour — Orange Belt', price_cents: 19900, currency: 'usd', core_course_id: COURSE };

function fakeCore() {
  const state = { enrolls: 0, learners: 0 };
  return {
    state,
    upsertLearner: async ({ externalRef }) => ({ id: `aaaaaaaa-0000-4000-8000-00000000000${++state.learners}`, external_ref: externalRef }),
    enroll: async () => { state.enrolls++; return { id: `bbbbbbbb-0000-4000-8000-00000000000${state.enrolls}` }; },
  };
}

/** A Stripe event as delivered, with a real-format signature header. */
function signedEvent(type, object, { id = `evt_test_${Math.random().toString(36).slice(2, 12)}` } = {}) {
  const event = { id, object: 'event', api_version: STRIPE_API_VERSION, created: Math.floor(Date.now() / 1000), type, livemode: false,
    data: { object }, pending_webhooks: 1, request: { id: null, idempotency_key: null } };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return { event, payload, header };
}

const checkoutSession = (userId, over = {}) => ({
  id: `cs_test_${Math.random().toString(36).slice(2, 10)}`, object: 'checkout.session', mode: 'payment',
  payment_status: 'paid', status: 'complete', amount_total: 19900, currency: 'usd',
  client_reference_id: userId, customer: 'cus_test_ABC123', payment_intent: 'pi_test_001',
  customer_details: { email: 'buyer@example.org' },
  metadata: { product_code: product.code, user_id: userId, entitlement_key: `course:${product.code}` }, ...over,
});

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  user = (await app.query(
    `insert into app_user (external_ref, email, display_name) values ('reli_BUYER0001', 'buyer@example.org', 'Ada Buyer')
     returning id, external_ref, email, display_name, status`)).rows[0];
  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ($1, $2, $3, 'orange', $4)`,
    [product.code, COURSE, product.title, product.price_cents]);
  redis = createRedisStub();
  core = fakeCore();
  learning = createLearningService({ db: app, core });
}, { timeout: 180_000 });
after(async () => { await app.end(); await db.stop(); });

// ---- checkout builder -------------------------------------------------------

test('API version is pinned to 2026-07-29.dahlia in exactly one place', () => {
  assert.equal(STRIPE_API_VERSION, '2026-07-29.dahlia');
});

test('checkout builder: hosted session, inline price from the product table, metadata on session AND payment intent', () => {
  const p = buildCheckoutParams({ product, user, baseUrl: BASE });
  assert.equal(p.mode, 'payment');
  assert.equal(p.line_items[0].price_data.unit_amount, 19900);
  assert.equal(p.line_items[0].price_data.currency, 'usd');
  assert.equal(p.line_items[0].price_data.product_data.name, product.title);
  assert.equal(p.client_reference_id, user.id);
  assert.deepEqual(p.metadata, { product_code: 'NC-ORG-001', user_id: user.id, entitlement_key: 'course:NC-ORG-001' });
  assert.deepEqual(p.payment_intent_data.metadata, p.metadata);
  assert.equal(p.success_url, `${BASE}/library?purchased=1`);
  assert.equal(p.cancel_url, `${BASE}/library`);
  assert.equal(p.customer_email, user.email);
  assert.equal(p.customer_creation, 'always');
  const withCustomer = buildCheckoutParams({ product, user, baseUrl: BASE, customerId: 'cus_existing' });
  assert.equal(withCustomer.customer, 'cus_existing');
  assert.equal(withCustomer.customer_email, undefined);
});

test('ACH rule: card only at $199; us_bank_account FIRST above $5,000 (§8)', () => {
  assert.equal(ACH_DEFAULT_THRESHOLD_CENTS, 500_000);
  assert.deepEqual(paymentMethodTypesFor(19900), ['card']);
  assert.deepEqual(paymentMethodTypesFor(500_000), ['card'], 'exactly $5,000 is not over $5,000');
  assert.deepEqual(paymentMethodTypesFor(500_001), ['us_bank_account', 'card']);
  const big = buildCheckoutParams({ product: { ...product, price_cents: 4_500_000 }, user, baseUrl: BASE });
  assert.equal(big.payment_method_types[0], 'us_bank_account');
  const small = buildCheckoutParams({ product, user, baseUrl: BASE });
  assert.deepEqual(small.payment_method_types, ['card']);
});

test('createCheckoutSession: unknown product refused; sells once; refuses when already owned (§4.2)', async () => {
  const calls = [];
  const fakeStripe = { checkout: { sessions: { create: async (params, opts) => { calls.push({ params, opts }); return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }; } } } };
  await assert.rejects(() => createCheckoutSession({ db: app, stripe: fakeStripe, user, productCode: 'NOPE-000', baseUrl: BASE }), UnknownProductError);
  const s = await createCheckoutSession({ db: app, stripe: fakeStripe, user, productCode: product.code, baseUrl: BASE });
  assert.equal(s.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.idempotencyKey, new RegExp(`^checkout:${user.id}:NC-ORG-001:`));
  // grant by any means (here a comp) → no more checkout links for this course
  await app.query(`insert into entitlement (user_id, key, source) values ($1, 'course:NC-ORG-001', 'comp:test')`, [user.id]);
  await assert.rejects(() => createCheckoutSession({ db: app, stripe: fakeStripe, user, productCode: product.code, baseUrl: BASE }), AlreadyOwnedError);
  assert.equal(calls.length, 1, 'no session was created for an owned course');
  // reli_app holds no DELETE on entitlement (by design): revoke through the one path instead
  await revokeEntitlement(app, null, { userId: user.id, key: 'course:NC-ORG-001', reason: 'test-cleanup' });
});

// ---- webhook: signature -----------------------------------------------------

test('webhook: signature is verified with the real Stripe scheme; bad secret, tampered body and missing header are rejected', () => {
  const { payload, header } = signedEvent('checkout.session.completed', checkoutSession(user.id));
  const ok = verifyWebhook(stripe, payload, header, SECRET);
  assert.equal(ok.type, 'checkout.session.completed');
  assert.throws(() => verifyWebhook(stripe, payload, header, 'whsec_wrong'), /StripeSignatureVerificationError|No signatures found/);
  assert.throws(() => verifyWebhook(stripe, payload.replace('"paid"', '"unpaid"'), header, SECRET), /No signatures found|StripeSignatureVerificationError/);
  assert.throws(() => verifyWebhook(stripe, payload, null, SECRET), /missing stripe-signature/);
  assert.throws(() => verifyWebhook(stripe, payload, header, undefined), /STRIPE_WEBHOOK_SECRET/);
});

// ---- webhook: fulfilment, idempotency (spec test 7) --------------------------

test('SPEC TEST 7: a duplicated Stripe webhook (same checkout.session.completed delivered twice, then a parallel storm) grants exactly ONE entitlement, one Core enrolment, one receipt + one confirmation', async () => {
  const transport = createMemoryTransport();
  const mail = createMailer({ db: app, transport, from: 'RELI <reli@example.test>' });
  const { event } = signedEvent('checkout.session.completed', checkoutSession(user.id));
  const key = 'course:NC-ORG-001';
  assert.equal(await hasEntitlement(app, user.id, key), false);

  const first = await handleStripeEvent({ db: app, redis, learning, mail, event });
  assert.equal(first.status, 'processed');
  assert.equal(first.action, 'grant');
  assert.ok(first.entitlementId, 'an entitlement id came back');
  assert.ok(first.enrollmentId, 'the Core enrolment happened inside the same transaction');

  const second = await handleStripeEvent({ db: app, redis, learning, mail, event });
  assert.equal(second.status, 'duplicate');

  // and a parallel storm of the same event
  const storm = await Promise.all([1, 2, 3, 4].map(() => handleStripeEvent({ db: app, redis, learning, mail, event })));
  assert.ok(storm.every(r => r.status === 'duplicate'));

  const ents = await app.query(`select id, source from entitlement where user_id = $1 and key = $2 and revoked_at is null`, [user.id, key]);
  assert.equal(ents.rows.length, 1, 'exactly one entitlement');
  assert.equal(ents.rows[0].source, `stripe:${event.id}`);
  assert.equal(await hasEntitlement(app, user.id, key), true);
  assert.equal(core.state.enrolls, 1, 'exactly one Core enrolment');

  const ledger = await app.query(`select id, type, processed_at from stripe_event where id = $1`, [event.id]);
  assert.equal(ledger.rows.length, 1);
  assert.ok(ledger.rows[0].processed_at);

  const cust = await app.query(`select stripe_customer_id from stripe_customer where user_id = $1`, [user.id]);
  assert.equal(cust.rows[0].stripe_customer_id, 'cus_test_ABC123');

  const mails = await app.query(`select template, status, message_id from email_log where user_id = $1 order by created_at`, [user.id]);
  assert.deepEqual(mails.rows.map(r => r.template), ['receipt', 'enrolment_confirmation']);
  assert.ok(mails.rows.every(r => r.status === 'sent' && r.message_id));
  assert.equal(transport.sent.length, 2);
  assert.match(transport.sent[0].subject, /^Receipt — /);
  assert.match(transport.sent[0].text, /\$199\.00/);
  assert.match(transport.sent[1].text, new RegExp(`/courses/${COURSE}`));
  assert.equal(transport.sent[1].to, 'buyer@example.org');
});

test('an unpaid completion (ACH pending) grants nothing; the later async_payment_succeeded does', async () => {
  const other = (await app.query(
    `insert into app_user (external_ref, email, display_name) values ('reli_ACHBUYER1', 'ach@example.org', 'Bank Buyer')
     returning id, external_ref, email, display_name, status`)).rows[0];
  const sess = checkoutSession(other.id, { payment_status: 'unpaid', payment_intent: 'pi_test_ach', customer: 'cus_test_ACH' });
  const r1 = await handleStripeEvent({ db: app, redis, learning, event: signedEvent('checkout.session.completed', sess).event });
  assert.equal(r1.status, 'ignored');
  assert.equal(await hasEntitlement(app, other.id, 'course:NC-ORG-001'), false);
  const r2 = await handleStripeEvent({ db: app, redis, learning, event: signedEvent('checkout.session.async_payment_succeeded', { ...sess, payment_status: 'paid' }).event });
  assert.equal(r2.action, 'grant');
  assert.equal(await hasEntitlement(app, other.id, 'course:NC-ORG-001'), true);
});

test('a Core outage at fulfilment defers the enrolment but keeps the grant (access first, enrol on first visit)', async () => {
  const u = (await app.query(
    `insert into app_user (external_ref, email, display_name) values ('reli_COREDOWN1', 'down@example.org', 'Core Down')
     returning id, external_ref, email, display_name, status`)).rows[0];
  const brokenLearning = createLearningService({ db: app, core: { ...core, enroll: async () => { throw new Error('core unreachable'); } } });
  const ev = signedEvent('checkout.session.completed', checkoutSession(u.id, { customer: 'cus_test_DOWN', payment_intent: 'pi_test_down' })).event;
  const r = await handleStripeEvent({ db: app, redis, learning: brokenLearning, event: ev });
  assert.equal(r.action, 'grant');
  assert.equal(r.enrollmentId, null);
  assert.equal(await hasEntitlement(app, u.id, 'course:NC-ORG-001'), true);
  const au = await app.query(`select 1 from audit_event where action = 'billing.enrol_deferred' and reason = $1`, [ev.id]);
  assert.equal(au.rowCount, 1);
});

test('a processing failure rolls the ledger row back so Stripe\'s retry is processed, and is recorded in audit_event', async () => {
  const bad = signedEvent('checkout.session.completed', checkoutSession('00000000-0000-4000-8000-000000000000')).event; // unknown user
  await assert.rejects(() => handleStripeEvent({ db: app, redis, learning, event: bad }), /unknown user/);
  const ledger = await app.query('select 1 from stripe_event where id = $1', [bad.id]);
  assert.equal(ledger.rowCount, 0, 'no ledger row survives a failed processing');
  const au = await app.query(`select 1 from audit_event where action = 'billing.webhook_failed' and object_ref = $1`, [bad.id]);
  assert.equal(au.rowCount, 1);
});

// ---- webhook: refunds and disputes (spec test 8) ------------------------------

test('SPEC TEST 8: a full refund revokes the entitlement through the one path; the very next learner request (course view, lesson completion, attempt start) is denied; partial refunds do not revoke', async () => {
  const key = 'course:NC-ORG-001';
  assert.equal(await hasEntitlement(app, user.id, key), true);
  await redis.set(`ent:${user.id}:${key}`, '1'); // a warm cache entry must be dropped too

  const partial = signedEvent('charge.refunded', { id: 'ch_test_1', object: 'charge', refunded: false, amount: 19900, amount_refunded: 5000,
    payment_intent: 'pi_test_001', metadata: {} }).event;
  const rp = await handleStripeEvent({ db: app, redis, event: partial });
  assert.equal(rp.action, 'partial_refund');
  assert.equal(await hasEntitlement(app, user.id, key), true);

  // no metadata on the charge → resolved through our own ledger by payment_intent
  const full = signedEvent('charge.refunded', { id: 'ch_test_1', object: 'charge', refunded: true, amount: 19900, amount_refunded: 19900,
    payment_intent: 'pi_test_001', metadata: {} }).event;
  const rf = await handleStripeEvent({ db: app, redis, event: full });
  assert.equal(rf.action, 'revoke');
  assert.equal(await hasEntitlement(app, user.id, key), false);
  assert.equal(await redis.get(`ent:${user.id}:${key}`), null, 'cache dropped');
  const rows = await app.query(`select revoked_at, revoke_reason from entitlement where user_id = $1 and key = $2 order by revoked_at desc`, [user.id, key]);
  assert.ok(rows.rows.every(r => r.revoked_at));
  assert.equal(rows.rows[0].revoke_reason, 'refund:ch_test_1');
  // and the same refund event again is a duplicate, not a second revocation
  assert.equal((await handleStripeEvent({ db: app, redis, event: full })).status, 'duplicate');

  // The next request through the learner paths the HTTP routes call
  // (app/api/learn/* and the Dojo pages all go through these) is refused,
  // even though the Core enrolment and the enrollment_link row still exist.
  const { NotEntitledError } = await import('../src/lib/learning.mjs');
  const links = await app.query('select core_enrollment_id from enrollment_link where user_id = $1', [user.id]);
  assert.equal(links.rows.length, 1, 'the Core-side enrolment link is not what gates access');
  const gated = createLearningService({ db: app, core: { ...core,
    getCourse: async () => { throw new Error('the Core must not even be asked'); },
    getLesson: async id => ({ id, course_id: COURSE, status: 'published' }),
    getAssessment: async id => ({ id, course_id: COURSE }),
    completeLesson: async () => { throw new Error('completion must not reach the Core'); },
    startAttempt: async () => { throw new Error('attempt must not reach the Core'); } } });
  await assert.rejects(() => gated.courseView(user, COURSE), NotEntitledError);
  await assert.rejects(() => gated.completeLesson(user, '22222222-2222-4222-8222-222222222222'), NotEntitledError);
  await assert.rejects(() => gated.startAssessment(user, '44444444-4444-4444-8444-444444444444'), NotEntitledError);
  assert.equal((await gated.catalogue(user))[0].entitled, false, 'the Library shows it as purchasable again, never a live link for something owned');
});

test('a dispute revokes immediately (metadata path), and an unmatched dispute is audited, not thrown', async () => {
  const key = 'course:NC-ORG-001';
  await app.query(`insert into entitlement (user_id, key, source) values ($1, $2, 'promo:test')`, [user.id, key]);
  assert.equal(await hasEntitlement(app, user.id, key), true);
  const dispute = signedEvent('charge.dispute.created', { id: 'dp_test_1', object: 'dispute', charge: 'ch_test_9', payment_intent: 'pi_unknown',
    metadata: { user_id: user.id, product_code: 'NC-ORG-001' } }).event;
  const r = await handleStripeEvent({ db: app, redis, event: dispute });
  assert.equal(r.action, 'revoke');
  assert.equal(await hasEntitlement(app, user.id, key), false);

  const stray = signedEvent('charge.dispute.created', { id: 'dp_test_2', object: 'dispute', charge: 'ch_none', payment_intent: 'pi_none', metadata: {} }).event;
  const r2 = await handleStripeEvent({ db: app, redis, event: stray });
  assert.equal(r2.action, 'unmatched');
  const au = await app.query(`select 1 from audit_event where action = 'billing.dispute_unmatched' and object_ref = 'dp_test_2'`);
  assert.equal(au.rowCount, 1);
});

test('unhandled event types are ledgered and ignored; the endpoint subscription list covers what we handle', async () => {
  const r = await handleStripeEvent({ db: app, event: signedEvent('customer.created', { id: 'cus_x', object: 'customer' }).event });
  assert.equal(r.status, 'ignored');
  assert.ok(HANDLED_EVENTS.includes('checkout.session.completed'));
  assert.ok(HANDLED_EVENTS.includes('charge.refunded'));
  assert.ok(HANDLED_EVENTS.includes('charge.dispute.created'));
});

// ---- mail adapter -------------------------------------------------------------

test('mail adapter: every send is logged; failures are logged as failed, never thrown at the caller; bad recipients are refused', async () => {
  const good = createMailer({ db: app, transport: createMemoryTransport(), from: 'RELI <reli@example.test>' });
  const r = await good.send({ userId: user.id, to: 'ada@example.org', ...credentialIssued({ user, product, publicRef: 'LC-ABC-123', rankName: 'Orange' }) });
  assert.equal(r.ok, true);
  const row = (await app.query('select * from email_log where id = $1', [r.logId])).rows[0];
  assert.equal(row.status, 'sent'); assert.equal(row.template, 'credential_issued'); assert.equal(row.to_email, 'ada@example.org');
  assert.match(row.subject, /Orange Belt earned/);

  const broken = createMailer({ db: app, transport: createMemoryTransport({ fail: true }), from: 'RELI <reli@example.test>' });
  const f = await broken.send({ to: 'ada@example.org', ...enrolmentConfirmation({ user, product }) });
  assert.equal(f.ok, false);
  assert.equal((await app.query('select status from email_log where id = $1', [f.logId])).rows[0].status, 'failed');

  await assert.rejects(() => good.send({ to: 'not-an-address', template: 'x', subject: 'y', text: 'z' }), /invalid recipient/);
  const t = receipt({ user, product, amountCents: 19900, currency: 'USD', sessionId: 'cs_1', paidAt: new Date('2026-09-17T12:00:00Z') });
  assert.match(t.text, /Amount paid: \$199\.00/);
  assert.match(t.html, /compliance education, not legal advice/);
});
