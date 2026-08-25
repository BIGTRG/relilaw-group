// Usernameless passkey sign-in. GET = ceremony options (scope id in a short
// cookie), POST = verify assertion and mint a session. A user-verified
// passkey satisfies MFA on Studio/Console (§11: possession + UV).
import { cookies } from 'next/headers';
import {
  getAuthServices, requestDoor, setSessionCookie, canEnterDoor,
  json, authError,
} from '@/lib/auth/http.mjs';
import { randomBytes } from 'node:crypto';

const SCOPE_COOKIE = '__Host-reli_pkscope';

export async function GET() {
  const { passkeys } = getAuthServices();
  const scopeId = randomBytes(16).toString('base64url');
  const options = await passkeys.beginAuthentication({ scopeId });
  const jar = await cookies();
  jar.set(SCOPE_COOKIE, scopeId, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 300,
  });
  return json(options);
}

export async function POST(request) {
  const door = await requestDoor();
  if (!door) return authError('unknown door', 400);
  const { passkeys, sessions, db } = getAuthServices();
  const jar = await cookies();
  const scopeId = jar.get(SCOPE_COOKIE)?.value;
  if (!scopeId) return authError('Ceremony expired. Start again.');

  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const origin = request.headers.get('origin') ?? '';
  const result = await passkeys.finishAuthentication({ scopeId, response: body, origin });
  if (!result) return authError('Passkey sign-in failed.');

  const { rows } = await db.query(
    `select u.status, u.display_name,
            coalesce(array_agg(rg.role) filter (where rg.role is not null), '{}') as roles
     from app_user u left join role_grant rg on rg.user_id = u.id
     where u.id = $1 group by u.id`, [result.userId]);
  if (!rows[0] || rows[0].status !== 'active') return authError('Account unavailable.', 403);
  if (!canEnterDoor(rows[0].roles, door)) return authError('Your account cannot access this area.', 403);

  const { token } = await sessions.create({
    userId: result.userId, roles: rows[0].roles, door, mfaVerified: result.userVerified,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
  });
  await setSessionCookie(token);
  jar.set(SCOPE_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return json({ ok: true, displayName: rows[0].display_name });
}
