import crypto from 'crypto';

/**
 * Encrypts secrets (provider API keys, connector tokens) before they are stored.
 *
 * AES-256-GCM with a key taken from AI_KEYS_ENCRYPTION_KEY. When that variable is not
 * set the key is derived from JWT_REFRESH_SECRET, so the feature works without extra
 * setup — but rotating that secret then makes stored keys unreadable (users re-enter them).
 */
const VERSION = 'v1';

function masterKey() {
  const explicit = String(process.env.AI_KEYS_ENCRYPTION_KEY || '').trim();
  const source = explicit || String(process.env.JWT_REFRESH_SECRET || '').trim();
  if (!source) {
    const error = new Error(
      'Secret storage is not configured. Set AI_KEYS_ENCRYPTION_KEY (openssl rand -hex 32).',
    );
    error.status = 503;
    throw error;
  }
  if (explicit && /^[0-9a-f]{64}$/i.test(explicit)) return Buffer.from(explicit, 'hex');
  return crypto.createHash('sha256').update(`playground-secrets:${source}`).digest();
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored) {
  const [version, iv, tag, data] = String(stored || '').split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Stored secret has an unknown format');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (cause) {
    if (cause?.status) throw cause;
    const error = new Error('A saved key can no longer be read. Please enter it again.');
    error.status = 409;
    throw error;
  }
}

/** Last four characters, for showing which key is saved without revealing it. */
export function secretHint(plain) {
  const text = String(plain || '');
  return text.length > 8 ? `…${text.slice(-4)}` : '…';
}

/** Stable, non-reversible id for a key — used to tell which key uploaded a custom skill. */
export function secretFingerprint(plain) {
  return crypto.createHash('sha256').update(String(plain || '')).digest('hex').slice(0, 16);
}
