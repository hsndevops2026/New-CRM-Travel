import { query } from '../config/database.js';

/**
 * Which language a customer gets messages in. Order:
 *   1. what staff set on the contact (contacts.preferred_language),
 *   2. the language of their latest WhatsApp conversation with the bot,
 *   3. Arabic (the agency's default).
 */
export const CUSTOMER_LANGUAGES = ['ar', 'en'];
export const DEFAULT_CUSTOMER_LANGUAGE = 'ar';

export function normalizeLanguage(value, fallback = DEFAULT_CUSTOMER_LANGUAGE) {
  const v = String(value || '').toLowerCase().slice(0, 2);
  return CUSTOMER_LANGUAGES.includes(v) ? v : fallback;
}

function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export async function customerLanguage(phone) {
  const key = digits(phone);
  if (!key) return DEFAULT_CUSTOMER_LANGUAGE;
  const { rows } = await query(
    `SELECT
       (SELECT preferred_language FROM contacts
         WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1) AS preferred,
       (SELECT language FROM conversations
         WHERE regexp_replace(phone, '\\D', '', 'g') = $1
         ORDER BY updated_at DESC NULLS LAST LIMIT 1) AS spoken`,
    [key],
  );
  const row = rows[0] || {};
  if (row.preferred) return normalizeLanguage(row.preferred);
  if (row.spoken) return normalizeLanguage(row.spoken);
  return DEFAULT_CUSTOMER_LANGUAGE;
}

/** Arabic dates read better with Arabic month names but Western digits (what customers here use). */
export function formatCustomerDate(value, lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: process.env.AGENCY_TIMEZONE || 'Asia/Jerusalem',
  });
}
