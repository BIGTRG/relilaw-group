// AES-256-GCM encryption for secrets at rest (TOTP seeds). Key comes from
// AUTH_KEK: 32 bytes, base64. Output layout: 12-byte IV || 16-byte tag || ct.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function kek() {
  const raw = process.env.AUTH_KEK;
  if (!raw) throw new Error('AUTH_KEK is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('AUTH_KEK must be 32 bytes base64');
  return key;
}

export function sealSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function openSecret(sealed) {
  const buf = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', kek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
