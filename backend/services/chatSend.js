import { query } from '../config/database.js';
import { normalizeGroupJid, sendTextMessage } from './wasender.js';
import { saveMessage } from './messages.js';
import { getLeadById } from './leads.js';

function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export async function sendCustomerMessage({ leadId, phone, body, actorId }) {
  const text = String(body || '').trim();
  if (!text) httpErr(400, 'body is required');

  let lead = null;
  let targetPhone = phone ? String(phone).replace(/[^\d+]/g, '') : null;

  if (leadId) {
    lead = await getLeadById(leadId);
    if (!lead) httpErr(404, 'Lead not found');
    targetPhone = lead.phone;
  }

  if (!targetPhone) httpErr(400, 'No phone number for this conversation');

  await sendTextMessage(targetPhone, text);

  const message = await saveMessage({
    leadId: lead?.id || null,
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: targetPhone,
    body: text,
    status: 'sent',
    raw: { kind: 'customer', actor_id: actorId || null },
  });

  return { message, lead };
}

export async function sendDealerMessage({ dealerRequestId, body, actorId }) {
  const text = String(body || '').trim();
  if (!text) httpErr(400, 'body is required');

  const result = await query(
    `SELECT dreq.*, d.name AS dealer_name, d.phone AS dealer_phone,
            d.whatsapp_group_id, dreq.lead_id
     FROM dealer_requests dreq
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     WHERE dreq.id = $1 LIMIT 1`,
    [dealerRequestId],
  );
  const row = result.rows[0];
  if (!row) httpErr(404, 'Dealer request not found');

  const sendTo = row.whatsapp_group_jid || row.whatsapp_group_id || row.dealer_phone;
  if (!sendTo) httpErr(400, 'Dealer has no WhatsApp destination');

  await sendTextMessage(sendTo, text);

  const message = await saveMessage({
    leadId: row.lead_id,
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: sendTo,
    body: text,
    status: 'sent',
    raw: {
      kind: 'dealer_agent_reply',
      request_code: row.request_code,
      dealer_request_id: row.id,
      actor_id: actorId || null,
    },
  });

  return { message, dealer_request: row };
}

export async function sendGroupMessage({ groupJid, body, actorId }) {
  const text = String(body || '').trim();
  if (!text) httpErr(400, 'body is required');

  const jid = normalizeGroupJid(groupJid) || String(groupJid || '').trim();
  if (!jid) httpErr(400, 'Group id is required');

  await sendTextMessage(jid, text);

  const message = await saveMessage({
    direction: 'outbound',
    channel: 'whatsapp',
    toNumber: jid,
    body: text,
    status: 'sent',
    raw: { kind: 'group', group_jid: jid, actor_id: actorId || null },
  });

  return { message };
}
