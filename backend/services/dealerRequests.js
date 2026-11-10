import { query } from '../config/database.js';
import OpenAI from 'openai';
import { openaiConfig } from '../config/openai.js';
import { sendTextMessage, normalizeGroupJid, listWhatsAppGroups } from './wasender.js';
import { getDealerById } from './dealers.js';
import { getLeadById, tryAutoTransitionLifecycle } from './leads.js';
import { saveMessage } from './messages.js';

import { extractDealerRequestCode } from '../utils/dealerReply.js';
import { pickBestDealerOffer } from './dealerRank.js';
import { rememberWhatsAppGroup } from './whatsappGroups.js';

const client = openaiConfig.apiKey ? new OpenAI({ apiKey: openaiConfig.apiKey }) : null;

// ── Request code generation ────────────────────────────────────────────────

function generateRequestCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'REQ-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function uniqueRequestCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRequestCode();
    const existing = await query(`SELECT id FROM dealer_requests WHERE request_code = $1`, [code]);
    if (!existing.rows.length) return code;
  }
  throw new Error('Failed to generate unique request code');
}

// ── RFQ message formatting ─────────────────────────────────────────────────

function formatRfqMessage(lead, requestCode, deadline) {
  const lines = [];
  lines.push(`*Travel RFQ — ${requestCode}*`);
  lines.push('');

  if (lead.booking_type === 'flight') {
    lines.push(`Type: Flight`);
    if (lead.origin) lines.push(`From: ${lead.origin}`);
  } else if (lead.booking_type === 'package') {
    lines.push(`Type: Flight + Hotel Package`);
    if (lead.origin) lines.push(`From: ${lead.origin}`);
  } else {
    lines.push(`Type: Hotel`);
  }

  if (lead.destination) lines.push(`To/Destination: ${lead.destination}`);
  if (lead.travel_date) lines.push(`Check-in / Depart: ${lead.travel_date}`);
  if (lead.return_date) lines.push(`Check-out / Return: ${lead.return_date}`);
  if (lead.nights) lines.push(`Nights: ${lead.nights}`);

  const adults = lead.adults_count ?? 2;
  const children = lead.children_count ?? 0;
  lines.push(`Guests: ${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`);

  if (lead.hotel_name) lines.push(`Preferred hotel: ${lead.hotel_name}`);
  if (lead.notes) lines.push(`Notes: ${lead.notes}`);

  lines.push('');
  if (deadline) {
    lines.push(`Please reply by: ${String(deadline).slice(0, 16).replace('T', ' ')} UTC`);
  }
  lines.push(`Reply with this code: *${requestCode}*`);
  lines.push('');
  lines.push('Reply format: hotel name, room type, price per night, total, cancellation terms, validity.');

  return lines.join('\n');
}

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export { pickBestDealerOffer };

async function aiPickBestOffer(offers) {
  const fallback = pickBestDealerOffer(offers);
  if (!fallback) return null;
  if (!client || offers.length < 2) return fallback;

  try {
    const payload = offers.map((row) => {
      const ext = row.extracted || {};
      return {
        id: row.id,
        hotel: ext.hotel_name,
        room: ext.room_type,
        board: ext.board_name,
        total: ext.total_price,
        per_night: ext.price_per_night,
        currency: ext.currency,
        cancellation: ext.cancellation_terms,
        validity: ext.validity,
      };
    });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Pick the best travel dealer offer for an agency. Prefer lower total price, then included meals, then flexible cancellation. Return JSON {"id":"...","reason":"one sentence"}.',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    if (!offers.some((row) => String(row.id) === String(parsed.id))) return fallback;
    return {
      id: parsed.id,
      reason: String(parsed.reason || fallback.reason),
    };
  } catch (error) {
    console.error('[dealerRank] AI pick failed:', error.message);
    return fallback;
  }
}

export async function rankDealerOffersForLead(leadId) {
  if (!leadId) return null;
  const result = await query(
    `SELECT dr.id, dr.extracted
     FROM dealer_responses dr
     JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id
     WHERE dreq.lead_id = $1 AND dr.review_status <> 'rejected'`,
    [leadId],
  );
  const pick = await aiPickBestOffer(result.rows);
  await query(
    `UPDATE dealer_responses dr
     SET is_recommended = FALSE
     FROM dealer_requests dreq
     WHERE dr.dealer_request_id = dreq.id AND dreq.lead_id = $1`,
    [leadId],
  );
  if (!pick) return null;
  await query(
    `UPDATE dealer_responses
     SET is_recommended = TRUE, ai_rank_reason = $2
     WHERE id = $1`,
    [pick.id, pick.reason],
  );
  return pick;
}

export async function confirmBestDealerResponse({ responseId, reviewerId }) {
  const found = await query(
    `SELECT dr.*, dreq.lead_id
     FROM dealer_responses dr
     JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id
     WHERE dr.id = $1 LIMIT 1`,
    [responseId],
  );
  const row = found.rows[0];
  if (!row) return null;

  await query(
    `UPDATE dealer_responses dr
     SET is_best = (dr.id = $2),
         best_confirmed_at = CASE WHEN dr.id = $2 THEN NOW() ELSE NULL END,
         review_status = CASE WHEN dr.id = $2 THEN 'approved' ELSE review_status END,
         reviewed_by = CASE WHEN dr.id = $2 THEN $3 ELSE reviewed_by END,
         reviewed_at = CASE WHEN dr.id = $2 THEN NOW() ELSE reviewed_at END
     FROM dealer_requests dreq
     WHERE dr.dealer_request_id = dreq.id AND dreq.lead_id = $1`,
    [row.lead_id, responseId, reviewerId || null],
  );

  if (row.lead_id) void tryAutoTransitionLifecycle(row.lead_id, 'dealer_response_ready');

  const updated = await query(
    `SELECT dr.*, dreq.request_code, dreq.lead_id, dreq.whatsapp_group_jid,
            COALESCE(d.name, dr.from_number, dreq.group_name, 'Dealer') AS dealer_name
     FROM dealer_responses dr
     JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     WHERE dr.id = $1 LIMIT 1`,
    [responseId],
  );
  return updated.rows[0] || null;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export async function dispatchDealerRfq({
  leadId,
  dealerId = null,
  groupJid = null,
  groupName = null,
  deadlineHours = 24,
  actorId,
}) {
  const lead = await getLeadById(leadId);
  if (!lead) httpErr(404, 'Lead not found');

  const normalizedGroup = normalizeGroupJid(groupJid);
  let dealer = null;
  if (dealerId) {
    dealer = await getDealerById(dealerId);
    if (!dealer) httpErr(404, 'Dealer not found');
  }
  if (!dealer && !normalizedGroup) {
    httpErr(400, 'Select a WhatsApp group, paste a group ID ending in @g.us, or pick a dealer number');
  }
  if (dealer && !normalizedGroup && !dealer.phone) {
    httpErr(400, 'Dealer has no WhatsApp number');
  }

  const requestCode = await uniqueRequestCode();
  const deadline = new Date(Date.now() + deadlineHours * 3600_000);
  const messageBody = formatRfqMessage(lead, requestCode, deadline.toISOString());
  const sendTo = normalizedGroup || dealer.phone;
  const resolvedGroupName =
    groupName ||
    (normalizedGroup
      ? (await listWhatsAppGroups().catch(() => [])).find((group) => group.jid === normalizedGroup)?.name
      : null);

  const insertResult = await query(
    `INSERT INTO dealer_requests
       (lead_id, dealer_id, request_code, status, message_body, deadline_at, whatsapp_group_jid, group_name)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
     RETURNING *`,
    [
      leadId,
      dealer?.id || null,
      requestCode,
      messageBody,
      deadline.toISOString(),
      normalizedGroup,
      resolvedGroupName || null,
    ],
  );
  const dealerRequest = insertResult.rows[0];

  try {
    await sendTextMessage(sendTo, messageBody);
    await saveMessage({
      leadId,
      direction: 'outbound',
      channel: 'whatsapp',
      toNumber: sendTo,
      body: messageBody,
      status: 'sent',
      raw: {
        kind: 'dealer_rfq',
        request_code: requestCode,
        dealer_request_id: dealerRequest.id,
        group_jid: normalizedGroup,
        actor_id: actorId || null,
      },
    });
    await query(
      `UPDATE dealer_requests SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [dealerRequest.id],
    );
    dealerRequest.status = 'sent';
    dealerRequest.sent_at = new Date().toISOString();
    if (normalizedGroup) {
      void rememberWhatsAppGroup({
        jid: normalizedGroup,
        name: resolvedGroupName,
        source: 'rfq',
      });
    }
    void tryAutoTransitionLifecycle(leadId, 'dealer_rfq_sent');
  } catch (err) {
    await query(
      `UPDATE dealer_requests SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [dealerRequest.id],
    );
    throw err;
  }

  return { dealerRequest, dealer, lead };
}

// ── Inbound reply correlation ──────────────────────────────────────────────

export async function findRequestByCode(code) {
  const requestCode = extractDealerRequestCode(code);
  if (!requestCode) return null;
  const result = await query(
    `SELECT dr.*, d.name AS dealer_name, d.phone AS dealer_phone
     FROM dealer_requests dr
     LEFT JOIN dealers d ON d.id = dr.dealer_id
     WHERE dr.request_code = $1 LIMIT 1`,
    [requestCode],
  );
  return result.rows[0] || null;
}

/**
 * Handle an inbound WhatsApp message that may be a dealer RFQ reply.
 * Returns { handled: true } when the message was consumed (matched or unmatched dealer traffic).
 */
export async function handleIncomingDealerReply({
  from,
  groupId,
  text,
  messageId,
  raw,
  skipWhatsApp = false,
}) {
  const requestCode = extractDealerRequestCode(text);
  const isGroup = Boolean(groupId && String(groupId).includes('@g.us'));

  if (!requestCode && !isGroup) {
    return { handled: false };
  }

  if (!requestCode) {
    console.log(`[dealer-webhook] Group message without REQ code from ${from}, saving to exception inbox`);
    await saveUnmatchedMessage({ fromNumber: from, groupId, body: text, raw });
    return { handled: true, unmatched: true };
  }

  const dealerRequest = await findRequestByCode(text);
  if (!dealerRequest) {
    console.log(`[dealer-webhook] Unknown code ${requestCode} from ${from}, saving to exception inbox`);
    await saveUnmatchedMessage({ fromNumber: from, groupId, body: text, raw });
    return { handled: true, unmatched: true, request_code: requestCode };
  }

  console.log(`[dealer-webhook] Matched ${dealerRequest.request_code} — saving response from ${from}`);
  await saveDealerResponse({
    dealerRequestId: dealerRequest.id,
    rawText: text,
    providerMessageId: messageId,
    fromNumber: from,
  });

  await saveMessage({
    leadId: dealerRequest.lead_id,
    direction: 'inbound',
    channel: 'whatsapp',
    providerId: messageId || null,
    fromNumber: from,
    body: text,
    status: 'received',
    raw: { kind: 'dealer_reply', request_code: dealerRequest.request_code },
  });

  if (!skipWhatsApp) {
    const replyTo = isGroup ? groupId : from;
    const ack =
      `✅ Quote received for *${dealerRequest.request_code}*.\n` +
      'Our team will review it and add it to the comparison shortly.';
    try {
      await sendTextMessage(replyTo, ack);
      await saveMessage({
        leadId: dealerRequest.lead_id,
        direction: 'outbound',
        channel: 'whatsapp',
        toNumber: replyTo,
        body: ack,
        status: 'sent',
        raw: {
          kind: 'dealer_ack',
          request_code: dealerRequest.request_code,
          dealer_request_id: dealerRequest.id,
        },
      });
    } catch (err) {
      console.error('[dealer-webhook] Failed to send ack:', err.message);
    }
  }

  return {
    handled: true,
    request_code: dealerRequest.request_code,
    lead_id: dealerRequest.lead_id,
  };
}

export async function saveUnmatchedMessage({ fromNumber, groupId, body, raw }) {
  await query(
    `INSERT INTO unmatched_dealer_messages (from_number, group_id, body, raw)
     VALUES ($1, $2, $3, $4)`,
    [fromNumber || null, groupId || null, body || null, JSON.stringify(raw || {})],
  );
}

// ── AI extraction ─────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `
You are a travel pricing assistant. Extract structured booking offer data from a dealer's WhatsApp reply.
Return ONLY valid JSON with these fields (use null for unknown):
{
  "hotel_name": string|null,
  "room_type": string|null,
  "board_name": string|null,
  "check_in": "YYYY-MM-DD"|null,
  "check_out": "YYYY-MM-DD"|null,
  "nights": number|null,
  "price_per_night": number|null,
  "total_price": number|null,
  "currency": string|null,
  "cancellation_terms": string|null,
  "validity": string|null,
  "airline": string|null,
  "flight_number": string|null,
  "departure_time": string|null,
  "arrival_time": string|null,
  "stops": number|null,
  "notes": string|null,
  "confidence": "high"|"medium"|"low",
  "errors": string[]
}
`.trim();

export async function extractDealerReply(text) {
  if (!client) {
    return {
      extracted: null,
      confidence: 'low',
      errors: ['OpenAI not configured'],
    };
  }

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: text },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const { confidence = 'low', errors = [], ...extracted } = parsed;
    return { extracted, confidence, errors };
  } catch (err) {
    console.error('[dealerExtract] AI extraction failed:', err.message);
    return {
      extracted: null,
      confidence: 'low',
      errors: [err.message],
    };
  }
}

// ── Save dealer response ──────────────────────────────────────────────────

export async function saveDealerResponse({ dealerRequestId, rawText, providerMessageId, fromNumber }) {
  const { extracted, confidence, errors } = await extractDealerReply(rawText);
  const autoApprove = confidence === 'high' && extracted && !errors?.length;
  const reviewStatus = autoApprove ? 'approved' : 'pending';

  const result = await query(
    `INSERT INTO dealer_responses
       (dealer_request_id, raw_text, extracted, extraction_confidence, extraction_errors,
        review_status, provider_message_id, from_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      dealerRequestId,
      rawText,
      extracted ? JSON.stringify(extracted) : null,
      confidence,
      errors.length ? JSON.stringify(errors) : null,
      reviewStatus,
      providerMessageId || null,
      fromNumber || null,
    ],
  );

  await query(
    `UPDATE dealer_requests SET status = 'replied', updated_at = NOW() WHERE id = $1`,
    [dealerRequestId],
  );

  const requestRow = await query(
    `SELECT lead_id FROM dealer_requests WHERE id = $1 LIMIT 1`,
    [dealerRequestId],
  );
  const leadId = requestRow.rows[0]?.lead_id;
  if (leadId) {
    await rankDealerOffersForLead(leadId);
    if (autoApprove) void tryAutoTransitionLifecycle(leadId, 'dealer_response_ready');
  }

  return result.rows[0];
}

// ── Review ────────────────────────────────────────────────────────────────

export async function reviewDealerResponse({ responseId, approved, reviewerId, correctedData }) {
  const status = approved ? 'approved' : 'rejected';
  const result = await query(
    `UPDATE dealer_responses
     SET review_status = $2,
         reviewed_by = $3,
         reviewed_at = NOW(),
         extracted = COALESCE($4::jsonb, extracted)
     WHERE id = $1
     RETURNING *`,
    [responseId, status, reviewerId || null, correctedData ? JSON.stringify(correctedData) : null],
  );
  const row = result.rows[0] || null;
  if (row) {
    const req = await query(
      `SELECT lead_id FROM dealer_requests WHERE id = $1 LIMIT 1`,
      [row.dealer_request_id],
    );
    const leadId = req.rows[0]?.lead_id;
    if (leadId) {
      await rankDealerOffersForLead(leadId);
      if (approved) void tryAutoTransitionLifecycle(leadId, 'dealer_response_ready');
    }
  }
  return row;
}

// ── List helpers ──────────────────────────────────────────────────────────

export async function listDealerRequests({ leadId, dealerId, status, limit = 100, userId = null } = {}) {
  const conditions = [];
  const params = [];

  if (leadId) { conditions.push(`dr.lead_id = $${params.length + 1}`); params.push(leadId); }
  if (dealerId) { conditions.push(`dr.dealer_id = $${params.length + 1}`); params.push(dealerId); }
  if (status) { conditions.push(`dr.status = $${params.length + 1}`); params.push(status); }
  if (userId) { conditions.push(`EXISTS (SELECT 1 FROM user_leads ul WHERE ul.lead_id = dr.lead_id AND ul.user_id = $${params.length + 1})`); params.push(userId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const result = await query(
    `SELECT dr.*, d.name AS dealer_name, d.phone AS dealer_phone,
            COALESCE(d.name, dr.group_name, 'WhatsApp group') AS destination_label
     FROM dealer_requests dr
     LEFT JOIN dealers d ON d.id = dr.dealer_id
     ${where}
     ORDER BY dr.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

export async function listDealerResponses({ dealerRequestId, leadId, reviewStatus, limit = 100, userId = null } = {}) {
  const conditions = [];
  const params = [];

  if (dealerRequestId) { conditions.push(`dr.dealer_request_id = $${params.length + 1}`); params.push(dealerRequestId); }
  if (leadId) { conditions.push(`dreq.lead_id = $${params.length + 1}`); params.push(leadId); }
  if (reviewStatus) { conditions.push(`dr.review_status = $${params.length + 1}`); params.push(reviewStatus); }
  if (userId) { conditions.push(`EXISTS (SELECT 1 FROM user_leads ul WHERE ul.lead_id = dreq.lead_id AND ul.user_id = $${params.length + 1})`); params.push(userId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const result = await query(
    `SELECT dr.*, dreq.request_code, dreq.lead_id, dreq.whatsapp_group_jid, dreq.group_name,
            COALESCE(d.name, dr.from_number, dreq.group_name, 'Dealer') AS dealer_name
     FROM dealer_responses dr
     JOIN dealer_requests dreq ON dreq.id = dr.dealer_request_id
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     ${where}
     ORDER BY dr.is_best DESC, dr.is_recommended DESC, dr.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

export async function listUnmatchedMessages({ limit = 100, resolved = false } = {}) {
  const result = await query(
    `SELECT * FROM unmatched_dealer_messages WHERE resolved = $1 ORDER BY created_at DESC LIMIT $2`,
    [resolved, limit],
  );
  return result.rows;
}

export async function resolveUnmatchedMessage(id) {
  await query(`UPDATE unmatched_dealer_messages SET resolved = TRUE WHERE id = $1`, [id]);
}
