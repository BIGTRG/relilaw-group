// POST /api/auth/logout-all — revokes every session for the signed-in user
// (generation counter bump), including this one.
import { getAuthServices, currentSession, clearSessionCookie, json, authError } from '@/lib/auth/http.mjs';

export async function POST() {
  const current = await currentSession();
  if (!current) return authError('not signed in');
  await getAuthServices().sessions.destroyAllForUser(current.session.userId);
  await clearSessionCookie();
  return json({ ok: true });
}
