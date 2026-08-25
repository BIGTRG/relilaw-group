// POST /api/auth/signup — learner self-signup, Dojo door only. Studio and
// Console accounts are provisioned by staff, never self-created.
import {
  getAuthServices, requestDoor, setSessionCookie, json, authError,
} from '@/lib/auth/http.mjs';

export async function POST(request) {
  const door = await requestDoor();
  if (door !== 'dojo') return authError('Signup is only available in the Dojo.', 403);
  const { accounts, sessions } = getAuthServices();

  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const { email, displayName, password } = body ?? {};
  if (typeof email !== 'string' || !email.includes('@') ||
      typeof displayName !== 'string' || displayName.trim().length < 1 ||
      typeof password !== 'string') {
    return authError('email, displayName and password are required', 400);
  }

  let user;
  try {
    user = await accounts.createUser({
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      password,
    });
  } catch (err) {
    if (err.code === 'email_taken') return authError('That email is already registered.', 409);
    if (err.code === 'weak_password') return authError('Password must be at least 12 characters.', 400);
    throw err;
  }

  const { token } = await sessions.create({
    userId: user.id, roles: ['learner'], door,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
  });
  await setSessionCookie(token);
  return json({ ok: true, displayName: user.display_name }, 201);
}
