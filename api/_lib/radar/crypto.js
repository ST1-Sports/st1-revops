/**
 * AES-256-GCM encryption for per-user Gmail refresh tokens.
 * Key is SHA-256 of RADAR_TOKEN_KEY or TOKEN_ENCRYPTION_KEY (any long secret works).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function keyBuf() {
  const raw = process.env.RADAR_TOKEN_KEY || process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || String(raw).length < 16) {
    throw new Error('RADAR_TOKEN_KEY or TOKEN_ENCRYPTION_KEY is required (min 16 chars)');
  }
  return createHash('sha256').update(String(raw)).digest();
}

export function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuf(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(packed) {
  const parts = String(packed || '').split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', keyBuf(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
