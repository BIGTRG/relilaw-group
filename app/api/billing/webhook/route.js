// POST /api/billing/webhook — Stripe → RELI. Raw body, verified signature,
// processed exactly once per event.id. Unverified payloads are rejected
// without being read any further. Answers fast; the work is small.
import { processWebhook } from '@/lib/billing/index.mjs';

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  let result;
  try {
    result = await processWebhook({ rawBody, signature });
  } catch (e) {
    if (e?.type === 'StripeSignatureVerificationError' || /STRIPE_WEBHOOK_SECRET/.test(e?.message ?? '')) {
      return Response.json({ error: 'signature verification failed' }, { status: 400 });
    }
    console.error('webhook processing failed', e?.message);
    return Response.json({ error: 'processing failed' }, { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true, ...result }, { status: 200 });
}

export async function GET() {
  return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
}
