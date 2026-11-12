import { query } from '../config/database.js';
import { getContactById, normalizeContactPhone } from './contacts.js';
import { listDocumentsForPhone } from './bookingDocuments.js';
import { listMessagesForLead } from './messages.js';
import { getAgencySettings, publicAgencySettings } from './agencySettings.js';
import { listTripPlan } from './tripPlan.js';

export async function listBookingsForPhone(phone) {
  const digits = normalizeContactPhone(phone);
  if (!digits) return [];
  const result = await query(
    `SELECT leads.id, leads.phone, leads.booking_type, leads.origin, leads.destination,
            leads.travel_date, leads.return_date, leads.nights, leads.adults_count,
            leads.children_count, leads.status, leads.lifecycle_status, leads.hotel_name,
            leads.created_at, contacts.name AS contact_name, contacts.email AS contact_email
     FROM leads
     LEFT JOIN contacts ON contacts.phone = regexp_replace(leads.phone, '\\D', '', 'g')
     WHERE regexp_replace(leads.phone, '\\D', '', 'g') = $1
     ORDER BY leads.travel_date DESC NULLS LAST, leads.created_at DESC`,
    [digits],
  );
  return result.rows;
}

export async function getCustomerPortal(customer) {
  if (!customer?.contact_id) {
    const error = new Error('Customer account is not linked to a contact');
    error.status = 400;
    throw error;
  }

  const contact = await getContactById(customer.contact_id);
  if (!contact) {
    const error = new Error('Contact not found for this customer');
    error.status = 404;
    throw error;
  }

  const bookings = await listBookingsForPhone(contact.phone);
  // The day-by-day program, for trips that are booked.
  for (const booking of bookings) {
    const booked = booking.lifecycle_status === 'booked' || booking.status === 'booked';
    booking.program = booked
      ? (await listTripPlan(booking.id)).map(({ day_number, title, details, kind }) => ({ day_number, title, details, kind }))
      : [];
  }
  const documents = await listDocumentsForPhone(contact.phone);

  const chats = [];
  for (const booking of bookings) {
    const messages = await listMessagesForLead(booking.id, {
      limit: 200,
      phone: contact.phone,
    });
    if (!messages.length) continue;
    chats.push({
      lead_id: booking.id,
      destination: booking.destination,
      travel_date: booking.travel_date,
      booking_type: booking.booking_type,
      message_count: messages.length,
      last_message_at: messages[messages.length - 1]?.created_at || null,
      messages,
    });
  }

  const agency = publicAgencySettings(await getAgencySettings());

  return {
    customer: {
      id: customer.id,
      email: customer.email,
      contact_id: contact.id,
      name: contact.name,
      phone: contact.phone,
    },
    agency,
    bookings,
    documents,
    chats,
  };
}
