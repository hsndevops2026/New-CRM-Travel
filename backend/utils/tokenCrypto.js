import crypto from 'node:crypto';

/**
 * AES-256-GCM for OAuth tokens at rest. The key is derived from
 * EMAIL_TOKEN_ENCRYPTION_KEY with SHA-256, so any long random value works.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function key(env = process.env) {
  const secret = String(env.EMAIL_TOKEN_ENCRYPTION_KEY || '');
  if (secret.length < 16) {
    const error = new Error('EMAIL_TOKEN_ENCRYPTION_KEY is not set');
    error.status = 503;
    throw error;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plainText, env) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key(env), iv);
  const data = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(payload, env) {
  const [iv, tag, data] = String(payload || '').split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key(env), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
