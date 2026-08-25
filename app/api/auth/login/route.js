// POST /api/auth/login — email + password. On MFA-required doors the response
// is a pending token; the session is only minted after /api/auth/mfa.
import {
  getAuthServices, requestDoor, setSessionCookie, createPendingMfa,
  canEnterDoor, MFA_REQUIRED_DOORS, json, authError,
} from '@/lib/auth/http.mjs';

export async function POST(request) {
  const door = await requestDoor();
  if (!door) return authError('unknown door', 400);
  const { accounts, totp, sessions } = getAuthServices();

  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const { email, password } = body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return authError('email and password are required', 400);
  }

  let result;
  try {
    result = await accounts.verifyLogin({ email, password });
  } catch (err) {
    if (err.code === 'locked') return authError('Too many attempts. Try again in 15 minutes.', 429);
    throw err;
  }
  if (!result) return authError('Invalid email or password.');

  const { user, roles } = result;
  if (!canEnterDoor(roles, door)) return authError('Your account cannot access this area.', 403);

  if (MFA_REQUIRED_DOORS.has(door)) {
    const enrolled = await totp.isEnrolled(user.id);
    const pendingToken = await createPendingMfa({ userId: user.id, roles, door });
    return json({
      mfaRequired: true,
      pendingToken,
      methods: enrolled ? ['totp', 'recovery', 'passkey'] : ['passkey'],
      totpEnrolled: enrolled,
    });
  }

  const { token } = await sessions.create({
    userId: user.id, roles, door,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
  });
  await setSessionCookie(token);
  return json({ ok: true, displayName: user.display_name });
}
