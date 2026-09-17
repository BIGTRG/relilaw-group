// The clean 429. Pages in the App Router cannot set a 429 status, so the
// verify page redirects here once the per-IP limit trips; this handler owns
// the status code, the Retry-After header and the self-contained document.
import { limitedResponse } from '@/lib/verify.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const after = Number(new URL(request.url).searchParams.get('after')) || 60;
  return limitedResponse({ retryAfter: Math.min(600, Math.max(1, after)) });
}
