// Composition root for payments: wires Stripe, DB, Redis, learning and mail.
import 'server-only';
import { getStripe, verifyWebhook } from './stripe.mjs';
import { createCheckoutSession, AlreadyOwnedError, UnknownProductError } from './checkout.mjs';
import { handleStripeEvent } from './webhook.mjs';
import { getAuthServices } from '../auth/http.mjs';
import { getLearning } from '../dojo.mjs';
import { getMailer } from '../mail/index.mjs';

export const appBaseUrl = () => process.env.PUBLIC_APP_URL || `https://app.${process.env.DOMAIN || 'relilaw.org'}`;

export async function startCheckout({ user, productCode }) {
  const { db } = getAuthServices();
  return createCheckoutSession({ db, stripe: getStripe(), user, productCode, baseUrl: appBaseUrl() });
}

export async function processWebhook({ rawBody, signature }) {
  const stripe = getStripe();
  const event = verifyWebhook(stripe, rawBody, signature); // throws → caller answers 400
  const { db, redis } = getAuthServices();
  let mail = null;
  try { mail = getMailer(db); } catch { /* SMTP not configured: grants still happen, mail is skipped */ }
  return handleStripeEvent({ db, redis, learning: getLearning(), mail, stripe, event });
}

export { AlreadyOwnedError, UnknownProductError };
