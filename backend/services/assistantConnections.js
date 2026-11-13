import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { query } from '../config/database.js';
import { anthropicConfig } from '../config/anthropic.js';
import { openaiConfig } from '../config/openai.js';
import { decryptSecret, encryptSecret, secretFingerprint, secretHint } from './secretBox.js';

export const PROVIDERS = Object.freeze(['anthropic', 'openai']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw httpError(400, 'Unknown provider');
}

function envKey(provider) {
  return provider === 'anthropic' ? anthropicConfig.apiKey : openaiConfig.apiKey;
}

async function loadRows(adminId) {
  const result = await query(
    `SELECT provider, scope, key_encrypted, key_hint, updated_at
       FROM ai_connections
      WHERE scope = 'agency' OR (scope = 'user' AND admin_id = $1)`,
    [adminId],
  );
  return result.rows;
}

/**
 * The key a user's requests run on: their personal key, else the agency key,
 * else the key from the server environment. Returns null when none exists.
 */
export async function resolveKey(adminId, provider) {
  assertProvider(provider);
  const rows = (await loadRows(adminId)).filter((row) => row.provider === provider);
  const chosen = rows.find((row) => row.scope === 'user') || rows.find((row) => row.scope === 'agency');
  if (chosen) {
    const apiKey = decryptSecret(chosen.key_encrypted);
    return { apiKey, source: chosen.scope, fingerprint: secretFingerprint(apiKey) };
  }
  const fromEnv = envKey(provider);
  if (fromEnv) return { apiKey: fromEnv, source: 'env', fingerprint: secretFingerprint(fromEnv) };
  return null;
}

export async function requireAnthropic(adminId) {
  const key = await resolveKey(adminId, 'anthropic');
  if (!key) throw httpError(409, 'Claude is not connected yet. Add an API key to start.');
  return { client: new Anthropic({ apiKey: key.apiKey }), ...key };
}

export async function requireOpenAIKey(adminId) {
  const key = await resolveKey(adminId, 'openai');
  if (!key) {
    throw httpError(409, 'Image and video generation needs an OpenAI API key. Add one under Connections.');
  }
  return key;
}

/** What the browser may know: which sources exist and a hint of each key — never the key. */
export async function describeConnections(adminId) {
  const rows = await loadRows(adminId);
  const summary = {};
  for (const provider of PROVIDERS) {
    const mine = rows.filter((row) => row.provider === provider);
    const user = mine.find((row) => row.scope === 'user');
    const agency = mine.find((row) => row.scope === 'agency');
    const env = Boolean(envKey(provider));
    summary[provider] = {
      active: user ? 'user' : agency ? 'agency' : env ? 'env' : null,
      user: user ? { hint: user.key_hint, updated_at: user.updated_at } : null,
      agency: agency ? { hint: agency.key_hint, updated_at: agency.updated_at } : null,
      env,
    };
  }
  return summary;
}

/** Ask the provider whether it accepts the key, so a typo is caught before it is saved. */
export async function verifyKey(provider, apiKey) {
  try {
    if (provider === 'anthropic') {
      await new Anthropic({ apiKey, maxRetries: 0 }).models.list({ limit: 1 });
    } else {
      await new OpenAI({ apiKey, maxRetries: 0 }).models.list();
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof OpenAI.AuthenticationError) {
      throw httpError(400, 'That API key was rejected. Check that it was copied in full.');
    }
    if (error instanceof Anthropic.PermissionDeniedError || error instanceof OpenAI.PermissionDeniedError) {
      throw httpError(400, 'That API key does not have permission to be used here.');
    }
    if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
      // The key was recognised but the check itself failed (e.g. a workspace header is
      // needed). Report the provider's own message rather than guessing.
      throw httpError(400, `The key could not be checked: ${error.message}`);
    }
    throw httpError(502, 'Could not reach the provider to check the key. Try again.');
  }
}

export async function saveKey({ provider, scope, adminId, apiKey }) {
  assertProvider(provider);
  if (!['user', 'agency'].includes(scope)) throw httpError(400, 'scope must be user or agency');
  const key = String(apiKey || '').trim();
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) {
    throw httpError(400, 'Enter a valid API key');
  }
  await verifyKey(provider, key);
  const encrypted = encryptSecret(key);
  const hint = secretHint(key);
  if (scope === 'agency') {
    await query(
      `INSERT INTO ai_connections (provider, scope, admin_id, key_encrypted, key_hint, created_by)
       VALUES ($1, 'agency', NULL, $2, $3, $4)
       ON CONFLICT (provider) WHERE scope = 'agency'
       DO UPDATE SET key_encrypted = EXCLUDED.key_encrypted, key_hint = EXCLUDED.key_hint,
                     created_by = EXCLUDED.created_by, updated_at = NOW()`,
      [provider, encrypted, hint, adminId],
    );
  } else {
    await query(
      `INSERT INTO ai_connections (provider, scope, admin_id, key_encrypted, key_hint, created_by)
       VALUES ($1, 'user', $2, $3, $4, $2)
       ON CONFLICT (provider, admin_id) WHERE scope = 'user'
       DO UPDATE SET key_encrypted = EXCLUDED.key_encrypted, key_hint = EXCLUDED.key_hint,
                     updated_at = NOW()`,
      [provider, adminId, encrypted, hint],
    );
  }
}

export async function removeKey({ provider, scope, adminId }) {
  assertProvider(provider);
  if (scope === 'agency') {
    await query(`DELETE FROM ai_connections WHERE provider = $1 AND scope = 'agency'`, [provider]);
  } else if (scope === 'user') {
    await query(
      `DELETE FROM ai_connections WHERE provider = $1 AND scope = 'user' AND admin_id = $2`,
      [provider, adminId],
    );
  } else {
    throw httpError(400, 'scope must be user or agency');
  }
}
