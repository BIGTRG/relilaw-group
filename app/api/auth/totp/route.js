// TOTP enrollment for the signed-in user.
// POST = begin (returns otpauth URI), PUT = confirm with a live code
// (returns recovery codes, shown once).
import { getAuthServices, currentSession, json, authError } from '@/lib/auth/http.mjs';

export async function POST() {
  const current = await currentSession();
  if (!current) return authError('not signed in');
  const { totp, db } = getAuthServices();
  const { rows } = await db.query(
    `select email from app_user where id = $1`, [current.session.userId]);
  const { otpauthUrl, secret } = await totp.beginEnrollment({
    userId: current.session.userId, email: rows[0].email,
  });
  return json({ otpauthUrl, secret });
}

export async function PUT(request) {
  const current = await currentSession();
  if (!current) return authError('not signed in');
  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const result = await getAuthServices().totp.confirmEnrollment({
    userId: current.session.userId, code: String(body?.code ?? ''),
  });
  if (!result) return authError('That code did not verify.');
  return json(result);
}
