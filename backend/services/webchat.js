import { query } from '../config/database.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';

/**
 * Website chat: visitors talk to the same bot as on WhatsApp. The conversation
 * is keyed by the phone number the visitor types, so the lead lands in the CRM
 * like any WhatsApp lead and staff continue on WhatsApp.
 *
 * Phones are not verified (owner's choice). To limit what a stranger typing
 * someone else's number can see, the widget only ever receives the bot replies
 * produced by its own request, never earlier messages or staff replies.
 */

export function normalizeWebPhone(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) {
    // Local mobile numbers: 059/056 are Palestinian (+970), other 05x Israeli (+972).
    digits = (/^05[69]/.test(digits) ? '970' : '972') + digits.slice(1);
  }
  digits = digits.replace(/\D/g, '');
  return /^\d{9,15}$/.test(digits) ? digits : null;
}

export function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
  return name.length >= 2 ? name : null;
}

export async function handleWebChatMessage({ name, phone, text }) {
  const cleanPhone = normalizeWebPhone(phone);
  if (!cleanPhone) {
    const error = new Error('Please enter a valid phone number');
    error.status = 400;
    throw error;
  }
  const visitorName = cleanName(name);
  if (!visitorName) {
    const error = new Error('Please enter your name');
    error.status = 400;
    throw error;
  }
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) {
    const error = new Error('Message is empty');
    error.status = 400;
    throw error;
  }

  // Never overwrite the name staff already have for this number.
  await query(
    `INSERT INTO contacts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`,
    [cleanPhone, visitorName],
  );

  // Postgres clock, so the comparison below does not depend on app/DB clock skew.
  const { rows: [{ started }] } = await query('SELECT NOW() AS started');
  const result = await handleIncomingLeadMessage({
    from: cleanPhone,
    text: body,
    skipWhatsApp: true,
    source: 'web',
    messageMeta: { channel: 'web' },
  });

  // Only what the bot answered during this request (it may send more than one message).
  const { rows } = await query(
    `SELECT body FROM messages
     WHERE direction = 'outbound' AND to_number = $1 AND created_at >= $2
       AND COALESCE(raw->>'actor_id', '') = ''
     ORDER BY created_at ASC, id ASC LIMIT 10`,
    [cleanPhone, started],
  );
  let replies = rows.map((r) => r.body).filter(Boolean);
  if (!replies.length && result?.reply) replies = [result.reply];
  return {
    replies,
    ai_paused: Boolean(result?.ai_paused),
    lead_created: Boolean(result?.complete),
  };
}
