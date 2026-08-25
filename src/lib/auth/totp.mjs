// TOTP enrollment and verification (otplib), secret sealed at rest with the
// app KEK. Recovery codes: 10 one-time codes, stored as sha256 hashes.
import { createHash, randomBytes } from 'node:crypto';
import { generateSecret, generate, verify, generateURI } from 'otplib';
import { sealSecret, openSecret } from '../infra/crypto.mjs';

// ±30s clock-skew tolerance (RFC 6238 §5.2 transmission delay).
const TOLERANCE_S = 30;
const codeOk = async (secret, token) =>
  (await verify({ secret, token, epochTolerance: TOLERANCE_S })).valid === true;

const hashCode = c => createHash('sha256').update(c).digest('hex');

export function createTotp({ db }) {
  return {
    /** Start enrollment: store an unconfirmed sealed secret, return provisioning URI. */
    async beginEnrollment({ userId, email }) {
      const secret = generateSecret(); // base32
      await db.query(
        `insert into totp_secret (user_id, secret_enc) values ($1, $2)
         on conflict (user_id) do update
           set secret_enc = excluded.secret_enc, confirmed_at = null, created_at = now()`,
        [userId, sealSecret(secret)],
      );
      return {
        otpauthUrl: generateURI({ issuer: 'RELI', label: email, secret }),
        secret, // shown once for manual entry; never returned again
      };
    },

    /** Confirm enrollment with a live code; issues recovery codes. */
    async confirmEnrollment({ userId, code }) {
      const { rows } = await db.query(
        `select secret_enc, confirmed_at from totp_secret where user_id = $1`, [userId]);
      if (!rows[0]) return null;
      const secret = openSecret(rows[0].secret_enc);
      if (!(await codeOk(secret, code))) return null;
      await db.query(`update totp_secret set confirmed_at = now() where user_id = $1`, [userId]);

      const codes = Array.from({ length: 10 }, () =>
        randomBytes(5).toString('hex').toUpperCase().match(/.{5}/g).join('-'));
      await db.query(`delete from recovery_code where user_id = $1`, [userId]);
      for (const c of codes) {
        await db.query(
          `insert into recovery_code (user_id, code_hash) values ($1, $2)`,
          [userId, hashCode(c)]);
      }
      return { recoveryCodes: codes };
    },

    async isEnrolled(userId) {
      const { rows } = await db.query(
        `select 1 from totp_secret where user_id = $1 and confirmed_at is not null`, [userId]);
      return rows.length > 0;
    },

    /** Verify a live TOTP code against the confirmed secret. */
    async verifyCode({ userId, code }) {
      const { rows } = await db.query(
        `select secret_enc from totp_secret where user_id = $1 and confirmed_at is not null`,
        [userId]);
      if (!rows[0]) return false;
      return codeOk(openSecret(rows[0].secret_enc), code);
    },

    /** Consume a recovery code (single use, constant on the hash). */
    async consumeRecoveryCode({ userId, code }) {
      const { rowCount } = await db.query(
        `update recovery_code set used_at = now()
         where user_id = $1 and code_hash = $2 and used_at is null`,
        [userId, hashCode(code.trim().toUpperCase())]);
      return rowCount === 1;
    },
  };
}
