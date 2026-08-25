// Password hashing: argon2id with OWASP-current parameters.
import argon2 from 'argon2';

const PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = pw => argon2.hash(pw, PARAMS);
export const verifyPassword = (hash, pw) => argon2.verify(hash, pw);

// Minimum requirements: length only (NIST 800-63B — no composition rules),
// checked server-side; a breached-password check lands with the auth routes.
export function passwordAcceptable(pw) {
  return typeof pw === 'string' && pw.length >= 12 && pw.length <= 512;
}
