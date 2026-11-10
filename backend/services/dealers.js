import { query } from '../config/database.js';
import { getPredefinedQuote } from './predefinedQuotes.js';
import { normalizeGroupJid, sendTextMessage } from './wasender.js';

export function normalizeDealerPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function requireName(name) {
  const value = String(name || '').trim();
  if (!value) {
    const error = new Error('name is required');
    error.status = 400;
    throw error;
  }
  return value;
}

function requirePhone(phone) {
  const value = normalizeDealerPhone(phone);
  if (!value) {
    const error = new Error('phone is required');
    error.status = 400;
    throw error;
  }
  if (value.length < 8 || value.length > 15) {
    const error = new Error(
      'Enter a WhatsApp number with country code, e.g. +971 50 123 4567',
    );
    error.status = 400;
    throw error;
  }
  return value;
}

export async function listDealers({ query: search = '', limit = 200 } = {}) {
  const term = String(search || '').trim();
  if (!term) {
    const result = await query(
      `SELECT * FROM dealers ORDER BY name ASC, created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  const result = await query(
    `SELECT * FROM dealers
     WHERE name ILIKE $1 OR phone ILIKE $2 OR company ILIKE $1
     ORDER BY name ASC, created_at DESC
     LIMIT $3`,
    [`%${term}%`, `%${normalizeDealerPhone(term) || term}%`, limit],
  );
  return result.rows;
}

export async function upsertDealer({ name, phone, company, notes, whatsapp_group_id, destinations, services }) {
  const normalized = requirePhone(phone);
  const dealerName = requireName(name);
  const dealerCompany = String(company || '').trim() || null;
  const dealerNotes = String(notes || '').trim() || null;
  const groupId = String(whatsapp_group_id || '').trim() || null;
  const normalizedGroup = groupId ? normalizeGroupJid(groupId) || groupId : null;
  const dests = Array.isArray(destinations) ? destinations : [];
  const svcs = Array.isArray(services) ? services : [];

  const result = await query(
    `INSERT INTO dealers (name, phone, company, notes, whatsapp_group_id, destinations, services)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (phone) DO UPDATE
       SET name = EXCLUDED.name,
           company = EXCLUDED.company,
           notes = EXCLUDED.notes,
           whatsapp_group_id = EXCLUDED.whatsapp_group_id,
           destinations = EXCLUDED.destinations,
           services = EXCLUDED.services,
           updated_at = NOW()
     RETURNING *`,
    [dealerName, normalized, dealerCompany, dealerNotes, normalizedGroup, dests, svcs],
  );
  return result.rows[0];
}

export async function listDealerSavedGroups() {
  const result = await query(
    `SELECT name, whatsapp_group_id
     FROM dealers
     WHERE whatsapp_group_id IS NOT NULL AND btrim(whatsapp_group_id) <> ''
     ORDER BY name ASC`,
  );
  const seen = new Set();
  const groups = [];
  for (const row of result.rows) {
    const jid = normalizeGroupJid(row.whatsapp_group_id);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    groups.push({
      jid,
      name: `${row.name} group`,
      imgUrl: null,
      source: 'dealer',
    });
  }
  return groups;
}

export async function getDealerById(id) {
  const result = await query(`SELECT * FROM dealers WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function updateDealer(id, { name, phone, company, notes, whatsapp_group_id, destinations, services } = {}) {
  const existing = await getDealerById(id);
  if (!existing) return null;

  const dealerName = name !== undefined ? requireName(name) : existing.name;
  const dealerPhone = phone !== undefined ? requirePhone(phone) : existing.phone;
  const dealerCompany =
    company !== undefined ? (String(company || '').trim() || null) : existing.company;
  const dealerNotes =
    notes !== undefined ? (String(notes || '').trim() || null) : existing.notes;
  const groupId =
    whatsapp_group_id !== undefined
      ? (String(whatsapp_group_id || '').trim() || null)
      : existing.whatsapp_group_id;
  const savedGroupId = groupId ? normalizeGroupJid(groupId) || groupId : null;
  const dests = destinations !== undefined ? (Array.isArray(destinations) ? destinations : []) : existing.destinations;
  const svcs = services !== undefined ? (Array.isArray(services) ? services : []) : existing.services;

  try {
    const result = await query(
      `UPDATE dealers
       SET name = $2, phone = $3, company = $4, notes = $5,
           whatsapp_group_id = $6, destinations = $7, services = $8, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, dealerName, dealerPhone, dealerCompany, dealerNotes, savedGroupId, dests, svcs],
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === '23505') {
      const conflict = new Error('A dealer with this phone number already exists');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

export async function deleteDealer(id) {
  const result = await query(`DELETE FROM dealers WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}

function formatQuoteMessage(quote) {
  const lines = [];
  lines.push(`*Package: ${quote.title}*`);
  if (quote.destination) lines.push(`Destination: ${quote.destination}`);
  if (quote.travel_date && quote.return_date) {
    lines.push(`Dates: ${quote.travel_date} → ${quote.return_date}`);
  } else if (quote.travel_date) {
    lines.push(`Travel date: ${quote.travel_date}`);
  }
  const adults = quote.adults_count ?? 2;
  const children = quote.children_count ?? 0;
  lines.push(`Guests: ${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`);
  if (quote.total_price != null) {
    lines.push(`Total: ${quote.currency || 'USD'} ${Number(quote.total_price).toLocaleString()}`);
  }
  if (quote.description) lines.push('', quote.description);
  return lines.join('\n');
}

export async function sendQuoteToDealer({ dealerId, quoteId }) {
  const dealer = await getDealerById(dealerId);
  if (!dealer) {
    const error = new Error('Dealer not found');
    error.status = 404;
    throw error;
  }

  const quote = await getPredefinedQuote(quoteId);
  if (!quote) {
    const error = new Error('Quote not found');
    error.status = 404;
    throw error;
  }

  const message = formatQuoteMessage(quote);
  await sendTextMessage(dealer.phone, message);
  return { dealer, quote };
}
