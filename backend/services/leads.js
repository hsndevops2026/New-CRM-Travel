import { pool, query } from '../config/database.js';
import { enqueueFlightQuoteJob } from '../queues/quoteQueue.js';
import { enqueueHotelQuoteJob } from '../queues/hotelQuoteQueue.js';
import { normalizeTravelDates } from './openaiLead.js';
import { upsertContact } from './contacts.js';
import { ensureCustomerAccount, requireCustomerEmail } from './customers.js';
import { findMatchingPackage } from './packageOffer.js';

const LEAD_WITH_CONTACT_SQL = `
  SELECT leads.*,
    contacts.name AS contact_name,
    contacts.email AS contact_email,
    contacts.id AS contact_id,
    predefined_quotes.title AS predefined_quote_title,
    predefined_quotes.quote_type AS predefined_quote_type
  FROM leads
  LEFT JOIN contacts ON contacts.phone = regexp_replace(leads.phone, '\\D', '', 'g')
  LEFT JOIN predefined_quotes ON predefined_quotes.id = leads.predefined_quote_id
`;

function nightsBetween(travelDate, returnDate) {
  if (!travelDate || !returnDate) return null;
  const start = new Date(`${String(travelDate).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(returnDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : null;
}

function normalizeChildrenAges(value) {
  if (Array.isArray(value)) {
    return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[|,]/)
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

export function normalizeLeadInput(input = {}) {
  const rawType = String(input.booking_type || 'hotel').toLowerCase();
  const bookingType = rawType === 'flight'
    ? 'flight'
    : rawType === 'package'
      ? 'package'
      : 'hotel';

  const coerced = normalizeTravelDates({
    travel_date: input.travel_date ? String(input.travel_date).slice(0, 10) : null,
    return_date: input.return_date ? String(input.return_date).slice(0, 10) : null,
  });
  const travelDate = coerced.travel_date;
  const returnDate = coerced.return_date;
  const nights = nightsBetween(travelDate, returnDate);
  const adults = Number(input.adults_count);
  const children = Number(input.children_count ?? 0);
  const phone = String(input.phone || '').replace(/[^\d+]/g, '');

  const errors = [];
  if (!phone) errors.push('phone is required');
  if (!input.destination) errors.push('destination is required');
  if (!travelDate) errors.push('travel_date is required');
  if (!returnDate) errors.push('return_date is required');
  if (nights === null) errors.push('return_date must be on/after travel_date');
  if (!Number.isFinite(adults) || adults < 1) errors.push('adults_count must be >= 1');
  if (!Number.isFinite(children) || children < 0) errors.push('children_count must be >= 0');
  if (bookingType === 'flight' && !input.origin) errors.push('origin is required for flight');
  if (bookingType === 'package' && !input.origin) errors.push('origin is required for package');

  const childrenAges = normalizeChildrenAges(input.children_ages);
  if (children > 0 && childrenAges.length < children) {
    errors.push('children_ages required for each child');
  }

  const collected = {
    booking_type: bookingType,
    origin: bookingType === 'hotel' ? null : String(input.origin || '').trim(),
    destination: String(input.destination || '').trim(),
    travel_date: travelDate,
    return_date: returnDate,
    nights,
    adults_count: adults,
    children_count: children,
    children_ages: children > 0 ? childrenAges.slice(0, children) : [],
    budget: input.budget || null,
    hotel_name: bookingType === 'hotel' ? input.hotel_name || null : null,
    notes: input.notes || null,
  };

  const summary =
    input.summary ||
    `${bookingType.toUpperCase()}: ${
      (bookingType === 'flight' || bookingType === 'package') && collected.origin
        ? `${collected.origin} → ${collected.destination}`
        : collected.destination
    }, ${travelDate} → ${returnDate}, ${nights} nights`;

  return {
    errors,
    phone,
    status: ['new', 'contacted', 'booked', 'archived'].includes(input.status)
      ? input.status
      : 'new',
    source: ['whatsapp', 'crm', 'csv'].includes(input.source) ? input.source : 'crm',
    collected,
    summary,
  };
}

export async function getActiveConversation(phone) {
  const result = await query(
    `SELECT * FROM conversations
     WHERE phone = $1 AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [phone],
  );
  return result.rows[0] || null;
}

function conversationIdleMs() {
  const minutes = Number(process.env.CONVERSATION_IDLE_MINUTES || 5);
  return Math.max(1, Number.isFinite(minutes) ? minutes : 5) * 60 * 1000;
}

export function isConversationIdle(conversation, now = Date.now()) {
  if (!conversation?.updated_at) return true;
  const updatedAt = new Date(conversation.updated_at).getTime();
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt >= conversationIdleMs();
}

export async function expireConversation(id, reason = 'idle_timeout') {
  const result = await query(
    `UPDATE conversations
     SET status = 'expired',
         updated_at = NOW(),
         collected = COALESCE(collected, '{}'::jsonb) || $2::jsonb
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id, JSON.stringify({ _expired_reason: reason })],
  );
  return result.rows[0] || null;
}

/**
 * Returns the active conversation, or null if none / idle past timeout (expired first).
 */
export async function getActiveConversationOrExpire(phone) {
  const conversation = await getActiveConversation(phone);
  if (!conversation) {
    return { conversation: null, restarted: false };
  }

  if (!isConversationIdle(conversation)) {
    return { conversation, restarted: false };
  }

  await expireConversation(conversation.id, 'idle_timeout');
  console.log(
    `[conversations] expired idle session ${conversation.id} for ${phone} (>${process.env.CONVERSATION_IDLE_MINUTES || 5}m)`,
  );
  return { conversation: null, restarted: true };
}

/** Mark all active conversations idle past the timeout as expired. */
export async function expireStaleConversations() {
  const minutes = Math.max(1, Number(process.env.CONVERSATION_IDLE_MINUTES || 5) || 5);
  const result = await query(
    `UPDATE conversations
     SET status = 'expired',
         updated_at = NOW(),
         collected = COALESCE(collected, '{}'::jsonb) || '{"_expired_reason":"idle_timeout"}'::jsonb
     WHERE status = 'active'
       AND updated_at < NOW() - ($1 * INTERVAL '1 minute')
     RETURNING id, phone`,
    [minutes],
  );
  return result.rows;
}

export async function createConversation(phone, language = 'en') {
  const result = await query(
    `INSERT INTO conversations (phone, status, language, collected)
     VALUES ($1, 'active', $2, '{}'::jsonb)
     RETURNING *`,
    [phone, language],
  );
  return result.rows[0];
}

/**
 * Re-opens the conversation a poll was sent in, when the customer votes after it timed out —
 * its pending offer is still in `collected`. Only when no newer conversation has started
 * for the number since; then the vote is stale and the conversation is left as it is.
 */
export async function reopenConversationForVote(id, phone) {
  if (!id) return null;
  const result = await query(
    `UPDATE conversations c
     SET status = 'active', updated_at = NOW()
     WHERE c.id = $1 AND c.phone = $2 AND c.status IN ('active', 'expired')
       AND NOT EXISTS (
         SELECT 1 FROM conversations newer
         WHERE newer.phone = c.phone AND newer.id <> c.id AND newer.created_at > c.created_at
       )
     RETURNING *`,
    [id, phone],
  );
  return result.rows[0] || null;
}

export async function updateConversation(id, { collected, language, status }) {
  const result = await query(
    `UPDATE conversations
     SET collected = COALESCE($2, collected),
         language = COALESCE($3, language),
         status = COALESCE($4, status),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, collected ? JSON.stringify(collected) : null, language || null, status || null],
  );
  return result.rows[0];
}

export async function createLead({
  conversationId = null,
  phone,
  collected,
  summary,
  status = 'new',
  source = 'whatsapp',
  skipQuoteFetch = false,
  predefinedQuoteId = null,
  pendingPackageOfferId = null,
}) {
  const bookingType = collected.booking_type || 'hotel';
  const attachedPackage = Boolean(predefinedQuoteId);
  const quoteStatus = attachedPackage
    ? 'package'
    : skipQuoteFetch
      ? null
      : (bookingType === 'flight' || bookingType === 'hotel' || bookingType === 'package')
        ? 'processing'
        : null;
  const dates = normalizeTravelDates({
    travel_date: collected.travel_date,
    return_date: collected.return_date,
  });
  const travelDate = dates.travel_date;
  const returnDate = dates.return_date;
  const nights = nightsBetween(travelDate, returnDate) ?? collected.nights ?? null;
  const safeCollected = {
    ...collected,
    travel_date: travelDate,
    return_date: returnDate,
    nights,
  };

  const result = await query(
    `INSERT INTO leads (
      conversation_id,
      phone,
      booking_type,
      origin,
      destination,
      travel_date,
      return_date,
      nights,
      adults_count,
      children_count,
      children_ages,
      budget,
      hotel_name,
      notes,
      summary,
      status,
      source,
      raw_collected,
      quote_status,
      predefined_quote_id,
      pending_package_offer_id,
      lifecycle_status
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22
    ) RETURNING *`,
    [
      conversationId,
      phone,
      bookingType,
      safeCollected.origin || null,
      safeCollected.destination,
      travelDate,
      returnDate,
      nights,
      collected.adults_count,
      collected.children_count ?? 0,
      collected.children_ages || [],
      collected.budget || null,
      bookingType === 'flight' ? null : collected.hotel_name || null,
      collected.notes || null,
      summary || null,
      status,
      source,
      JSON.stringify(safeCollected),
      quoteStatus,
      predefinedQuoteId || null,
      pendingPackageOfferId || null,
      attachedPackage || skipQuoteFetch ? 'intake' : 'sourcing',
    ],
  );

  const lead = result.rows[0];
  const shouldFetchQuotes = !skipQuoteFetch && !attachedPackage;
  if (shouldFetchQuotes && lead?.booking_type === 'flight') {
    try {
      await enqueueFlightQuoteJob(lead.id);
      console.log(`[quotes] enqueued flight fetch for lead ${lead.id}`);
    } catch (error) {
      console.error(`[quotes] flight enqueue failed for lead ${lead.id}:`, error.message);
      await setLeadQuoteStatus(lead.id, 'error', error.message);
      lead.quote_status = 'error';
      lead.quote_error = error.message;
    }
  } else if (shouldFetchQuotes && lead?.booking_type === 'package') {
    try {
      await setLeadQuoteStatus(lead.id, 'processing', null, { phase: 'flights' });
      await enqueueFlightQuoteJob(lead.id);
      console.log(`[quotes] enqueued package flight fetch for lead ${lead.id}`);
    } catch (error) {
      console.error(`[quotes] package flight enqueue failed for lead ${lead.id}:`, error.message);
      await setLeadQuoteStatus(lead.id, 'error', error.message);
      lead.quote_status = 'error';
      lead.quote_error = error.message;
    }
  } else if (shouldFetchQuotes && lead?.booking_type === 'hotel') {
    try {
      await enqueueHotelQuoteJob(lead.id);
      console.log(`[hotel-quotes] enqueued hotel fetch for lead ${lead.id}`);
    } catch (error) {
      console.error(`[hotel-quotes] hotel enqueue failed for lead ${lead.id}:`, error.message);
      await setLeadQuoteStatus(lead.id, 'error', error.message);
      lead.quote_status = 'error';
      lead.quote_error = error.message;
    }
  }

  return getLeadById(lead.id);
}

export async function getLeadById(id) {
  const result = await query(`${LEAD_WITH_CONTACT_SQL} WHERE leads.id = $1`, [id]);
  return withLifecycleOptions(result.rows[0] || null);
}

export async function attachPredefinedQuoteToLead(leadId, quoteId, { selectedItemIds = [] } = {}) {
  const selection = Array.isArray(selectedItemIds)
    ? selectedItemIds.map(String).filter(Boolean)
    : [];
  await query(
    `UPDATE leads
     SET predefined_quote_id = $2,
         quote_status = 'package',
         quote_error = null,
         pending_package_offer_id = NULL,
         raw_collected = COALESCE(raw_collected, '{}'::jsonb) || $3::jsonb
     WHERE id = $1`,
    [leadId, quoteId, JSON.stringify({ _selected_package_item_ids: selection })],
  );
  return getLeadById(leadId);
}

export async function startHotelQuoteFetchForLead(leadId) {
  const lead = await getLeadById(leadId);
  if (!lead) return null;

  await setLeadQuoteStatus(leadId, 'processing', null);
  try {
    const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
    const queue = getHotelQuoteQueue();
    const existing = await queue.getJob(`hotel-lead-${leadId}`);
    if (existing) await existing.remove();
    await enqueueHotelQuoteJob(leadId);
  } catch (error) {
    await setLeadQuoteStatus(leadId, 'error', error.message);
    console.error(`[hotel-quotes] hotel enqueue failed for lead ${leadId}:`, error.message);
  }

  return getLeadById(leadId);
}

export async function setLeadQuoteStatus(id, quoteStatus, quoteError = null, quoteSearch = undefined) {
  const fetchedAtSql =
    quoteStatus === 'completed'
      ? 'NOW()'
      : 'quotes_fetched_at';

  const result = await query(
    `UPDATE leads
     SET quote_status = $2,
         quote_error = $3,
         quotes_fetched_at = ${fetchedAtSql},
         quote_search = COALESCE($4::jsonb, quote_search)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      quoteStatus,
      quoteError,
      quoteSearch === undefined ? null : JSON.stringify(quoteSearch),
    ],
  );
  const row = result.rows[0] || null;
  if (row && quoteStatus === 'completed') {
    void tryAutoTransitionLifecycle(id, 'quotes_completed');
  }
  return row;
}

export async function findLatestLeadByPhone(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '');
  if (!normalized) return null;
  const result = await query(
    `${LEAD_WITH_CONTACT_SQL}
     WHERE regexp_replace(leads.phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
     ORDER BY leads.created_at DESC
     LIMIT 1`,
    [normalized],
  );
  return result.rows[0] || null;
}

export async function acceptPackageOffer(leadId) {
  const lead = await getLeadById(leadId);
  if (!lead?.pending_package_offer_id) {
    const error = new Error('No pending package offer for this lead');
    error.status = 404;
    throw error;
  }
  await attachPredefinedQuoteToLead(leadId, lead.pending_package_offer_id);
  await query(
    `UPDATE leads SET pending_package_offer_id = NULL WHERE id = $1`,
    [leadId],
  );
  return getLeadById(leadId);
}

/**
 * Starts the normal API search for a lead, by what it asked for: flights → flight quotes,
 * hotels → hotel quotes, a flight+hotel package → flights first (hotels follow).
 *
 * Used when a customer or agent turns down a predefined package offer. It used to start a
 * HOTEL search for everything that was not a package, so declining a flight offer would have
 * searched hotels for a flight request.
 */
export async function startQuoteFetchForLead(leadId) {
  const lead = await getLeadById(leadId);
  if (!lead) return null;

  if (lead.booking_type === 'flight') {
    return retryLeadQuotes(leadId);
  }
  if (lead.booking_type === 'package') {
    await setLeadQuoteStatus(leadId, 'processing', null, { phase: 'flights' });
    const { getQuoteQueue } = await import('../queues/quoteQueue.js');
    const queue = getQuoteQueue();
    const existing = await queue.getJob(`lead-${leadId}`);
    if (existing) await existing.remove();
    await enqueueFlightQuoteJob(leadId);
    return getLeadById(leadId);
  }
  return startHotelQuoteFetchForLead(leadId);
}

export async function declinePackageOffer(leadId) {
  const lead = await getLeadById(leadId);
  if (!lead?.pending_package_offer_id) {
    const error = new Error('No pending package offer for this lead');
    error.status = 404;
    throw error;
  }
  await query(
    `UPDATE leads SET pending_package_offer_id = NULL WHERE id = $1`,
    [leadId],
  );

  await startQuoteFetchForLead(leadId);
  await tryAutoTransitionLifecycle(leadId, 'sourcing_started');

  return getLeadById(leadId);
}

/**
 * Re-queue quote fetch (e.g. after an error).
 */
export async function retryLeadQuotes(id) {
  const lead = await getLeadById(id);
  if (!lead) return null;
  if (lead.booking_type !== 'flight') {
    const error = new Error('Quotes are only available for flight leads');
    error.status = 400;
    throw error;
  }

  await setLeadQuoteStatus(id, 'processing', null);
  try {
    // BullMQ rejects duplicate jobId while an old job exists — remove first
    const { getQuoteQueue } = await import('../queues/quoteQueue.js');
    const queue = getQuoteQueue();
    const existing = await queue.getJob(`lead-${id}`);
    if (existing) await existing.remove();
    await enqueueFlightQuoteJob(id);
  } catch (error) {
    await setLeadQuoteStatus(id, 'error', error.message);
    throw error;
  }

  return getLeadById(id);
}

export async function retryPackageQuotes(id) {
  const lead = await getLeadById(id);
  if (!lead) return null;
  if (lead.booking_type !== 'package') {
    const error = new Error('Package retry is only available for package leads');
    error.status = 400;
    throw error;
  }

  await setLeadQuoteStatus(id, 'processing', null, { phase: 'flights' });
  try {
    const { getQuoteQueue } = await import('../queues/quoteQueue.js');
    const { getHotelQuoteQueue } = await import('../queues/hotelQuoteQueue.js');
    const flightQueue = getQuoteQueue();
    const hotelQueue = getHotelQuoteQueue();
    const flightJob = await flightQueue.getJob(`lead-${id}`);
    if (flightJob) await flightJob.remove();
    const hotelJob = await hotelQueue.getJob(`hotel-lead-${id}`);
    if (hotelJob) await hotelJob.remove();
    await enqueueFlightQuoteJob(id);
    await tryAutoTransitionLifecycle(id, 'sourcing_started');
  } catch (error) {
    await setLeadQuoteStatus(id, 'error', error.message);
    throw error;
  }

  return getLeadById(id);
}

export async function createLeadFromInput(input) {
  const normalized = normalizeLeadInput(input);
  if (normalized.errors.length) {
    const error = new Error(normalized.errors.join('; '));
    error.status = 400;
    error.details = normalized.errors;
    throw error;
  }

  const bookingType = normalized.collected.booking_type;
  const matchedPackage = ['hotel', 'flight', 'package'].includes(bookingType)
    ? await findMatchingPackage(normalized.collected)
    : null;

  const lead = await createLead({
    phone: normalized.phone,
    collected: normalized.collected,
    summary: normalized.summary,
    status: normalized.status,
    source: normalized.source,
    skipQuoteFetch: Boolean(matchedPackage),
    pendingPackageOfferId: matchedPackage?.id || null,
  });

  return {
    lead,
    suggested_package: matchedPackage
      ? { id: matchedPackage.id, title: matchedPackage.title, destination: matchedPackage.destination }
      : null,
  };
}

export async function createLeadsBulk(rows = []) {
  const created = [];
  const failed = [];

  for (let i = 0; i < rows.length; i += 1) {
    try {
      const { lead } = await createLeadFromInput(rows[i]);
      created.push(lead);
    } catch (error) {
      failed.push({
        row: i + 1,
        error: error.message,
        data: rows[i],
      });
    }
  }

  return { created, failed };
}

async function provisionBookedCustomer(lead, { contact_name, contact_email } = {}) {
  const name = String(contact_name || lead.contact_name || '').trim();
  if (!name) {
    const error = new Error('Customer name is required when booking');
    error.status = 400;
    throw error;
  }
  const email = requireCustomerEmail(contact_email || lead.contact_email);
  const contact = await upsertContact({ phone: lead.phone, name, email });
  const provision = await ensureCustomerAccount({
    contactId: contact.id,
    email: contact.email || email,
    contactName: contact.name || name,
  });
  return { contact, provision };
}

export async function updateLeadStatus(id, status, { contact_name, contact_email } = {}) {
  const allowed = ['new', 'contacted', 'booked', 'archived'];
  if (!allowed.includes(status)) {
    const error = new Error('Invalid status');
    error.status = 400;
    throw error;
  }

  if (status === 'booked') {
    const lead = await getLeadById(id);
    if (!lead) return null;
    await provisionBookedCustomer(lead, { contact_name, contact_email });
    // Keep lifecycle in sync when staff books from the table bulk action.
    if (lead.lifecycle_status !== 'booked') {
      await query(`UPDATE leads SET status = $2, lifecycle_status = 'booked' WHERE id = $1`, [
        id,
        status,
      ]);
      return getLeadById(id);
    }
  }

  await query(`UPDATE leads SET status = $2 WHERE id = $1`, [id, status]);
  return getLeadById(id);
}

export async function deleteLead(id) {
  const result = await query(
    `DELETE FROM leads WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

export async function deleteLeads(ids = []) {
  if (!ids.length) return [];
  const result = await query(
    `DELETE FROM leads WHERE id = ANY($1::uuid[]) RETURNING *`,
    [ids],
  );
  return result.rows;
}

export async function listLeads(limit = 200) {
  const result = await query(
    `${LEAD_WITH_CONTACT_SQL} ORDER BY leads.created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function listUserLeads(userId, limit = 200) {
  const result = await query(
    `${LEAD_WITH_CONTACT_SQL}
     JOIN user_leads ON user_leads.lead_id = leads.id
     WHERE user_leads.user_id = $1
     ORDER BY user_leads.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

// ── Foundation: lead assignment and lifecycle ────────────────────────────────

const LIFECYCLE_TRANSITIONS = {
  intake: ['sourcing', 'archived', 'lost'],
  sourcing: ['awaiting_dealers', 'comparing', 'archived', 'lost'],
  awaiting_dealers: ['comparing', 'sourcing', 'archived', 'lost'],
  comparing: ['drafting', 'sourcing', 'archived', 'lost'],
  drafting: ['ready_to_send', 'comparing', 'archived', 'lost'],
  ready_to_send: ['sent', 'drafting', 'archived', 'lost'],
  sent: ['accepted', 'drafting', 'archived', 'lost'],
  accepted: ['booked', 'sent', 'archived'],
  booked: ['archived'],
  lost: ['intake'],
  archived: [],
};

const LIFECYCLE_TERMINAL = new Set(['booked', 'lost', 'archived']);

/** Stages a lead in `status` may legally move to. */
export function allowedLifecycleTargets(status) {
  return LIFECYCLE_TRANSITIONS[status || 'intake'] || [];
}

/**
 * Publishes the legal next stages on every lead read, so the UI can grey out
 * moves the API would reject instead of surfacing a 400 after the click.
 * Keeps the transition rules defined in exactly one place.
 */
export function withLifecycleOptions(lead) {
  if (!lead) return lead;
  return {
    ...lead,
    lifecycle_allowed: allowedLifecycleTargets(lead.lifecycle_status),
  };
}

export async function tryAutoTransitionLifecycle(leadId, event) {
  const lead = await getLeadById(leadId);
  if (!lead) return null;

  const current = lead.lifecycle_status || 'intake';
  if (LIFECYCLE_TERMINAL.has(current)) return lead;

  const targetByEvent = {
    sourcing_started: 'sourcing',
    quotes_completed: 'comparing',
    dealer_rfq_sent: 'awaiting_dealers',
    dealer_response_ready: 'comparing',
    quote_sent: 'sent',
    quote_accepted: 'accepted',
  };

  const target = targetByEvent[event];
  if (!target || target === current) return lead;

  try {
    return await transitionLifecycle(leadId, target);
  } catch {
    return lead;
  }
}

export async function assignLead(id, assignedTo) {
  const result = await query(
    `UPDATE leads SET assigned_to = $2 WHERE id = $1 RETURNING *`,
    [id, assignedTo || null],
  );
  return result.rows[0] || null;
}

export async function transitionLifecycle(
  id,
  targetStatus,
  { contact_name, contact_email } = {},
) {
  const lead = await getLeadById(id);
  if (!lead) {
    const error = new Error('Lead not found');
    error.status = 404;
    throw error;
  }
  const current = lead.lifecycle_status || 'intake';

  // Setting a lead to the stage it is already in is a no-op, not an error —
  // the stage path re-sends the current stage on a stray click.
  if (targetStatus === current) return lead;

  const allowed = allowedLifecycleTargets(current);
  if (!allowed.includes(targetStatus)) {
    const error = new Error(
      `Cannot transition lifecycle from '${current}' to '${targetStatus}'. ` +
        `Allowed: ${allowed.join(', ') || 'none'}`,
    );
    error.status = 400;
    throw error;
  }

  if (targetStatus === 'booked') {
    await provisionBookedCustomer(lead, { contact_name, contact_email });
    await query(
      `UPDATE leads SET lifecycle_status = $2, status = 'booked' WHERE id = $1`,
      [id, targetStatus],
    );
    return getLeadById(id);
  }

  await query(`UPDATE leads SET lifecycle_status = $2 WHERE id = $1`, [id, targetStatus]);

  // Re-read so the caller gets the same shape as every other lead response
  // (joined contact fields + a refreshed lifecycle_allowed), not a bare row.
  return getLeadById(id);
}

export { pool };

/**
 * True when a lead for this phone was created at or after `sinceMs`.
 * Lets a retried queue job detect that its previous attempt already created the
 * lead (then failed on a later step) instead of creating a duplicate.
 */
export async function leadCreatedSince(phone, sinceMs) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || !Number.isFinite(Number(sinceMs))) return false;
  const result = await query(
    `SELECT 1 FROM leads
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       AND created_at >= to_timestamp($2::double precision / 1000.0)
     LIMIT 1`,
    [digits, Number(sinceMs)],
  );
  return result.rowCount > 0;
}
