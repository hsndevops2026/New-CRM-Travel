import { query } from '../config/database.js';
import { getContactById, normalizeContactPhone } from './contacts.js';
import { listDocumentsForLeads } from './bookingDocuments.js';
import { listRemindersForContact } from './reminders.js';
import { listThreads } from './inbox.js';

const LEAD_WITH_CONTACT_SQL = `
  SELECT leads.*,
    contacts.name AS contact_name,
    predefined_quotes.title AS predefined_quote_title,
    predefined_quotes.quote_type AS predefined_quote_type
  FROM leads
  LEFT JOIN contacts ON contacts.phone = regexp_replace(leads.phone, '\\D', '', 'g')
  LEFT JOIN predefined_quotes ON predefined_quotes.id = leads.predefined_quote_id
`;

export async function listLeadsForContactPhone(phone) {
  const digits = normalizeContactPhone(phone);
  if (!digits) return [];
  const result = await query(
    `${LEAD_WITH_CONTACT_SQL}
     WHERE regexp_replace(leads.phone, '\\D', '', 'g') = $1
     ORDER BY leads.created_at DESC`,
    [digits],
  );
  return result.rows;
}

export async function getContactProfile(contactId, { userId = null } = {}) {
  const contact = await getContactById(contactId);
  if (!contact) return null;

  const [bookings, reminders, threadsResult] = await Promise.all([
    listLeadsForContactPhone(contact.phone),
    listRemindersForContact(contactId),
    listThreads({ kind: 'customer', limit: 200, userId }),
  ]);

  const leadIds = bookings.map((b) => b.id);
  const documents = await listDocumentsForLeads(leadIds);
  const docsByLead = new Map();
  for (const doc of documents) {
    const list = docsByLead.get(doc.lead_id) || [];
    list.push(doc);
    docsByLead.set(doc.lead_id, list);
  }

  const bookingsWithDocs = bookings.map((lead) => ({
    ...lead,
    documents: docsByLead.get(lead.id) || [],
  }));

  const phoneDigits = normalizeContactPhone(contact.phone);
  const leadIdSet = new Set(leadIds);
  const threads = (threadsResult.threads || []).filter((thread) => {
    if (thread.lead_id && leadIdSet.has(thread.lead_id)) return true;
    if (thread.phone && normalizeContactPhone(thread.phone) === phoneDigits) return true;
    return false;
  });

  return {
    contact,
    bookings: bookingsWithDocs,
    threads,
    reminders,
  };
}
