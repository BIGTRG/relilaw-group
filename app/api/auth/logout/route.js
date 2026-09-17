import { getAuthServices, currentSession, clearSessionCookie, json } from '@/lib/auth/http.mjs';

export async function POST(request) {
  const current = await currentSession();
  if (current) await getAuthServices().sessions.destroy(current.token);
  await clearSessionCookie();
  // Plain form posts (no JS) get sent back to the sign-in page.
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(null, { status: 303, headers: { location: '/login' } });
  }
  return json({ ok: true });
}
