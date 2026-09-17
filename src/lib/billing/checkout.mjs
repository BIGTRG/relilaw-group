// Stripe Checkout, HOSTED (§8). No card form, no PAN data in this app.
// This module is the only place that turns a product into a payment. It asks
// the keystone (hasEntitlement) before selling anything; the keystone never
// asks it anything back.
import { hasEntitlement } from '../entitlements.mjs';
import { entitlementKeyFor } from '../learning.mjs';

/** ACH is the default on anything over $5,000 (§8): card fees on a $45k
 *  invoice are ~$1,305, ACH is ~$5. Default, not an option to discover. */
export const ACH_DEFAULT_THRESHOLD_CENTS = 500_000;

export class AlreadyOwnedError extends Error {
  constructor(code) { super(`already owned: ${code}`); this.name = 'AlreadyOwnedError'; this.code = code; }
}
export class UnknownProductError extends Error {
  constructor(code) { super(`unknown product: ${code}`); this.name = 'UnknownProductError'; this.code = code; }
}

/** Payment methods for an amount. ACH first when the rule applies. */
export function paymentMethodTypesFor(amountCents) {
  return amountCents > ACH_DEFAULT_THRESHOLD_CENTS ? ['us_bank_account', 'card'] : ['card'];
}

/**
 * Pure builder: product row + user -> Checkout Session params. Unit-tested
 * without network. Prices are created inline from the product table (no
 * price ids to keep in sync; the product table is the catalogue).
 */
export function buildCheckoutParams({ product, user, baseUrl, customerId = null }) {
  if (!product?.code) throw new UnknownProductError(product?.code);
  const amount = Number(product.price_cents);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`product ${product.code} has no sellable price`);
  const meta = { product_code: product.code, user_id: user.id, entitlement_key: entitlementKeyFor(product.code) };
  const params = {
    mode: 'payment',
    payment_method_types: paymentMethodTypesFor(amount),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: (product.currency ?? 'usd').toLowerCase(),
        unit_amount: amount,
        product_data: {
          name: product.title,
          description: `${product.code} · Robinson Employment Law Institute`,
          metadata: { product_code: product.code },
        },
      },
    }],
    client_reference_id: user.id,
    metadata: meta,
    payment_intent_data: { metadata: meta }, // so charges (refunds, disputes) carry the same keys
    success_url: `${baseUrl}/library?purchased=1`,
    cancel_url: `${baseUrl}/library`,
    invoice_creation: { enabled: true },
  };
  if (customerId) params.customer = customerId;
  else { params.customer_email = user.email; params.customer_creation = 'always'; }
  return params;
}

/**
 * Create a hosted Checkout Session for a product, or refuse.
 * - Refuses when the user already holds the entitlement (§4.2: never a live
 *   checkout link for something already owned).
 * - Reuses the Stripe customer if one is mirrored for this user.
 * Returns { url, id }.
 */
export async function createCheckoutSession({ db, stripe, user, productCode, baseUrl }) {
  const { rows } = await db.query(
    'select code, title, price_cents, currency from product where code = $1 and active', [productCode]);
  const product = rows[0];
  if (!product) throw new UnknownProductError(productCode);
  if (await hasEntitlement(db, user.id, entitlementKeyFor(product.code))) throw new AlreadyOwnedError(product.code);
  const { rows: cust } = await db.query('select stripe_customer_id from stripe_customer where user_id = $1', [user.id]);
  const params = buildCheckoutParams({ product, user, baseUrl, customerId: cust[0]?.stripe_customer_id ?? null });
  const session = await stripe.checkout.sessions.create(params, {
    // one session per user+product+minute: a double-click does not create two
    idempotencyKey: `checkout:${user.id}:${product.code}:${Math.floor(Date.now() / 60_000)}`,
  });
  return { url: session.url, id: session.id };
}
