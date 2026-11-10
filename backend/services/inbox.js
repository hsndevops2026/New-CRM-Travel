import { query } from '../config/database.js';
import { normalizeGroupJid } from './wasender.js';
import { listKnownWhatsAppGroups } from './whatsappGroups.js';

function encodeThreadId(kind, id) {
  return `${kind}:${id}`;
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

const CUSTOMER_MSG_SQL = `(m.raw->>'kind' IS NULL OR m.raw->>'kind' = 'customer' OR m.raw->>'kind' NOT IN ('dealer_rfq', 'dealer_reply', 'dealer_ack', 'dealer_agent_reply'))`;

const LEAD_CONTACT_JOIN = `
  LEFT JOIN contacts ct ON ct.phone = regexp_replace(l.phone, '\\D', '', 'g')
`;

function encodePhoneThreadId(digits) {
  return `customer:phone:${digits}`;
}

export function parseThreadId(threadId) {
  const raw = String(threadId || '');
  if (raw.startsWith('customer:phone:')) return { kind: 'customer', id: raw.slice(15), byPhone: true };
  if (raw.startsWith('customer:')) return { kind: 'customer', id: raw.slice(9), byPhone: false };
  if (raw.startsWith('dealer:')) return { kind: 'dealer', id: raw.slice(7) };
  if (raw.startsWith('group:')) return { kind: 'group', id: raw.slice(6) };
  if (raw.startsWith('c-')) return { kind: 'customer', id: raw.slice(2), byPhone: false };
  if (raw.startsWith('d-')) return { kind: 'dealer', id: raw.slice(2) };
  return null;
}

function preview(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function listCustomerThreads(limit, userId = null) {
  const userJoin = userId ? `JOIN user_leads ul ON ul.lead_id = l.id AND ul.user_id = $2` : '';
  const leadsResult = await query(
    `SELECT l.id AS lead_id,
            l.phone,
            l.destination,
            ct.name AS contact_name,
            l.lifecycle_status,
            l.booking_type,
            lm.body AS last_message,
            lm.created_at AS last_at,
            lm.direction AS last_direction
     FROM leads l
     ${userJoin}
     ${LEAD_CONTACT_JOIN}
     LEFT JOIN LATERAL (
       SELECT body, created_at, direction
       FROM messages m
       WHERE (
         m.lead_id = l.id
         OR (
           m.lead_id IS NULL
           AND regexp_replace(COALESCE(m.from_number, m.to_number, ''), '\\D', '', 'g')
             = regexp_replace(l.phone, '\\D', '', 'g')
         )
       )
       AND ${CUSTOMER_MSG_SQL}
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON TRUE
     ORDER BY COALESCE(lm.created_at, l.created_at) DESC
     LIMIT $1`,
    userId ? [limit, userId] : [limit],
  );

  const leadThreads = leadsResult.rows.map((row) => ({
    id: encodeThreadId('customer', row.lead_id),
    kind: 'customer',
    title: row.contact_name || row.destination || formatPhoneTitle(row.phone),
    subtitle: [row.destination, row.booking_type].filter(Boolean).join(' · ') || row.phone || '',
    lead_id: row.lead_id,
    phone: row.phone,
    lifecycle_status: row.lifecycle_status,
    last_message: preview(row.last_message) || 'Lead created — open chat',
    last_at: row.last_at || null,
    last_direction: row.last_direction || null,
  }));

  const convResult = userId ? { rows: [] } : await query(
    `SELECT c.id AS conversation_id,
            c.phone,
            c.collected,
            c.updated_at,
            lm.body AS last_message,
            lm.created_at AS last_at,
            lm.direction AS last_direction
     FROM conversations c
     JOIN LATERAL (
       SELECT body, created_at, direction
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON TRUE
     WHERE c.status = 'active'
       AND lm.body IS NOT NULL
     ORDER BY lm.created_at DESC
     LIMIT $1`,
    [limit],
  );

  const seenPhones = new Set(leadThreads.map((t) => phoneDigits(t.phone)));
  const intakeThreads = [];

  for (const row of convResult.rows) {
    const digits = phoneDigits(row.phone);
    if (!digits || seenPhones.has(digits)) continue;
    const collected = row.collected || {};
    intakeThreads.push({
      id: encodePhoneThreadId(digits),
      kind: 'customer',
      title: collected.destination || formatPhoneTitle(row.phone),
      subtitle: collected.booking_type
        ? `${collected.booking_type} intake in progress`
        : 'New WhatsApp inquiry',
      phone: row.phone,
      conversation_id: row.conversation_id,
      lifecycle_status: 'intake',
      last_message: preview(row.last_message) || 'New message',
      last_at: row.last_at || null,
      last_direction: row.last_direction || null,
    });
    seenPhones.add(digits);
  }

  return [...intakeThreads, ...leadThreads]
    .sort((a, b) => {
      const ta = a.last_at ? new Date(a.last_at).getTime() : 0;
      const tb = b.last_at ? new Date(b.last_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}

function formatPhoneTitle(phone) {
  const digits = phoneDigits(phone);
  if (!digits) return 'Customer';
  if (digits.length >= 10) return `+${digits.slice(-12)}`;
  return phone || 'Customer';
}

async function listDealerThreads(limit, userId = null) {
  const result = await query(
    `SELECT dreq.id AS dealer_request_id,
            dreq.request_code,
            dreq.status AS request_status,
            dreq.lead_id,
            dreq.group_name,
            d.name AS dealer_name,
            l.destination,
            COALESCE(dr.raw_text, dreq.message_body) AS last_message,
            COALESCE(dr.created_at, dreq.sent_at, dreq.created_at) AS last_at,
            dr.review_status,
            dr.id AS pending_response_id
     FROM dealer_requests dreq
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     JOIN leads l ON l.id = dreq.lead_id
     ${userId ? `JOIN user_leads ul ON ul.lead_id = l.id AND ul.user_id = $2` : ''}
     LEFT JOIN LATERAL (
       SELECT id, raw_text, created_at, review_status
       FROM dealer_responses
       WHERE dealer_request_id = dreq.id
       ORDER BY created_at DESC
       LIMIT 1
     ) dr ON TRUE
     ORDER BY COALESCE(dr.created_at, dreq.sent_at, dreq.created_at) DESC
     LIMIT $1`,
    userId ? [limit, userId] : [limit],
  );

  return result.rows.map((row) => ({
    id: encodeThreadId('dealer', row.dealer_request_id),
    kind: 'dealer',
    title: `${row.request_code} · ${row.dealer_name || row.group_name || 'WhatsApp group'}`,
    subtitle: row.destination || '',
    lead_id: row.lead_id,
    dealer_request_id: row.dealer_request_id,
    request_code: row.request_code,
    request_status: row.request_status,
    pending_response_id: row.review_status === 'pending' ? row.pending_response_id : null,
    last_message: preview(row.last_message) || 'RFQ sent',
    last_at: row.last_at || null,
  }));
}

async function lastGroupMessagesByJid(jids) {
  if (!jids.length) return new Map();
  const result = await query(
    `SELECT DISTINCT ON (jid) jid, body, created_at, direction
     FROM (
       SELECT COALESCE(raw->>'group_jid', to_number, from_number) AS jid,
              body, created_at, direction
       FROM messages
       WHERE COALESCE(raw->>'group_jid', to_number, from_number) = ANY($1::text[])
     ) grouped
     ORDER BY jid, created_at DESC`,
    [jids],
  );
  return new Map(result.rows.map((row) => [row.jid, row]));
}

async function listGroupThreads(limit) {
  const known = await listKnownWhatsAppGroups({ includeSessionInfo: false }).catch((error) => {
    console.error('Failed to list WhatsApp groups:', error.message);
    return { groups: [] };
  });
  const groups = known.groups || [];
  if (!groups.length) return [];

  const sliced = groups.slice(0, limit);
  const lastByJid = await lastGroupMessagesByJid(sliced.map((group) => group.jid));

  return sliced.map((group) => {
    const last = lastByJid.get(group.jid);
    return {
      id: encodeThreadId('group', group.jid),
      kind: 'group',
      title: group.name,
      subtitle: 'WhatsApp group',
      group_jid: group.jid,
      last_message: preview(last?.body) || 'No messages yet — open to send',
      last_at: last?.created_at || null,
      last_direction: last?.direction || null,
    };
  });
}

export async function listThreads({ kind = 'all', limit = 100, userId = null } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);
  if (kind === 'customer') {
    const threads = await listCustomerThreads(cap, userId);
    return { threads };
  }
  if (kind === 'dealer') {
    const threads = await listDealerThreads(cap, userId);
    return { threads };
  }
  if (kind === 'group') {
    const threads = await listGroupThreads(200);
    return { threads };
  }

  const [customers, dealers, groups] = await Promise.all([
    listCustomerThreads(cap, userId),
    listDealerThreads(cap, userId),
    listGroupThreads(200),
  ]);
  const merged = [...customers, ...dealers, ...groups].sort((a, b) => {
    const ta = a.last_at ? new Date(a.last_at).getTime() : 0;
    const tb = b.last_at ? new Date(b.last_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    if (a.kind === 'group' && b.kind !== 'group') return 1;
    if (b.kind === 'group' && a.kind !== 'group') return -1;
    return String(a.title).localeCompare(String(b.title));
  });
  return { threads: merged };
}

function normalizeMessage(row, { synthetic = false } = {}) {
  return {
    id: synthetic ? `syn-${row.sort_key}` : row.id,
    direction: row.direction,
    body: row.body,
    created_at: row.created_at,
    status: row.status || 'received',
    channel: row.channel || 'whatsapp',
    meta: row.raw || {},
    synthetic,
  };
}

async function getCustomerThreadMessages(leadId, { before, limit, phoneDigits: phoneFilter = null }) {
  let phone = phoneFilter;
  if (!phone && leadId) {
    const leadRow = await query(`SELECT phone FROM leads WHERE id = $1 LIMIT 1`, [leadId]);
    phone = phoneDigits(leadRow.rows[0]?.phone);
  }

  const params = [];
  let whereClause = '';

  if (leadId && phone) {
    params.push(leadId, phone);
    // The phone match only exists to pick up intake messages not yet linked to
    // a lead. Without the NULL guard a repeat customer's threads bleed into
    // each other: every lead on that number shows every other lead's messages,
    // and the identical bot replies then read as duplicates.
    whereClause = `(
      m.lead_id = $1
      OR (
        m.lead_id IS NULL
        AND regexp_replace(COALESCE(m.from_number, m.to_number, ''), '\\D', '', 'g') = $2
      )
    )`;
  } else if (phone) {
    params.push(phone);
    whereClause = `regexp_replace(COALESCE(m.from_number, m.to_number, ''), '\\D', '', 'g') = $1`;
  } else if (leadId) {
    params.push(leadId);
    whereClause = `m.lead_id = $1`;
  } else {
    return [];
  }

  let beforeClause = '';
  if (before) {
    params.push(before);
    beforeClause = `AND m.created_at < $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT m.id, m.direction, m.body, m.created_at, m.status, m.channel, m.raw,
            m.created_at AS sort_key
     FROM messages m
     WHERE ${whereClause}
       AND ${CUSTOMER_MSG_SQL}
       ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.reverse().map((row) => normalizeMessage(row));
}

async function getCustomerThreadByPhone(phoneFilter, { before, limit }) {
  const digits = phoneDigits(phoneFilter);
  const convResult = await query(
    `SELECT c.id, c.phone, c.collected, c.status
     FROM conversations c
     WHERE regexp_replace(c.phone, '\\D', '', 'g') = $1
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [digits],
  );
  const conv = convResult.rows[0];
  const collected = conv?.collected || {};
  const messages = await getCustomerThreadMessages(null, {
    before,
    limit,
    phoneDigits: digits,
  });

  const leadResult = await query(
    `SELECT l.id, l.phone, l.destination, ct.name AS contact_name, l.lifecycle_status
     FROM leads l
     ${LEAD_CONTACT_JOIN}
     WHERE regexp_replace(l.phone, '\\D', '', 'g') = $1
     ORDER BY l.created_at DESC
     LIMIT 1`,
    [digits],
  );
  const lead = leadResult.rows[0];

  return {
    thread: {
      id: lead ? encodeThreadId('customer', lead.id) : encodePhoneThreadId(digits),
      kind: 'customer',
      title: lead?.contact_name || lead?.destination || collected.destination || formatPhoneTitle(conv?.phone || digits),
      subtitle: lead?.destination || collected.booking_type || 'WhatsApp intake',
      lead_id: lead?.id || null,
      phone: lead?.phone || conv?.phone || digits,
      lifecycle_status: lead?.lifecycle_status || 'intake',
      conversation_id: conv?.id || null,
    },
    messages,
  };
}

async function getDealerThreadMessages(dealerRequestId, { before, limit }) {
  const reqResult = await query(
    `SELECT dreq.*, d.name AS dealer_name, d.phone AS dealer_phone,
            d.whatsapp_group_id, l.destination
     FROM dealer_requests dreq
     LEFT JOIN dealers d ON d.id = dreq.dealer_id
     JOIN leads l ON l.id = dreq.lead_id
     WHERE dreq.id = $1 LIMIT 1`,
    [dealerRequestId],
  );
  const dreq = reqResult.rows[0];
  if (!dreq) return { thread: null, messages: [] };

  const synthetic = [];
  if (dreq.message_body && dreq.sent_at) {
    synthetic.push({
      id: `rfq-${dreq.id}`,
      direction: 'outbound',
      body: dreq.message_body,
      created_at: dreq.sent_at,
      status: 'sent',
      channel: 'whatsapp',
      raw: { kind: 'dealer_rfq', request_code: dreq.request_code },
      sort_key: dreq.sent_at,
    });
  }

  const responses = await query(
    `SELECT id, raw_text, created_at, review_status, extracted, extraction_confidence
     FROM dealer_responses
     WHERE dealer_request_id = $1
     ORDER BY created_at ASC`,
    [dealerRequestId],
  );

  for (const dr of responses.rows) {
    synthetic.push({
      id: `dr-${dr.id}`,
      direction: 'inbound',
      body: dr.raw_text,
      created_at: dr.created_at,
      status: 'received',
      channel: 'whatsapp',
      raw: {
        kind: 'dealer_reply',
        response_id: dr.id,
        review_status: dr.review_status,
        extracted: dr.extracted,
        confidence: dr.extraction_confidence,
      },
      sort_key: dr.created_at,
    });
  }

  const msgResult = await query(
    `SELECT id, direction, body, created_at, status, channel, raw,
            created_at AS sort_key
     FROM messages
     WHERE lead_id = $1
       AND raw->>'kind' IN ('dealer_rfq', 'dealer_reply', 'dealer_ack')
       AND (
         raw->>'request_code' = $2
         OR raw->>'dealer_request_id' = $3
       )
     ORDER BY created_at ASC`,
    [dreq.lead_id, dreq.request_code, dealerRequestId],
  );

  const combined = [
    ...synthetic,
    ...msgResult.rows.map((row) => ({ ...row, sort_key: row.created_at })),
  ];

  combined.sort((a, b) => new Date(a.sort_key).getTime() - new Date(b.sort_key).getTime());

  let filtered = combined;
  if (before) {
    const cutoff = new Date(before).getTime();
    filtered = combined.filter((m) => new Date(m.sort_key).getTime() < cutoff);
  }
  const slice = filtered.slice(-limit);

  const pending = responses.rows.find((r) => r.review_status === 'pending') || null;

  return {
    thread: {
      id: encodeThreadId('dealer', dealerRequestId),
      kind: 'dealer',
      title: `${dreq.request_code} · ${dreq.dealer_name || dreq.group_name || 'WhatsApp group'}`,
      subtitle: dreq.destination,
      lead_id: dreq.lead_id,
      dealer_request_id: dealerRequestId,
      request_code: dreq.request_code,
      pending_response: pending,
    },
    messages: slice.map((row) =>
      normalizeMessage(row, { synthetic: String(row.id || '').startsWith('rfq-') || String(row.id || '').startsWith('dr-') }),
    ),
  };
}

async function getGroupThreadMessages(groupJid, { before, limit }) {
  const jid = normalizeGroupJid(groupJid) || String(groupJid || '').trim();
  if (!jid) {
    const err = new Error('Invalid group id');
    err.status = 400;
    throw err;
  }

  let groups = [];
  try {
    groups = (await listKnownWhatsAppGroups({ includeSessionInfo: false })).groups;
  } catch (error) {
    console.error('Failed to load WhatsApp groups:', error.message);
  }
  const group = groups.find((row) => row.jid === jid) || null;

  const params = [jid];
  let beforeClause = '';
  if (before) {
    params.push(before);
    beforeClause = `AND m.created_at < $${params.length}`;
  }
  params.push(limit);

  const result = await query(
    `SELECT m.id, m.direction, m.body, m.created_at, m.status, m.channel, m.raw,
            m.created_at AS sort_key
     FROM messages m
     WHERE (
       m.raw->>'group_jid' = $1
       OR m.to_number = $1
       OR m.from_number = $1
     )
     ${beforeClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return {
    thread: {
      id: encodeThreadId('group', jid),
      kind: 'group',
      title: group?.name || jid,
      subtitle: 'WhatsApp group',
      group_jid: jid,
    },
    messages: result.rows.reverse().map((row) => normalizeMessage(row)),
  };
}

export async function getThreadMessages(threadId, { before = null, limit = 50 } = {}) {
  const parsed = parseThreadId(threadId);
  if (!parsed) {
    const err = new Error('Invalid thread id');
    err.status = 400;
    throw err;
  }

  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);

  if (parsed.kind === 'group') {
    return getGroupThreadMessages(parsed.id, { before, limit: cap });
  }

  if (parsed.kind === 'customer') {
    if (parsed.byPhone) {
      return getCustomerThreadByPhone(parsed.id, { before, limit: cap });
    }

    const leadResult = await query(
      `SELECT l.id, l.phone, l.destination, ct.name AS contact_name, l.lifecycle_status
       FROM leads l
       ${LEAD_CONTACT_JOIN}
       WHERE l.id = $1 LIMIT 1`,
      [parsed.id],
    );
    const lead = leadResult.rows[0];
    if (!lead) {
      const err = new Error('Lead not found');
      err.status = 404;
      throw err;
    }
    const messages = await getCustomerThreadMessages(parsed.id, {
      before,
      limit: cap,
      phoneDigits: phoneDigits(lead.phone),
    });
    return {
      thread: {
        id: encodeThreadId('customer', lead.id),
        kind: 'customer',
        title: lead.contact_name || lead.destination || formatPhoneTitle(lead.phone),
        subtitle: lead.destination || lead.phone,
        lead_id: lead.id,
        phone: lead.phone,
        lifecycle_status: lead.lifecycle_status,
      },
      messages,
    };
  }

  return getDealerThreadMessages(parsed.id, { before, limit: cap });
}

export async function getThreadMeta(threadId) {
  const { thread } = await getThreadMessages(threadId, { limit: 1 });
  return thread;
}
