// Request-scoped auth context for route handlers: door from Host header,
// service singletons, cookie helpers, pending-MFA tokens.
import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getPool } from '../infra/db.mjs';
import { getRedis } from '../infra/redis.mjs';
import { createAccounts } from './accounts.mjs';
import { createTotp } from './totp.mjs';
import { createPasskeys } from './passkeys.mjs';
import { createSessionStore, COOKIE_NAME, cookieAttributes } from '../session.mjs';
import { canEnterDoor, MFA_REQUIRED_DOORS } from '../permissions.mjs';

const PENDING_TTL_S = 300;

const HOST_DOOR = { 'app.': 'dojo', 'studio.': 'studio', 'admin.': 'console' };

export function doorFromHost(host) {
  if (process.env.DOOR_OVERRIDE) return process.env.DOOR_OVERRIDE;
  const prefix = Object.keys(HOST_DOOR).find(p => host?.startsWith(p));
  return prefix ? HOST_DOOR[prefix] : null;
}

let services;
export function getAuthServices() {
  if (!services) {
    const db = getPool();
    const redis = getRedis();
    const rpId = process.env.RP_ID || 'relilaw.org';
    const origins = (process.env.WEBAUTHN_ORIGINS ||
      'https://app.relilaw.org,https://studio.relilaw.org,https://admin.relilaw.org')
      .split(',').map(s => s.trim());
    services = {
      db, redis,
      accounts: createAccounts({ db, redis }),
      totp: createTotp({ db }),
      passkeys: createPasskeys({ db, redis, rpId, origins }),
      sessions: createSessionStore(redis),
    };
  }
  return services;
}

export async function requestDoor() {
  const h = await headers();
  // After a door rewrite the proxy re-enters with the loopback host and
  // carries the original in x-reli-host (nginx strips it from the outside).
  return doorFromHost(h.get('x-reli-host') ?? h.get('host') ?? '');
}

export async function currentSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const { sessions } = getAuthServices();
  const session = await sessions.get(token);
  return session ? { token, session } : null;
}

export async function setSessionCookie(token) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, cookieAttributes());
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, '', { ...cookieAttributes(), maxAge: 0 });
}

// --- pending-MFA handoff between /login and /mfa -------------------------

export async function createPendingMfa({ userId, roles, door }) {
  const { redis } = getAuthServices();
  const token = randomBytes(32).toString('base64url');
  await redis.set(`mfapend:${token}`, JSON.stringify({ userId, roles, door }),
    'EX', PENDING_TTL_S);
  return token;
}

export async function consumePendingMfa(token) {
  const { redis } = getAuthServices();
  const raw = await redis.getdel(`mfapend:${token}`);
  return raw ? JSON.parse(raw) : null;
}

export const json = (body, status = 200) =>
  Response.json(body, { status });

export const authError = (detail, status = 401) =>
  Response.json({ type: 'about:blank', title: 'Unauthorized', status, detail }, { status });

export { canEnterDoor, MFA_REQUIRED_DOORS };
