import { getAuthServices, currentSession, clearSessionCookie, json } from '@/lib/auth/http.mjs';

export async function POST() {
  const current = await currentSession();
  if (current) await getAuthServices().sessions.destroy(current.token);
  await clearSessionCookie();
  return json({ ok: true });
}
