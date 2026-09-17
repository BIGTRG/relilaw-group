// First-time authenticator setup on an MFA-required door.
// The Studio and Console refuse a session without MFA, so a person invited
// there has no way to reach the signed-in TOTP route. This route accepts the
// short-lived pending-MFA token that /api/auth/login issued after a correct
// password on THIS door, and only while the account has no confirmed
// authenticator. Once one is confirmed, this route refuses; changes go
// through the signed-in route.
//   POST { pendingToken }        -> { otpauthUrl, secret }
//   PUT  { pendingToken, code }  -> { recoveryCodes }
import { getAuthServices, requestDoor, json, authError, MFA_REQUIRED_DOORS } from '@/lib/auth/http.mjs';

async function peekPending(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const raw = await getAuthServices().redis.get(`mfapend:${token}`);
  return raw ? JSON.parse(raw) : null;
}

async function guard(request) {
  const door = await requestDoor();
  if (!MFA_REQUIRED_DOORS.has(door)) return { error: authError('not an MFA door', 400) };
  let body;
  try { body = await request.json(); } catch { return { error: authError('invalid body', 400) }; }
  const pending = await peekPending(body?.pendingToken);
  if (!pending || pending.door !== door) return { error: authError('Sign in again to set up your authenticator.') };
  const { totp } = getAuthServices();
  if (await totp.isEnrolled(pending.userId)) return { error: authError('An authenticator is already set up on this account.', 409) };
  return { pending, body };
}

export async function POST(request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { totp, db } = getAuthServices();
  const { rows } = await db.query('select email from app_user where id = $1', [g.pending.userId]);
  const { otpauthUrl, secret } = await totp.beginEnrollment({ userId: g.pending.userId, email: rows[0].email });
  return json({ otpauthUrl, secret });
}

export async function PUT(request) {
  const g = await guard(request);
  if (g.error) return g.error;
  const result = await getAuthServices().totp.confirmEnrollment({ userId: g.pending.userId, code: String(g.body?.code ?? '') });
  if (!result) return authError('That code did not verify.');
  await getAuthServices().db.query(
    `insert into audit_event (actor_user_id, action, object_type, object_ref) values ($1, 'totp.enrolled', 'app_user', $1)`,
    [g.pending.userId]);
  return json(result);
}
