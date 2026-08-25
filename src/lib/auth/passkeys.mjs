// Passkeys via SimpleWebAuthn. RP ID is the parent domain (relilaw.org) so a
// single passkey works on all three doors. Challenges live in Redis, 5 min,
// single use.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const CHALLENGE_TTL_S = 300;

export function createPasskeys({ db, redis, rpId, rpName = 'RELI', origins }) {
  const chKey = (kind, scope) => `wanchal:${kind}:${scope}`;

  return {
    async beginRegistration({ userId, email, displayName }) {
      const { rows } = await db.query(
        `select credential_id, transports from passkey_credential where user_id = $1`, [userId]);
      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userName: email,
        userDisplayName: displayName,
        attestationType: 'none',
        excludeCredentials: rows.map(r => ({
          id: Buffer.from(r.credential_id).toString('base64url'),
          transports: r.transports,
        })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      });
      await redis.set(chKey('reg', userId), options.challenge, 'EX', CHALLENGE_TTL_S);
      return options;
    },

    async finishRegistration({ userId, response, origin }) {
      const expectedChallenge = await redis.getdel(chKey('reg', userId));
      if (!expectedChallenge) return null;
      if (!origins.includes(origin)) return null;
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });
      if (!verification.verified) return null;
      const { credential } = verification.registrationInfo;
      await db.query(
        `insert into passkey_credential (user_id, credential_id, public_key, counter, transports)
         values ($1, $2, $3, $4, $5)`,
        [userId,
         Buffer.from(credential.id, 'base64url'),
         Buffer.from(credential.publicKey),
         credential.counter,
         credential.transports ?? []]);
      return { verified: true };
    },

    /** Usernameless: discoverable-credential authentication. */
    async beginAuthentication({ scopeId }) {
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: 'preferred',
      });
      await redis.set(chKey('auth', scopeId), options.challenge, 'EX', CHALLENGE_TTL_S);
      return options;
    },

    /** Returns { userId } on success, null on failure. Enforces counter monotonicity. */
    async finishAuthentication({ scopeId, response, origin }) {
      const expectedChallenge = await redis.getdel(chKey('auth', scopeId));
      if (!expectedChallenge) return null;
      if (!origins.includes(origin)) return null;
      const credentialId = Buffer.from(response.rawId, 'base64url');
      const { rows } = await db.query(
        `select user_id, public_key, counter, transports from passkey_credential
         where credential_id = $1`, [credentialId]);
      if (!rows[0]) return null;
      const stored = rows[0];
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          id: response.rawId,
          publicKey: new Uint8Array(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
      if (!verification.verified) return null;
      const newCounter = verification.authenticationInfo.newCounter;
      if (newCounter !== 0 && newCounter <= Number(stored.counter)) return null; // clone signal
      await db.query(
        `update passkey_credential set counter = $2, last_used_at = now()
         where credential_id = $1`, [credentialId, newCounter]);
      return {
        userId: stored.user_id,
        userVerified: verification.authenticationInfo.userVerified === true,
      };
    },
  };
}
