import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';
import { sendTextMessage } from './wasender.js';
import { findWidgetById, getWebchatSettings, resolveChat, touchWidget } from './webchatSettings.js';

/**
 * Website chat: visitors talk to the same bot as on WhatsApp. The conversation
 * is keyed by the phone number the visitor types, so the lead lands in the CRM
 * like any WhatsApp lead and staff continue on WhatsApp.
 *
 * A chat is a session: the widget gets a random token when it starts, and every
 * later call carries it. With "verify phone" on, the session must first be
 * confirmed with a code sent to that number on WhatsApp.
 *
 * To limit what a stranger typing someone else's number can see, the widget only
 * receives the bot replies produced by its own request, and staff replies only
 * in a confirmed session, and only those sent after it was confirmed.
 */

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_SESSION = 3;
export const CODE_RESEND_SECONDS = 60;
const SESSION_DAYS = 30;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

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

const hashToken = (token) => crypto.createHash('sha256').update(`webchat:${token}`).digest('hex');
const hashCode = (sessionId, code) => crypto.createHash('sha256').update(`webchat-code:${sessionId}:${code}`).digest('hex');

function cleanUrl(value, max = 1000) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString().slice(0, max);
  } catch {
    return null;
  }
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

/** Where the visitor came from: the page, the referring site and campaign tags. */
export function cleanAttribution(input = {}, origin = null) {
  const page = cleanUrl(input.page_url);
  const out = {};
  if (origin) out.site = String(origin).slice(0, 200);
  if (page) out.page_url = page;
  const referrer = cleanUrl(input.referrer);
  if (referrer) out.referrer = referrer;
  const title = String(input.page_title || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
  if (title) out.page_title = title;
  // Campaign tags from the widget, else from the page address itself.
  const fromPage = page ? new URL(page).searchParams : new URLSearchParams();
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = String(input.utm?.[key] || fromPage.get(key) || '').trim().slice(0, 200);
    if (value) utm[key] = value;
  }
  if (Object.keys(utm).length) out.utm = utm;
  return out;
}

const CODE_TEXT = {
  ar: (code) => `رمز التحقق للمحادثة على موقعنا: ${code}\nصالح لمدة ${CODE_TTL_MINUTES} دقائق. إذا لم تطلبه، تجاهل هذه الرسالة.`,
  en: (code) => `Your website chat code is ${code}.\nIt is valid for ${CODE_TTL_MINUTES} minutes. If you did not ask for it, ignore this message.`,
};

export const webchatDeps = {
  sendCode: (phone, text) => sendTextMessage(phone, text),
  handleLead: (input) => handleIncomingLeadMessage(input),
};

async function sendCode(session, language) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await webchatDeps.sendCode(session.phone, (CODE_TEXT[language] || CODE_TEXT.ar)(code));
  } catch (error) {
    console.error('[webchat] could not send the WhatsApp code:', error.message);
    throw httpError(503, 'We could not send a code to this number on WhatsApp. Check the number and try again.');
  }
  await query(
    `UPDATE webchat_sessions
     SET code_hash = $2, code_expires_at = NOW() + INTERVAL '${CODE_TTL_MINUTES} minutes',
         code_attempts = 0, codes_sent = codes_sent + 1, code_sent_at = NOW()
     WHERE id = $1`,
    [session.id, hashCode(session.id, code)],
  );
}

/** Starts a chat. Returns the token the widget keeps; it is never stored in plain text. */
export async function startWebChatSession({ name, phone, origin = null, attribution = {}, language = 'ar', key = null }) {
  const { effective: settings, widget } = await resolveChat(key);
  if (!settings.enabled) throw httpError(403, 'The chat is switched off');
  const cleanPhone = normalizeWebPhone(phone);
  if (!cleanPhone) throw httpError(400, 'Please enter a valid phone number');
  const visitorName = cleanName(name);
  if (!visitorName) throw httpError(400, 'Please enter your name');

  const token = crypto.randomBytes(32).toString('base64url');
  const { rows } = await query(
    `INSERT INTO webchat_sessions (token_hash, phone, name, origin, attribution, verified_at, widget_id)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN NULL ELSE NOW() END, $7)
     RETURNING *`,
    [hashToken(token), cleanPhone, visitorName, origin ? String(origin).slice(0, 200) : null,
      JSON.stringify({
        ...cleanAttribution(attribution, origin),
        // Whose chat it was, so the lead page can say so even if the key changes later.
        ...(widget ? { chat_owner: { id: widget.owner_id, email: widget.owner_email } } : {}),
      }),
      settings.verify_phone, widget?.id || null],
  );
  const session = rows[0];
  if (widget) void touchWidget(widget.id);
  // Old sessions are not needed: a visitor who comes back after a month starts again.
  void query(`DELETE FROM webchat_sessions WHERE last_seen_at < NOW() - INTERVAL '${SESSION_DAYS} days'`).catch(() => {});

  if (settings.verify_phone) {
    try {
      await sendCode(session, language);
    } catch (error) {
      await query(`DELETE FROM webchat_sessions WHERE id = $1`, [session.id]);
      throw error;
    }
  }
  return { token, verified: !settings.verify_phone, needs_code: settings.verify_phone, phone: cleanPhone };
}

export async function findSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await query(
    `UPDATE webchat_sessions SET last_seen_at = NOW()
     WHERE token_hash = $1 AND last_seen_at > NOW() - INTERVAL '${SESSION_DAYS} days'
     RETURNING *`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

async function requireSession(token) {
  const session = await findSession(token);
  if (!session) throw httpError(401, 'This chat has ended. Please start again.', 'session_expired');
  return session;
}

export async function verifyWebChatCode({ token, code }) {
  const session = await requireSession(token);
  if (session.phone_confirmed) return { verified: true };
  const digits = String(code || '').replace(/\D/g, '');
  if (session.code_attempts >= MAX_CODE_ATTEMPTS) throw httpError(429, 'Too many wrong codes. Ask for a new code.');
  if (!session.code_hash || new Date(session.code_expires_at) < new Date()) {
    throw httpError(400, 'This code has expired. Ask for a new code.');
  }
  const expected = Buffer.from(session.code_hash, 'hex');
  const given = Buffer.from(hashCode(session.id, digits), 'hex');
  if (digits.length !== 6 || !crypto.timingSafeEqual(expected, given)) {
    await query(`UPDATE webchat_sessions SET code_attempts = code_attempts + 1 WHERE id = $1`, [session.id]);
    throw httpError(400, 'That code is not right. Please check it and try again.');
  }
  await query(
    `UPDATE webchat_sessions
     SET verified_at = NOW(), phone_confirmed = TRUE, code_hash = NULL, code_expires_at = NULL
     WHERE id = $1`,
    [session.id],
  );
  return { verified: true };
}

export async function resendWebChatCode({ token, language = 'ar' }) {
  const session = await requireSession(token);
  if (session.phone_confirmed) return { verified: true };
  if (session.codes_sent >= MAX_CODES_PER_SESSION) throw httpError(429, 'No more codes for this chat. Please start again.');
  if (session.code_sent_at && Date.now() - new Date(session.code_sent_at).getTime() < CODE_RESEND_SECONDS * 1000) {
    throw httpError(429, `Please wait a minute before asking for a new code.`);
  }
  await sendCode(session, language);
  return { sent: true };
}

/**
 * The chat a session belongs to, checked again on every message: an admin may
 * switch a user's chat off, or the user's account may be blocked, mid-conversation.
 */
async function sessionChat(session) {
  const settings = await getWebchatSettings();
  if (!session.widget_id) return { settings, enabled: settings.enabled, ownerId: null };
  const widget = await findWidgetById(session.widget_id);
  return {
    settings,
    enabled: settings.enabled && Boolean(widget?.enabled && widget?.owner_active),
    ownerId: widget?.owner_id || null,
  };
}

async function runBot({ phone, name, text, session = null, ownerId = null }) {
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) throw httpError(400, 'Message is empty');

  // Never overwrite the name staff already have for this number.
  await query(
    `INSERT INTO contacts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`,
    [phone, name],
  );

  // Postgres clock, so the comparison below does not depend on app/DB clock skew.
  const { rows: [{ started }] } = await query('SELECT NOW() AS started');
  const result = await webchatDeps.handleLead({
    from: phone,
    text: body,
    skipWhatsApp: true,
    source: 'web',
    messageMeta: { channel: 'web', ...(session ? { webchat_session_id: session.id } : {}) },
    ownerId,
  });

  // A lead created in this chat remembers where the visitor came from.
  const leadId = result?.lead?.id || null;
  if (leadId && session) {
    await query(`UPDATE leads SET web_attribution = $2 WHERE id = $1 AND web_attribution IS NULL`, [leadId, JSON.stringify(session.attribution || {})]);
    await query(`UPDATE webchat_sessions SET lead_id = $2 WHERE id = $1`, [session.id, leadId]);
  }

  // Only what the bot answered during this request (it may send more than one message).
  const { rows } = await query(
    `SELECT body FROM messages
     WHERE direction = 'outbound' AND to_number = $1 AND created_at >= $2
       AND COALESCE(raw->>'actor_id', '') = ''
     ORDER BY created_at ASC, id ASC LIMIT 10`,
    [phone, started],
  );
  let replies = rows.map((r) => r.body).filter(Boolean);
  if (!replies.length && result?.reply) replies = [result.reply];
  return {
    replies,
    ai_paused: Boolean(result?.ai_paused),
    lead_created: Boolean(result?.complete) || Boolean(leadId),
  };
}

/** A message in a started (and, when required, confirmed) chat. */
export async function handleSessionMessage({ token, text, language = 'ar' }) {
  const session = await requireSession(token);
  const { settings, enabled, ownerId } = await sessionChat(session);
  if (!enabled) throw httpError(403, 'The chat is switched off');
  // Phone checks may have been switched on after this chat started: confirm the number now.
  const needsCode = !session.verified_at || (settings.verify_phone && !session.phone_confirmed);
  if (needsCode) {
    if (!session.codes_sent) await sendCode(session, language).catch(() => {});
    throw httpError(403, 'Please enter the code we sent you on WhatsApp first.', 'needs_code');
  }
  if (session.widget_id) void touchWidget(session.widget_id);
  return runBot({ phone: session.phone, name: session.name, text, session, ownerId });
}

/**
 * Older widget versions (still cached on some sites for a few minutes) send the
 * name and phone with every message. Allowed only while phone checks are off.
 */
export async function handleWebChatMessage({ name, phone, text }) {
  const settings = await getWebchatSettings();
  if (!settings.enabled) throw httpError(403, 'The chat is switched off');
  if (settings.verify_phone) throw httpError(409, 'Please reload the page to start the chat again.', 'session_required');
  const cleanPhone = normalizeWebPhone(phone);
  if (!cleanPhone) throw httpError(400, 'Please enter a valid phone number');
  const visitorName = cleanName(name);
  if (!visitorName) throw httpError(400, 'Please enter your name');
  return runBot({ phone: cleanPhone, name: visitorName, text });
}

/**
 * Staff replies for a confirmed chat: messages a team member sent to this number
 * after the chat was confirmed. Returned oldest first, with a cursor for the next call.
 */
export async function webChatUpdates({ token, after = null }) {
  const [settings, session] = await Promise.all([getWebchatSettings(), requireSession(token)]);
  if (!settings.verify_phone || !settings.show_staff_replies || !session.phone_confirmed) {
    return { messages: [], cursor: after || null, enabled: false };
  }
  // The cursor is microseconds since 1970, so no message is skipped or repeated.
  const cursor = /^\d{1,20}$/.test(String(after || '')) ? String(after) : null;
  const { rows } = await query(
    `SELECT id, body, created_at, (EXTRACT(EPOCH FROM created_at) * 1000000)::bigint::text AS us
     FROM messages
     WHERE direction = 'outbound' AND to_number = $1 AND created_at > $2
       AND ($3::bigint IS NULL OR (EXTRACT(EPOCH FROM created_at) * 1000000)::bigint > $3::bigint)
       AND COALESCE(raw->>'actor_id', '') <> ''
       AND COALESCE(raw->>'kind', 'customer') = 'customer'
     ORDER BY created_at ASC, id ASC LIMIT 20`,
    [session.phone, session.verified_at, cursor],
  );
  const messages = rows.filter((r) => r.body).map((r) => ({ id: r.id, text: r.body, at: r.created_at }));
  const last = rows[rows.length - 1];
  return { messages, cursor: last ? last.us : cursor, enabled: true };
}
