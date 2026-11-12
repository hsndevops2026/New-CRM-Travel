import { query } from '../config/database.js';

/**
 * In-app notifications for staff. Each row stores a kind and its data; the
 * dashboard turns them into text in the employee's language.
 *
 * Kinds: new_lead, customer_waiting (customer wrote while the AI is paused),
 * human_requested, quote_accepted, reminder_due.
 *
 * Repeats collapse: while an employee has an unread notification of the same
 * kind for the same lead, a new event bumps its count and time instead of
 * adding another row.
 */

export const NOTIFICATION_KINDS = ['new_lead', 'customer_waiting', 'human_requested', 'quote_accepted', 'reminder_due', 'task_assigned', 'task_due', 'quote_approval_needed', 'quote_reviewed', 'travellers_submitted', 'traveller_message', 'quote_viewed', 'lead_waiting', 'low_rating', 'deadline_soon', 'deadline_passed'];

async function approvedAdmins() {
  const { rows } = await query(
    `SELECT id FROM admins WHERE role = 'admin' AND COALESCE(approval_status, 'approved') = 'approved'`,
  );
  return rows.map((r) => r.id);
}

/** Employees assigned to the lead; nobody assigned → all admins. `withAdmins` adds admins anyway. */
export async function leadRecipients(leadId, { withAdmins = false } = {}) {
  const assigned = leadId
    ? (await query(
        `SELECT ul.user_id FROM user_leads ul JOIN admins a ON a.id = ul.user_id
         WHERE ul.lead_id = $1 AND COALESCE(a.approval_status, 'approved') = 'approved'`,
        [leadId],
      )).rows.map((r) => r.user_id)
    : [];
  const admins = withAdmins || !assigned.length ? await approvedAdmins() : [];
  return [...new Set([...assigned, ...admins])];
}

export async function notify({ adminIds, kind, leadId = null, contactId = null, data = {}, collapse = true }) {
  if (!NOTIFICATION_KINDS.includes(kind)) throw new Error(`Unknown notification kind ${kind}`);
  const ids = [...new Set((adminIds || []).filter(Boolean))];
  for (const adminId of ids) {
    if (collapse && leadId) {
      const { rowCount } = await query(
        `UPDATE notifications SET count = count + 1, data = $4, created_at = NOW()
         WHERE admin_id = $1 AND kind = $2 AND lead_id = $3 AND read_at IS NULL`,
        [adminId, kind, leadId, data],
      );
      if (rowCount) continue;
    }
    await query(
      `INSERT INTO notifications (admin_id, kind, lead_id, contact_id, data) VALUES ($1, $2, $3, $4, $5)`,
      [adminId, kind, leadId, contactId, data],
    );
  }
  return ids.length;
}

/** Never let a notification problem break the action that triggered it. */
export async function safeNotify(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('[notifications]', error.message);
    return 0;
  }
}

async function leadInfo(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.phone, l.destination, l.source, COALESCE(c.name, '') AS customer_name
     FROM leads l LEFT JOIN contacts c ON c.phone = l.phone WHERE l.id = $1`,
    [leadId],
  );
  return rows[0] || null;
}

export async function notifyNewLead(leadId) {
  const lead = await leadInfo(leadId);
  if (!lead) return 0;
  return notify({
    adminIds: await leadRecipients(lead.id, { withAdmins: true }),
    kind: 'new_lead',
    leadId: lead.id,
    collapse: false,
    data: { customer: lead.customer_name || lead.phone, destination: lead.destination || '', source: lead.source || '' },
  });
}

/** Latest lead for a phone (the conversation may not be linked to one yet). */
async function latestLeadForPhone(phone) {
  const { rows } = await query(
    `SELECT id FROM leads WHERE regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
     ORDER BY created_at DESC LIMIT 1`,
    [String(phone || '')],
  );
  return rows[0]?.id || null;
}

export async function notifyCustomerMessage(phone, { text = '', humanRequested = false } = {}) {
  const leadId = await latestLeadForPhone(phone);
  const lead = leadId ? await leadInfo(leadId) : null;
  const { rows } = await query(`SELECT name FROM contacts WHERE regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g') LIMIT 1`, [String(phone || '')]);
  return notify({
    adminIds: await leadRecipients(leadId),
    kind: humanRequested ? 'human_requested' : 'customer_waiting',
    leadId,
    data: { customer: lead?.customer_name || rows[0]?.name || String(phone), phone: String(phone), preview: String(text).slice(0, 140) },
  });
}

export async function notifyQuoteAccepted(leadId, { acceptedBy = '' } = {}) {
  const lead = await leadInfo(leadId);
  if (!lead) return 0;
  return notify({
    adminIds: await leadRecipients(lead.id, { withAdmins: true }),
    kind: 'quote_accepted',
    leadId: lead.id,
    collapse: false,
    data: { customer: acceptedBy || lead.customer_name || lead.phone, destination: lead.destination || '' },
  });
}

/**
 * Staff side of reminders: when a reminder's time comes, the employee who
 * created it (or the admins) gets a notification once. Claimed per row.
 */
export async function notifyDueReminders({ now = new Date(), limit = 100 } = {}) {
  const { rows } = await query(
    `UPDATE contact_reminders r SET staff_notified_at = NOW()
     WHERE r.id IN (
       SELECT id FROM contact_reminders
       WHERE staff_notified_at IS NULL AND done_at IS NULL AND remind_at <= $1
       ORDER BY remind_at LIMIT $2
     ) AND r.staff_notified_at IS NULL
     RETURNING r.id, r.contact_id, r.text, r.remind_at, r.created_by`,
    [now.toISOString(), limit],
  );
  let sent = 0;
  for (const r of rows) {
    const { rows: c } = await query(`SELECT name FROM contacts WHERE id = $1`, [r.contact_id]);
    const recipients = r.created_by ? [r.created_by] : await approvedAdmins();
    sent += await notify({
      adminIds: recipients,
      kind: 'reminder_due',
      contactId: r.contact_id,
      collapse: false,
      data: { customer: c[0]?.name || '', text: String(r.text || '').slice(0, 200), remind_at: r.remind_at },
    });
  }
  return sent;
}

export async function listNotifications(adminId, { limit = 50 } = {}) {
  const [{ rows }, unread] = await Promise.all([
    query(
      `SELECT id, kind, lead_id, contact_id, data, count, read_at, created_at
       FROM notifications WHERE admin_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [adminId, Math.min(Number(limit) || 50, 100)],
    ),
    query(`SELECT COUNT(*)::int AS n FROM notifications WHERE admin_id = $1 AND read_at IS NULL`, [adminId]),
  ]);
  return { notifications: rows, unread: unread.rows[0].n };
}

export async function markRead(adminId, { ids, all = false } = {}) {
  if (all) {
    await query(`UPDATE notifications SET read_at = NOW() WHERE admin_id = $1 AND read_at IS NULL`, [adminId]);
    return;
  }
  const valid = (Array.isArray(ids) ? ids : []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
  if (!valid.length) return;
  await query(
    `UPDATE notifications SET read_at = NOW() WHERE admin_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
    [adminId, valid],
  );
}

/** Keep the table small: read notifications older than 60 days go. */
export async function pruneNotifications() {
  await query(`DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '60 days'`);
}
