// Stripe client at the app edge (§8, §12.2). SERVER ONLY.
// - The key comes from STRIPE_SECRET_KEY, never from code. No account id is
//   written anywhere in this repository (§12.2): the key IS the account.
// - The API version is pinned here and only here.
import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2026-07-29.dahlia';

let client;
export function getStripe() {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: 'reli-app', version: '0.1.0' },
      maxNetworkRetries: 2,
      timeout: 15_000,
    });
  }
  return client;
}

/** Signature verification helper; throws on any mismatch (spec §8). */
export function verifyWebhook(stripe, rawBody, signatureHeader, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  if (!signatureHeader) throw new Stripe.errors.StripeSignatureVerificationError(null, rawBody, { message: 'missing stripe-signature header' });
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}
