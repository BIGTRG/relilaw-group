// POST /api/auth/mfa — completes an MFA-required login using a pending token
// plus either a TOTP code or a recovery code.
import {
  getAuthServices, requestDoor, setSessionCookie, consumePendingMfa,
  json, authError,
} from '@/lib/auth/http.mjs';

export async function POST(request) {
  const door = await requestDoor();
  const { totp, sessions } = getAuthServices();

  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const { pendingToken, method, code } = body ?? {};
  if (!pendingToken || !code) return authError('pendingToken and code are required', 400);

  const pending = await consumePendingMfa(pendingToken);
  if (!pending || pending.door !== door) return authError('Login expired. Start again.');

  let ok = false;
  if (method === 'recovery') {
    ok = await totp.consumeRecoveryCode({ userId: pending.userId, code });
  } else {
    ok = await totp.verifyCode({ userId: pending.userId, code });
  }
  if (!ok) return authError('That code did not verify.');

  const { token } = await sessions.create({
    userId: pending.userId, roles: pending.roles, door, mfaVerified: true,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
  });
  await setSessionCookie(token);
  return json({ ok: true });
}
