import { getPredefinedQuote } from './predefinedQuotes.js';
import { formatPackageOfferMessage } from './packageOffer.js';
import { sendTextMessage } from './wasender.js';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** Digits only, 8–15 of them (E.164 allows at most 15). Anything else is not a phone number. */
export function normalizeCustomerPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw httpError(400, 'Enter the customer’s WhatsApp number with its country code');
  }
  return `+${digits}`;
}

/** The WhatsApp text a customer gets: the package as an offer, with an optional note first. */
export function customerQuoteMessage(quote, note) {
  const body = formatPackageOfferMessage(quote, 'en', { question: false });
  const intro = String(note ?? '').trim();
  return intro ? `${intro}\n\n${body}` : body;
}

/**
 * Sends a library package straight to a customer's WhatsApp number — the customer-facing
 * counterpart of sending it to a dealer. `send` is injectable so tests never hit WhatsApp.
 */
export async function sendQuoteToCustomer({ quoteId, phone, note }, { send = sendTextMessage } = {}) {
  const to = normalizeCustomerPhone(phone);
  const quote = await getPredefinedQuote(quoteId);
  if (!quote) throw httpError(404, 'Quote not found');
  const message = customerQuoteMessage(quote, note);
  await send(to, message);
  return { quote, to, message };
}
