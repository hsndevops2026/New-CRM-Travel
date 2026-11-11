import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { decrypt, encrypt } from '../utils/tokenCrypto.js';

/**
 * Gmail for staff, ported from the Insurance CRM (connect with Google, several
 * accounts with one default, read inbox, read a message, send). Uses Google's
 * REST endpoints directly instead of the googleapis package.
 */

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const STATE_TTL_MINUTES = 10;

function httpErr(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export function googleConfig(env = process.env) {
  const cfg = {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || '',
  };
  return { ...cfg, configured: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri) };
}

function requireConfig(env) {
  const cfg = googleConfig(env);
  if (!cfg.configured) throw httpErr(503, 'Gmail is not configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
  return cfg;
}

// ── OAuth ──────────────────────────────────────────────────────────────────────

/** One-time state stored server-side (the dashboard uses Bearer tokens, not cookies). */
export async function createAuthUrl(adminId, env = process.env) {
  const cfg = requireConfig(env);
  const state = crypto.randomBytes(24).toString('hex');
  await query(`DELETE FROM email_oauth_states WHERE created_at < NOW() - INTERVAL '${STATE_TTL_MINUTES} minutes'`);
  await query(`INSERT INTO email_oauth_states (state, admin_id) VALUES ($1, $2)`, [state, adminId]);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Returns the admin id the state was issued to, and deletes it (single use). */
export async function consumeState(state) {
  if (!/^[0-9a-f]{48}$/.test(String(state || ''))) return null;
  const { rows } = await query(
    `DELETE FROM email_oauth_states
     WHERE state = $1 AND created_at > NOW() - INTERVAL '${STATE_TTL_MINUTES} minutes'
     RETURNING admin_id`,
    [state],
  );
  return rows[0]?.admin_id || null;
}

async function tokenRequest(body, fetchImpl) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw httpErr(data.error === 'invalid_grant' ? 409 : 502, data.error_description || data.error || 'Google token request failed',
      data.error === 'invalid_grant' ? 'reauth_required' : undefined);
  }
  return data;
}

export async function connectAccount({ code, adminId, env = process.env, fetchImpl = fetch }) {
  const cfg = requireConfig(env);
  const tokens = await tokenRequest({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
  }, fetchImpl);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw httpErr(502, 'Google did not return a refresh token (consent was not granted)');
  }
  const me = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await me.json().catch(() => ({}));
  if (!me.ok || !profile.email) throw httpErr(502, 'Google did not return an email address for this account');

  const expiry = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000);
  const { rows } = await query(
    `INSERT INTO email_accounts (admin_id, email, access_token_enc, refresh_token_enc, token_expiry, is_default)
     VALUES ($1, $2, $3, $4, $5, NOT EXISTS (SELECT 1 FROM email_accounts WHERE admin_id = $1))
     ON CONFLICT (admin_id, email) DO UPDATE
       SET access_token_enc = EXCLUDED.access_token_enc,
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           token_expiry = EXCLUDED.token_expiry,
           updated_at = NOW()
     RETURNING id, email, is_default`,
    [adminId, String(profile.email).toLowerCase(), encrypt(tokens.access_token, env), encrypt(tokens.refresh_token, env), expiry],
  );
  return rows[0];
}

// ── Accounts ───────────────────────────────────────────────────────────────────

export async function listAccounts(adminId) {
  const { rows } = await query(
    `SELECT id, email, is_default, created_at FROM email_accounts WHERE admin_id = $1 ORDER BY created_at ASC`,
    [adminId],
  );
  return rows;
}

export async function getOwnedAccount(adminId, accountId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(accountId || ''))) return null;
  const { rows } = await query(`SELECT * FROM email_accounts WHERE id = $1 AND admin_id = $2`, [accountId, adminId]);
  return rows[0] || null;
}

export async function defaultAccount(adminId) {
  const { rows } = await query(
    `SELECT * FROM email_accounts WHERE admin_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [adminId],
  );
  return rows[0] || null;
}

export async function setDefaultAccount(adminId, accountId) {
  const account = await getOwnedAccount(adminId, accountId);
  if (!account) return false;
  await query(`UPDATE email_accounts SET is_default = (id = $2), updated_at = NOW() WHERE admin_id = $1`, [adminId, accountId]);
  return true;
}

export async function disconnectAccount(adminId, accountId) {
  const { rows } = await query(
    `DELETE FROM email_accounts WHERE id = $1 AND admin_id = $2 RETURNING is_default`,
    [accountId, adminId],
  );
  if (!rows[0]) return false;
  if (rows[0].is_default) {
    await query(
      `UPDATE email_accounts SET is_default = TRUE
       WHERE id = (SELECT id FROM email_accounts WHERE admin_id = $1 ORDER BY created_at ASC LIMIT 1)`,
      [adminId],
    );
  }
  return true;
}

// ── Gmail calls ────────────────────────────────────────────────────────────────

/** A valid access token, refreshed and saved when it is about to expire. */
async function accessToken(account, { env = process.env, fetchImpl = fetch } = {}) {
  if (new Date(account.token_expiry).getTime() - Date.now() > 60_000) {
    return decrypt(account.access_token_enc, env);
  }
  const cfg = requireConfig(env);
  const tokens = await tokenRequest({
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
    refresh_token: decrypt(account.refresh_token_enc, env), grant_type: 'refresh_token',
  }, fetchImpl);
  const expiry = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000);
  await query(
    `UPDATE email_accounts SET access_token_enc = $2, token_expiry = $3,
       refresh_token_enc = COALESCE($4, refresh_token_enc), updated_at = NOW()
     WHERE id = $1`,
    [account.id, encrypt(tokens.access_token, env), expiry, tokens.refresh_token ? encrypt(tokens.refresh_token, env) : null],
  );
  return tokens.access_token;
}

async function gmail(account, path, { method = 'GET', body, env, fetchImpl = fetch } = {}) {
  const token = await accessToken(account, { env, fetchImpl });
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw httpErr(409, 'Gmail access expired, connect the account again', 'reauth_required');
  if (!res.ok) throw httpErr(res.status === 400 || res.status === 404 ? res.status : 502, data?.error?.message || 'Gmail request failed');
  return data;
}

const header = (headers, name) => (headers || []).find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';

function summary(message) {
  const headers = message.payload?.headers;
  const labels = message.labelIds || [];
  return {
    id: message.id,
    threadId: message.threadId,
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date'),
    snippet: message.snippet || '',
    isUnread: labels.includes('UNREAD'),
    isSent: labels.includes('SENT'),
  };
}

function walkParts(part, acc) {
  if (part.filename && part.body?.attachmentId) {
    acc.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      size: part.body.size || 0,
      attachmentId: part.body.attachmentId,
    });
    return;
  }
  if (part.mimeType === 'text/plain' && part.body?.data && !acc.text) acc.text = Buffer.from(part.body.data, 'base64url').toString('utf8');
  else if (part.mimeType === 'text/html' && part.body?.data && !acc.html) acc.html = Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const child of part.parts || []) walkParts(child, acc);
}

/** Gmail search for mail sent to or received from an address, across the whole mailbox. */
export function addressQuery(value) {
  const v = String(value || '').trim().replace(/["()]/g, '');
  return v ? `(from:"${v}" OR to:"${v}")` : undefined;
}

export async function listMessages(account, { pageToken, q, env, fetchImpl } = {}) {
  const params = new URLSearchParams({ maxResults: '25' });
  if (pageToken) params.set('pageToken', String(pageToken));
  if (q) params.set('q', q);
  else params.set('labelIds', 'INBOX');
  const list = await gmail(account, `messages?${params}`, { env, fetchImpl });
  const messages = await Promise.all(
    (list.messages || []).map(async (m) => {
      const meta = new URLSearchParams({ format: 'metadata' });
      for (const h of ['From', 'To', 'Subject', 'Date']) meta.append('metadataHeaders', h);
      return summary(await gmail(account, `messages/${encodeURIComponent(m.id)}?${meta}`, { env, fetchImpl }));
    }),
  );
  return { messages, nextPageToken: list.nextPageToken || null };
}

export async function getMessage(account, id, { env, fetchImpl } = {}) {
  const data = await gmail(account, `messages/${encodeURIComponent(id)}?format=full`, { env, fetchImpl });
  const acc = { text: null, html: null, attachments: [] };
  if (data.payload) walkParts(data.payload, acc);
  return { ...summary(data), body: { text: acc.text, html: acc.html }, attachments: acc.attachments };
}

export async function getAttachment(account, messageId, attachmentId, { env, fetchImpl } = {}) {
  const data = await gmail(
    account,
    `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { env, fetchImpl },
  );
  return Buffer.from(String(data.data || ''), 'base64url');
}

export function buildRawMessage({ from, to, subject, body }) {
  if (/[\r\n]/.test(String(to)) || /[\r\n]/.test(String(subject || ''))) {
    throw httpErr(400, 'Invalid characters in recipient or subject');
  }
  const encodedSubject = `=?UTF-8?B?${Buffer.from(String(subject || ''), 'utf8').toString('base64')}?=`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');
  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

export async function sendMessage(account, { to, subject, body }, { env, fetchImpl } = {}) {
  const recipient = String(to || '').trim();
  if (!recipient || !String(body || '').trim()) throw httpErr(400, 'to and body are required');
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) throw httpErr(400, 'Enter one valid email address');
  const raw = buildRawMessage({ from: account.email, to: recipient, subject, body: String(body) });
  const data = await gmail(account, 'messages/send', { method: 'POST', body: { raw }, env, fetchImpl });
  return { id: data.id, threadId: data.threadId };
}
