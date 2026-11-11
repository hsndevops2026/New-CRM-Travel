import { query } from '../config/database.js';
import { logAuditEvent } from './audit.js';

/**
 * Human takeover of a customer's WhatsApp chat. The pause is stored per phone
 * number, not per conversation, so it survives the bot's idle timeout: while an
 * agent is handling a customer, a new conversation must not restart the bot.
 */

export function normalizeHandoverPhone(phone) {
  return String(phone || '').replace(/@.*$/, '').replace(/[^\d+]/g, '');
}

// Customer phrases that ask for a person. Matched on the whole message, case
// and Arabic diacritics ignored, so "I want an agent" or "بدي احكي مع حدا" both count.
const HUMAN_REQUEST_PATTERNS = [
  /\b(human|agent|person|representative|real person|someone)\b/i,
  /موظف/, /مندوب/, /انسان|إنسان/, /بدي\s*احكي\s*مع\s*حد/, /بدي\s*أحكي\s*مع\s*حد/,
  /اريد\s*التحدث\s*مع/, /أريد\s*التحدث\s*مع/, /خدمة\s*العملاء/,
];

export function isHumanRequest(text) {
  const value = String(text || '').normalize('NFKC').replace(/[ً-ْ]/g, '').trim();
  if (!value || value.length > 120) return false;
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasArabic(text) {
  return /[؀-ۿ]/.test(String(text || ''));
}

function autoResumeMs(env = process.env) {
  const hours = Number(env.AI_AUTO_RESUME_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : null;
}

export async function getAiHandover(phone, { now = new Date(), env = process.env } = {}) {
  const key = normalizeHandoverPhone(phone);
  if (!key) return { phone: key, paused: false };
  const { rows } = await query(
    `SELECT h.*, a.email AS paused_by_email
     FROM ai_handover h LEFT JOIN admins a ON a.id = h.paused_by
     WHERE h.phone = $1`,
    [key],
  );
  const row = rows[0];
  if (!row || !row.paused) return { phone: key, paused: false };

  const limit = autoResumeMs(env);
  if (limit && now.getTime() - new Date(row.paused_at).getTime() > limit) {
    await resumeAi(key, { actorId: null, reason: 'auto_resume' });
    return { phone: key, paused: false, auto_resumed: true };
  }
  return {
    phone: key,
    paused: true,
    paused_by: row.paused_by,
    paused_by_email: row.paused_by_email || null,
    paused_at: row.paused_at,
    reason: row.reason,
  };
}

/** Pauses the bot (or refreshes paused_at when an agent keeps replying). */
export async function pauseAi(phone, { actorId = null, actorRole = null, reason = 'manual' } = {}) {
  const key = normalizeHandoverPhone(phone);
  if (!key) return null;
  const { rows } = await query(
    `INSERT INTO ai_handover (phone, paused, paused_by, paused_at, reason, updated_at)
     VALUES ($1, TRUE, $2, NOW(), $3, NOW())
     ON CONFLICT (phone) DO UPDATE
       SET paused = TRUE,
           paused_by = COALESCE(EXCLUDED.paused_by, ai_handover.paused_by),
           paused_at = NOW(),
           reason = CASE WHEN ai_handover.paused THEN ai_handover.reason ELSE EXCLUDED.reason END,
           updated_at = NOW()
     RETURNING *, (xmax = 0) AS inserted`,
    [key, actorId, reason],
  );
  const row = rows[0];
  await logAuditEvent({
    entityType: 'ai_handover', entityId: null, action: 'ai_paused',
    actorId, actorRole, after: { phone: key, reason },
  }).catch(() => {});
  return row;
}

export async function resumeAi(phone, { actorId = null, actorRole = null, reason = 'manual' } = {}) {
  const key = normalizeHandoverPhone(phone);
  if (!key) return null;
  const { rows } = await query(
    `UPDATE ai_handover SET paused = FALSE, resumed_at = NOW(), updated_at = NOW()
     WHERE phone = $1 AND paused = TRUE RETURNING *`,
    [key],
  );
  if (rows[0]) {
    await logAuditEvent({
      entityType: 'ai_handover', entityId: null, action: 'ai_resumed',
      actorId, actorRole, after: { phone: key, reason },
    }).catch(() => {});
  }
  return rows[0] || null;
}
