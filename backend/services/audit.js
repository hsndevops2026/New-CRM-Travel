import { query } from '../config/database.js';

/**
 * Append an immutable audit event.
 *
 * @param {object} opts
 * @param {string} opts.entityType  - e.g. 'lead', 'quote', 'dealer'
 * @param {string} [opts.entityId]
 * @param {string} opts.action      - e.g. 'status_changed', 'assigned', 'sent'
 * @param {string} [opts.actorId]   - admin/agent UUID
 * @param {string} [opts.actorRole]
 * @param {object} [opts.before]
 * @param {object} [opts.after]
 */
export async function logAuditEvent({ entityType, entityId, action, actorId, actorRole, before, after }) {
  try {
    await query(
      `INSERT INTO audit_events
         (entity_type, entity_id, action, actor_id, actor_role, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entityType,
        entityId || null,
        action,
        actorId || null,
        actorRole || null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
      ],
    );
  } catch (err) {
    // Audit failure must never break the main flow
    console.error('[audit] Failed to log event:', err.message, { entityType, action });
  }
}

export async function listAuditEvents({ entityType, entityId, limit = 100 } = {}) {
  if (entityType && entityId) {
    const result = await query(
      `SELECT * FROM audit_events
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [entityType, entityId, limit],
    );
    return result.rows;
  }
  if (entityType) {
    const result = await query(
      `SELECT * FROM audit_events WHERE entity_type = $1 ORDER BY created_at DESC LIMIT $2`,
      [entityType, limit],
    );
    return result.rows;
  }
  const result = await query(
    `SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}
