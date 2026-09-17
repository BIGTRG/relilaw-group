// Stripe webhook processing (§8). SERVER ONLY.
//
//   verified event ──► stripe_event ledger (insert-if-absent = the idempotency
//   gate; Stripe delivers duplicates and that is not a bug) ──► one of:
//     checkout paid            → grantEntitlement → Core enrol → mail
//     charge fully refunded    → revokeEntitlement
//     dispute opened           → revokeEntitlement
//
// Everything that changes access goes through the two keystone functions.
// The entitlement `source` column records the Stripe event id as data; no
// authorisation path ever reads it (test/grep_ci.mjs guards that).
import { grantEntitlement, revokeEntitlement } from '../entitlements.mjs';
import { entitlementKeyFor } from '../learning.mjs';
import { enrolmentConfirmation, receipt } from '../mail/templates.mjs';

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded', // ACH settles later than the session completes
  'checkout.session.async_payment_failed',
  'charge.refunded',
  'charge.dispute.created',
];

/**
 * Process one verified Stripe event exactly once.
 * @returns {Promise<{status:'duplicate'|'processed'|'ignored', action?:string, entitlementId?:string|null}>}
 */
export async function handleStripeEvent({ db, redis = null, learning = null, mail = null, stripe = null, event }) {
  if (!event?.id || !event?.type) throw new Error('malformed event');
  const client = await db.connect();
  let outcome;
  let afterCommit = null;
  try {
    await client.query('begin');
    // The gate. A concurrent duplicate blocks on this row until we commit,
    // then sees the conflict and leaves as a duplicate.
    const gate = await client.query(
      `insert into stripe_event (id, type, payload) values ($1, $2, $3)
       on conflict (id) do nothing returning id`,
      [event.id, event.type, JSON.stringify(event)]);
    if (gate.rowCount === 0) {
      await client.query('rollback');
      return { status: 'duplicate' };
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (session.payment_status !== 'paid') { outcome = { status: 'ignored', action: `unpaid:${session.payment_status}` }; break; }
        const r = await fulfil({ client, learning, stripe, event, session });
        outcome = { status: 'processed', action: 'grant', ...r };
        afterCommit = r.mailJobs;
        break;
      }
      case 'checkout.session.async_payment_failed': {
        await audit(client, event, 'billing.async_payment_failed', event.data.object.id);
        outcome = { status: 'processed', action: 'noted' };
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        const who = await resolveSubject({ client, stripe, obj: charge, paymentIntent: charge.payment_intent });
        if (!who) { await audit(client, event, 'billing.refund_unmatched', charge.id); outcome = { status: 'processed', action: 'unmatched' }; break; }
        if (charge.refunded !== true) { // partial refund: access stays, staff decide
          await audit(client, event, 'billing.partial_refund', charge.id, who);
          outcome = { status: 'processed', action: 'partial_refund' }; break;
        }
        await revokeEntitlement(client, redis, { userId: who.userId, key: who.key, reason: `refund:${charge.id}` });
        await audit(client, event, 'billing.revoked_refund', charge.id, who);
        outcome = { status: 'processed', action: 'revoke' };
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const who = await resolveSubject({ client, stripe, obj: dispute, paymentIntent: dispute.payment_intent, chargeId: dispute.charge });
        if (!who) { await audit(client, event, 'billing.dispute_unmatched', dispute.id); outcome = { status: 'processed', action: 'unmatched' }; break; }
        await revokeEntitlement(client, redis, { userId: who.userId, key: who.key, reason: `dispute:${dispute.id}` });
        await audit(client, event, 'billing.revoked_dispute', dispute.id, who);
        outcome = { status: 'processed', action: 'revoke' };
        break;
      }
      default:
        outcome = { status: 'ignored', action: 'unhandled_type' };
    }

    await client.query('update stripe_event set processed_at = now() where id = $1', [event.id]);
    await client.query('commit');
  } catch (e) {
    // Roll the ledger row back too: Stripe will retry and we want that retry
    // to be processed, not swallowed as a duplicate.
    await client.query('rollback').catch(() => {});
    await db.query(
      `insert into audit_event (action, object_type, object_ref, reason, meta)
       values ('billing.webhook_failed', 'stripe_event', $1, $2, $3)`,
      [event.id, String(e.message).slice(0, 500), JSON.stringify({ type: event.type })]).catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Mail is best-effort and after commit: a mail outage must never un-grant.
  if (afterCommit && mail) {
    for (const job of afterCommit) {
      try { await mail.send(job); } catch { /* logged as failed in email_log by the mailer */ }
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------

async function fulfil({ client, learning, stripe, event, session }) {
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const code = session.metadata?.product_code;
  if (!userId || !code) throw new Error('checkout session carries no user_id/product_code metadata');
  const { rows: users } = await client.query(
    'select id, external_ref, email, display_name, status from app_user where id = $1', [userId]);
  const user = users[0];
  if (!user) throw new Error(`checkout for unknown user ${userId}`);
  const { rows: products } = await client.query(
    'select code, core_course_id, title, price_cents, currency from product where code = $1', [code]);
  const product = products[0];
  if (!product) throw new Error(`checkout for unknown product ${code}`);

  // Mirror the Stripe customer (the only Stripe id we keep about a person).
  if (typeof session.customer === 'string') {
    const taken = await client.query(
      'select 1 from stripe_customer where stripe_customer_id = $1 and user_id <> $2', [session.customer, user.id]);
    if (taken.rowCount) await audit(client, event, 'billing.customer_shared', session.customer, { userId: user.id });
    else await client.query(
      `insert into stripe_customer (user_id, stripe_customer_id) values ($1, $2)
       on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
      [user.id, session.customer]);
  }

  const key = entitlementKeyFor(product.code);
  const entitlementId = await grantEntitlement(client, { userId: user.id, key, source: `stripe:${event.id}` });
  await audit(client, event, 'billing.granted', session.id, { userId: user.id, key, entitlementId });

  // Core enrolment: idempotent, and re-attempted on the learner's first visit
  // if the Core is unreachable right now. Access is already granted above.
  let enrollmentId = null;
  if (learning) {
    await client.query('savepoint enrol'); // a Core or link failure must not take the grant down with it
    try {
      enrollmentId = await learning.ensureEnrollment(user, product.core_course_id, client);
      await client.query('release savepoint enrol');
    } catch (e) {
      await client.query('rollback to savepoint enrol');
      await audit(client, event, 'billing.enrol_deferred', session.id, { userId: user.id, key, error: String(e.message).slice(0, 300) });
    }
  }

  const amount = session.amount_total ?? product.price_cents;
  const currency = (session.currency ?? product.currency ?? 'usd').toUpperCase();
  const to = user.email ?? session.customer_details?.email;
  const mailJobs = to ? [
    { userId: user.id, to, ...receipt({ user, product, amountCents: amount, currency, sessionId: session.id, paidAt: new Date(event.created * 1000) }) },
    { userId: user.id, to, ...enrolmentConfirmation({ user, product }) },
  ] : [];
  return { entitlementId, enrollmentId, userId: user.id, key, mailJobs };
}

/** Find (userId, key) for a charge or dispute. Metadata first (we stamp the
 *  PaymentIntent at checkout), then our own ledger, then Stripe itself. */
async function resolveSubject({ client, stripe, obj, paymentIntent, chargeId = null }) {
  const fromMeta = m => (m?.user_id && (m.entitlement_key || m.product_code))
    ? { userId: m.user_id, key: m.entitlement_key ?? entitlementKeyFor(m.product_code) } : null;
  let who = fromMeta(obj.metadata);
  if (who) return who;
  const pi = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  if (pi) {
    const { rows } = await client.query(
      `select payload->'data'->'object'->'metadata' as m from stripe_event
        where type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
          and payload->'data'->'object'->>'payment_intent' = $1
        order by received_at desc limit 1`, [pi]);
    who = fromMeta(rows[0]?.m);
    if (who) return who;
  }
  if (stripe && chargeId) {
    const charge = await stripe.charges.retrieve(typeof chargeId === 'string' ? chargeId : chargeId.id);
    who = fromMeta(charge.metadata);
    if (who) return who;
  }
  return null;
}

function audit(client, event, action, objectRef, meta = null) {
  return client.query(
    `insert into audit_event (actor_role, action, object_type, object_ref, reason, meta)
     values ('system', $1, 'stripe_event', $2, $3, $4)`,
    [action, objectRef, event.id, meta ? JSON.stringify(meta) : null]);
}
