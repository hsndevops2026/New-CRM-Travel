import { pool, query } from '../config/database.js';
import { normalizeModel, normalizeSettings } from './assistantRequest.js';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const CONVERSATION_COLUMNS =
  'id, admin_id, title, model, settings, container_id, config_hash, thinking_cutoff, created_at, updated_at';

export function publicConversation(row) {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    settings: normalizeSettings(row.settings || {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function publicMessage(row) {
  return {
    seq: Number(row.seq),
    role: row.role,
    content: row.content,
    meta: row.meta || {},
    created_at: row.created_at,
  };
}

export async function listConversations(adminId, { limit = 100 } = {}) {
  const result = await query(
    `SELECT ${CONVERSATION_COLUMNS} FROM assistant_conversations
      WHERE admin_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [adminId, limit],
  );
  return result.rows;
}

export async function createConversation(adminId, { model, settings } = {}) {
  const result = await query(
    `INSERT INTO assistant_conversations (admin_id, model, settings)
     VALUES ($1, $2, $3) RETURNING ${CONVERSATION_COLUMNS}`,
    [adminId, normalizeModel(model), JSON.stringify(normalizeSettings(settings))],
  );
  return result.rows[0];
}

/** A conversation is only ever visible to the user who owns it. */
export async function getConversation(adminId, id) {
  const result = await query(
    `SELECT ${CONVERSATION_COLUMNS} FROM assistant_conversations WHERE id = $1 AND admin_id = $2`,
    [id, adminId],
  );
  if (!result.rows[0]) throw httpError(404, 'Conversation not found');
  return result.rows[0];
}

export async function updateConversation(adminId, id, patch = {}) {
  const current = await getConversation(adminId, id);
  const title =
    typeof patch.title === 'string' && patch.title.trim()
      ? patch.title.trim().slice(0, 120)
      : current.title;
  const model = patch.model ? normalizeModel(patch.model) : current.model;
  const settings = patch.settings ? normalizeSettings(patch.settings) : normalizeSettings(current.settings);
  const result = await query(
    `UPDATE assistant_conversations
        SET title = $3, model = $4, settings = $5
      WHERE id = $1 AND admin_id = $2 RETURNING ${CONVERSATION_COLUMNS}`,
    [id, adminId, title, model, JSON.stringify(settings)],
  );
  return result.rows[0];
}

/** Internal bookkeeping after a turn; never driven directly by client input. */
export async function setConversationState(id, fields = {}) {
  const sets = ['updated_at = NOW()'];
  const values = [id];
  for (const key of ['title', 'container_id', 'config_hash', 'thinking_cutoff']) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      values.push(fields[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  await query(`UPDATE assistant_conversations SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function deleteConversation(adminId, id) {
  const result = await query(
    `DELETE FROM assistant_conversations WHERE id = $1 AND admin_id = $2`,
    [id, adminId],
  );
  if (!result.rowCount) throw httpError(404, 'Conversation not found');
}

export async function listMessages(conversationId) {
  const result = await query(
    `SELECT seq, role, content, meta, created_at FROM assistant_messages
      WHERE conversation_id = $1 ORDER BY seq`,
    [conversationId],
  );
  return result.rows;
}

export async function maxMessageSeq(conversationId) {
  const result = await query(
    `SELECT COALESCE(MAX(seq), 0) AS seq FROM assistant_messages WHERE conversation_id = $1`,
    [conversationId],
  );
  return Number(result.rows[0].seq);
}

/**
 * Append messages in one transaction, so a tool call is never stored without its
 * result (which would make the conversation impossible to continue).
 */
export async function appendMessages(conversationId, messages) {
  if (!messages.length) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = [];
    for (const message of messages) {
      const result = await client.query(
        `INSERT INTO assistant_messages (conversation_id, role, content, meta)
         VALUES ($1, $2, $3, $4) RETURNING seq, role, content, meta, created_at`,
        [conversationId, message.role, JSON.stringify(message.content), JSON.stringify(message.meta || {})],
      );
      rows.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Media ─────────────────────────────────────────────────────────────────────────────

const MEDIA_COLUMNS =
  'id, admin_id, conversation_id, kind, provider, model, prompt, options, status, provider_job_id, url, mime, access_token, error, created_at, updated_at, (data IS NOT NULL) AS has_data';

export function publicMedia(row) {
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    // Files kept in the database are served through an unguessable link.
    url: row.url || (row.has_data ? `/api/assistant/assets/${row.id}/${row.access_token}` : null),
    mime: row.mime,
    error: row.error,
    created_at: row.created_at,
  };
}

export async function createMedia(fields) {
  const result = await query(
    `INSERT INTO assistant_media
       (admin_id, conversation_id, kind, provider, model, prompt, options, status, provider_job_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${MEDIA_COLUMNS}`,
    [
      fields.adminId,
      fields.conversationId || null,
      fields.kind,
      fields.provider,
      fields.model || null,
      fields.prompt,
      JSON.stringify(fields.options || {}),
      fields.status || 'pending',
      fields.providerJobId || null,
    ],
  );
  return result.rows[0];
}

export async function setMediaJob(id, providerJobId) {
  const result = await query(
    `UPDATE assistant_media SET provider_job_id = $2, updated_at = NOW()
      WHERE id = $1 RETURNING ${MEDIA_COLUMNS}`,
    [id, providerJobId],
  );
  return result.rows[0];
}

export async function finishMedia(id, { url = null, mime = null, data = null }) {
  const result = await query(
    `UPDATE assistant_media
        SET status = 'ready', url = $2, mime = $3, data = $4, error = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING ${MEDIA_COLUMNS}`,
    [id, url, mime, data],
  );
  return result.rows[0];
}

export async function failMedia(id, message) {
  const result = await query(
    `UPDATE assistant_media SET status = 'failed', error = $2, updated_at = NOW()
      WHERE id = $1 RETURNING ${MEDIA_COLUMNS}`,
    [id, String(message || 'Generation failed').slice(0, 500)],
  );
  return result.rows[0];
}

export async function getMedia(adminId, id) {
  const result = await query(
    `SELECT ${MEDIA_COLUMNS} FROM assistant_media WHERE id = $1 AND admin_id = $2`,
    [id, adminId],
  );
  if (!result.rows[0]) throw httpError(404, 'Media not found');
  return result.rows[0];
}

export async function listConversationMedia(conversationId) {
  const result = await query(
    `SELECT ${MEDIA_COLUMNS} FROM assistant_media WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return result.rows;
}

/** Public asset lookup: the token in the link is the only credential. */
export async function getMediaAsset(id, token) {
  const result = await query(
    `SELECT mime, data FROM assistant_media
      WHERE id = $1 AND access_token = $2 AND data IS NOT NULL`,
    [id, token],
  );
  return result.rows[0] || null;
}

// ── Add-ons ───────────────────────────────────────────────────────────────────────────

export async function listAddons(adminId) {
  const result = await query(
    `SELECT id, scope, admin_id, kind, name, config, secret_encrypted, created_at
       FROM assistant_addons
      WHERE scope = 'agency' OR (scope = 'user' AND admin_id = $1)
      ORDER BY created_at`,
    [adminId],
  );
  return result.rows;
}

export async function createAddon({ scope, adminId, kind, name, config, secretEncrypted = null }) {
  const result = await query(
    `INSERT INTO assistant_addons (scope, admin_id, kind, name, config, secret_encrypted, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, scope, admin_id, kind, name, config, secret_encrypted, created_at`,
    [scope, scope === 'user' ? adminId : null, kind, name, JSON.stringify(config), secretEncrypted, adminId],
  );
  return result.rows[0];
}

export async function getAddon(id) {
  const result = await query(
    `SELECT id, scope, admin_id, kind, name, config, secret_encrypted, created_at
       FROM assistant_addons WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function deleteAddon(id) {
  await query(`DELETE FROM assistant_addons WHERE id = $1`, [id]);
}
