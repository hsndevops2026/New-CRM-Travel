import { query } from '../config/database.js';

/**
 * Save an inbound or outbound message to the messages table.
 *
 * direction: 'inbound' | 'outbound'
 * channel:   'whatsapp' | 'email'
 * status:    'received' | 'sent' | 'delivered' | 'failed'
 */
export async function saveMessage({
  leadId,
  conversationId,
  direction = 'inbound',
  channel = 'whatsapp',
  providerId,
  fromNumber,
  toNumber,
  body,
  status = 'received',
  raw = {},
}) {
  const result = await query(
    `INSERT INTO messages
       (lead_id, conversation_id, direction, channel, provider_id, from_number, to_number, body, status, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      leadId || null,
      conversationId || null,
      direction,
      channel,
      providerId || null,
      fromNumber || null,
      toNumber || null,
      body || null,
      status,
      JSON.stringify(raw),
    ],
  );
  return result.rows[0];
}

/** Attach orphan intake messages to a lead once intake completes. */
export async function linkConversationMessagesToLead(conversationId, leadId) {
  if (!conversationId || !leadId) return;
  await query(
    `UPDATE messages
     SET lead_id = $2
     WHERE conversation_id = $1 AND lead_id IS NULL`,
    [conversationId, leadId],
  );
}

export async function listMessagesForLead(leadId, { limit = 200, phone = null } = {}) {
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    const result = await query(
      `SELECT * FROM messages
       WHERE lead_id = $1
          OR (
            lead_id IS NULL
            AND (
              regexp_replace(COALESCE(from_number, ''), '\\D', '', 'g') = $2
              OR regexp_replace(COALESCE(to_number, ''), '\\D', '', 'g') = $2
            )
          )
       ORDER BY created_at ASC
       LIMIT $3`,
      [leadId, digits, limit],
    );
    return result.rows;
  }
  const result = await query(
    `SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [leadId, limit],
  );
  return result.rows;
}

export async function findMessageByProviderId(providerId) {
  if (!providerId) return null;
  const result = await query(
    `SELECT * FROM messages WHERE provider_id = $1 LIMIT 1`,
    [providerId],
  );
  return result.rows[0] || null;
}

export async function updateMessageStatus(id, status) {
  const result = await query(
    `UPDATE messages SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return result.rows[0] || null;
}
