// Passkey registration for the signed-in user.
// GET = ceremony options, POST = verify attestation and store credential.
import { getAuthServices, currentSession, json, authError } from '@/lib/auth/http.mjs';

export async function GET() {
  const current = await currentSession();
  if (!current) return authError('not signed in');
  const { passkeys, db } = getAuthServices();
  const { rows } = await db.query(
    `select email, display_name from app_user where id = $1`, [current.session.userId]);
  const options = await passkeys.beginRegistration({
    userId: current.session.userId,
    email: rows[0].email,
    displayName: rows[0].display_name,
  });
  return json(options);
}

export async function POST(request) {
  const current = await currentSession();
  if (!current) return authError('not signed in');
  let body;
  try { body = await request.json(); } catch { return authError('invalid body', 400); }
  const origin = request.headers.get('origin') ?? '';
  const result = await getAuthServices().passkeys.finishRegistration({
    userId: current.session.userId, response: body, origin,
  });
  if (!result) return authError('Passkey registration failed.');
  return json(result);
}
