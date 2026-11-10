import { query } from '../config/database.js';
import { getContactById } from './contacts.js';
import { saveMessage } from './messages.js';
import { sendTextMessage } from './wasender.js';

const REMINDER_WITH_CONTACT_SQL = `
  SELECT r.*,
    c.name AS contact_name,
    c.phone AS contact_phone
  FROM contact_reminders r
  JOIN contacts c ON c.id = r.contact_id
`;

function requireText(text) {
  const value = String(text || '').trim();
  if (!value) {
    const error = new Error('text is required');
    error.status = 400;
    throw error;
  }
  return value;
}

function requireRemindAt(remindAt) {
  const value = String(remindAt || '').trim();
  if (!value) {
    const error = new Error('remind_at is required');
    error.status = 400;
    throw error;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('remind_at must be a valid date-time');
    error.status = 400;
    throw error;
  }
  return date.toISOString();
}

/** Customer-facing WhatsApp body, sent at remind_at for reminders with notify_customer. */
export function buildReminderWhatsAppMessage(reminder) {
  const when = new Date(reminder.remind_at);
  const whenLabel = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  const name = String(reminder.contact_name || '').trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const lines = [greeting, '', 'Reminder:', String(reminder.text || '').trim()];
  if (whenLabel) {
    lines.push('', `When: ${whenLabel}`);
  }
  return lines.join('\n');
}

/**
 * Sends the reminder to the contact on WhatsApp and stores it in chat history.
 * Soft-fails (logs) so reminder creation still succeeds if WhatsApp is down.
 */
export async function sendReminderWhatsApp(reminder, { send = sendTextMessage } = {}) {
  const phone = String(reminder?.contact_phone || '').trim();
  if (!phone) return { sent: false, reason: 'no_phone' };

  const text = buildReminderWhatsAppMessage(reminder);
  await send(phone, text);
  await saveMessage({
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: phone,
    body: text,
    status: 'sent',
    raw: {
      kind: 'contact_reminder',
      reminder_id: reminder.id,
      contact_id: reminder.contact_id,
    },
  });
  return { sent: true, text };
}

export async function listRemindersInRange({ from, to, limit = 500 } = {}) {
  const fromIso = from ? new Date(from).toISOString() : null;
  const toIso = to ? new Date(to).toISOString() : null;
  if (!fromIso || !toIso || Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    const error = new Error('from and to must be valid date-times');
    error.status = 400;
    throw error;
  }

  const result = await query(
    `${REMINDER_WITH_CONTACT_SQL}
     WHERE r.remind_at >= $1 AND r.remind_at < $2
     ORDER BY r.remind_at ASC
     LIMIT $3`,
    [fromIso, toIso, Math.min(Math.max(Number(limit) || 500, 1), 1000)],
  );
  return result.rows;
}

export async function listRemindersForContact(contactId, { limit = 200 } = {}) {
  const result = await query(
    `${REMINDER_WITH_CONTACT_SQL}
     WHERE r.contact_id = $1
     ORDER BY r.remind_at DESC
     LIMIT $2`,
    [contactId, Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  return result.rows;
}

export async function getReminderById(id) {
  const result = await query(`${REMINDER_WITH_CONTACT_SQL} WHERE r.id = $1`, [id]);
  return result.rows[0] || null;
}

export async function createReminder(
  contactId,
  { text, remind_at, notify_customer = false },
  createdBy = null,
) {
  const contact = await getContactById(contactId);
  if (!contact) {
    const error = new Error('Contact not found');
    error.status = 404;
    throw error;
  }

  const reminderText = requireText(text);
  const remindAt = requireRemindAt(remind_at);

  // Reminders are internal notes for staff by default. The customer only gets a
  // WhatsApp message when the employee opts in, and only at remind_at (see
  // sendDueCustomerReminders), never at creation time.
  const result = await query(
    `INSERT INTO contact_reminders (contact_id, text, remind_at, created_by, notify_customer)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [contactId, reminderText, remindAt, createdBy, notify_customer === true],
  );
  return getReminderById(result.rows[0].id);
}

/**
 * Sends every customer-facing reminder whose time has come and that has not been
 * sent yet. Each row is claimed with a conditional UPDATE first, so two workers
 * running the sweep at once never send the same reminder twice. A failed send
 * releases the claim so the next sweep retries it.
 */
export async function sendDueCustomerReminders({
  now = new Date(),
  limit = 50,
  sendWhatsApp = sendReminderWhatsApp,
} = {}) {
  const due = await query(
    `SELECT id FROM contact_reminders
     WHERE notify_customer = TRUE AND sent_at IS NULL AND done_at IS NULL AND remind_at <= $1
     ORDER BY remind_at ASC
     LIMIT $2`,
    [now.toISOString(), limit],
  );
  const results = [];
  for (const { id } of due.rows) {
    const claim = await query(
      `UPDATE contact_reminders SET sent_at = NOW()
       WHERE id = $1 AND sent_at IS NULL
       RETURNING id`,
      [id],
    );
    if (!claim.rowCount) continue;
    const reminder = await getReminderById(id);
    try {
      const outcome = await sendWhatsApp(reminder);
      results.push({ id, ...outcome });
    } catch (err) {
      await query(`UPDATE contact_reminders SET sent_at = NULL WHERE id = $1`, [id]);
      console.error('[reminders] scheduled WhatsApp send failed:', err.message);
      results.push({ id, sent: false, reason: 'send_failed' });
    }
  }
  return results;
}

export async function updateReminder(id, { text, remind_at, done, notify_customer } = {}) {
  const existing = await getReminderById(id);
  if (!existing) return null;

  const nextText = text !== undefined ? requireText(text) : existing.text;
  const nextRemindAt = remind_at !== undefined ? requireRemindAt(remind_at) : existing.remind_at;
  const nextNotify = notify_customer !== undefined ? notify_customer === true : existing.notify_customer === true;
  let nextDoneAt = existing.done_at;
  if (done === true) nextDoneAt = existing.done_at || new Date().toISOString();
  if (done === false) nextDoneAt = null;

  const result = await query(
    `UPDATE contact_reminders
     SET text = $2, remind_at = $3, done_at = $4, notify_customer = $5
     WHERE id = $1
     RETURNING id`,
    [id, nextText, nextRemindAt, nextDoneAt, nextNotify],
  );
  if (!result.rows[0]) return null;
  return getReminderById(result.rows[0].id);
}

export async function deleteReminder(id) {
  const result = await query(`DELETE FROM contact_reminders WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}
