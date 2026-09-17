// POST /api/billing/checkout — the Library "Buy" button. Classic form post,
// learner session required. Answers 303 to Stripe's hosted Checkout page, or
// back to the Library when there is nothing to sell (already owned, unknown).
import { withLearner, seeOther } from '@/lib/learn-routes.mjs';
import { startCheckout, AlreadyOwnedError, UnknownProductError } from '@/lib/billing/index.mjs';

export async function POST(request) {
  return withLearner(request, async ({ user, form }) => {
    const productCode = String(form.get('product_code') ?? '').trim();
    if (!/^[A-Z0-9-]{3,40}$/.test(productCode)) return seeOther('/library');
    try {
      const { url } = await startCheckout({ user, productCode });
      return seeOther(url);
    } catch (e) {
      if (e instanceof AlreadyOwnedError) return seeOther('/library?owned=1');
      if (e instanceof UnknownProductError) return seeOther('/library');
      console.error('checkout failed', e?.message);
      return seeOther('/library?checkout=failed');
    }
  });
}
