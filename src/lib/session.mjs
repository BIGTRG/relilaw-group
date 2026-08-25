// Redis-backed sessions. One identity, three doors; a session records which
// door it was opened for and whether MFA was verified. Studio and Console
// sessions are refused without MFA (§2, §11).

import { randomBytes, createHash } from 'node:crypto';
import { MFA_REQUIRED_DOORS, canEnterDoor } from './permissions.mjs';

const SESSION_TTL_S = 60 * 60 * 12;        // 12h absolute
const SESSION_IDLE_S = 60 * 60 * 2;        // 2h rolling idle
export const COOKIE_NAME = '__Host-reli_session';

const hash = t => createHash('sha256').update(t).digest('hex');

export function cookieAttributes() {
  // __Host- prefix: Secure, Path=/, no Domain — bound to the exact host (door).
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
}

export function createSessionStore(redis) {
  const key = id => `sess:${id}`;

  return {
    /** roles must already be verified against the door by the caller. */
    async create({ userId, roles, door, mfaVerified = false, ip }) {
      if (!canEnterDoor(roles, door)) throw new Error('role cannot enter this door');
      if (MFA_REQUIRED_DOORS.has(door) && !mfaVerified) {
        throw new Error('mfa required for this door');
      }
      const token = randomBytes(32).toString('base64url');
      const id = hash(token);
      const session = {
        userId, roles, door, mfaVerified,
        ip: ip ?? null,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      await redis.set(key(id), JSON.stringify(session), 'EX', SESSION_TTL_S);
      return { token, session };
    },

    async get(token) {
      if (!token) return null;
      const id = hash(token);
      const raw = await redis.get(key(id));
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (Date.now() - session.lastSeenAt > SESSION_IDLE_S * 1000) {
        await redis.del(key(id));
        return null;
      }
      session.lastSeenAt = Date.now();
      await redis.set(key(id), JSON.stringify(session), 'KEEPTTL');
      return session;
    },

    async destroy(token) {
      if (token) await redis.del(key(hash(token)));
    },

    async destroyAllForUser(_userId) {
      // Sessions are indexed by token hash only; per-user revocation uses a
      // generation counter checked at get() time. Implemented with the auth
      // routes in M2. Recorded here so it is not forgotten.
      throw new Error('not implemented until auth routes land');
    },
  };
}
