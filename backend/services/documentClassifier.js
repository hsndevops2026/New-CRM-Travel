import OpenAI from 'openai';
import { openaiConfig } from '../config/openai.js';

/**
 * Reads an uploaded booking file (ticket, hotel voucher, trip program, visa…), says what
 * kind of document it is and pulls the few details needed to give it a clear name.
 * Adapted from the Insurance CRM's document classifier, using the OpenAI client this
 * project already has instead of Gemini.
 *
 * The extracted details only name the file. Nothing here is written to the booking itself.
 */

export const DOCUMENT_TYPES = [
  'flight_ticket',
  'hotel_voucher',
  'trip_program',
  'visa',
  'passport',
  'travel_insurance',
  'transfer',
  'tour_activity',
  'invoice_receipt',
  'id_card',
  'other',
];

/** Arabic labels used in the new file name. Arabic is the office's working language. */
export const DOCUMENT_TYPE_LABELS = {
  flight_ticket: 'تذكرة طيران',
  hotel_voucher: 'حجز فندق',
  trip_program: 'برنامج الرحلة',
  visa: 'تأشيرة',
  passport: 'جواز سفر',
  travel_insurance: 'تأمين سفر',
  transfer: 'مواصلات',
  tour_activity: 'جولة',
  invoice_receipt: 'فاتورة',
  id_card: 'هوية',
  other: 'مستند',
};

const MAX_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

const nullable = { type: ['string', 'null'] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'traveler_name', 'destination', 'provider', 'reference', 'start_date', 'end_date'],
  properties: {
    document_type: { type: 'string', enum: DOCUMENT_TYPES },
    traveler_name: { ...nullable, description: 'Main passenger or guest name as printed' },
    destination: { ...nullable, description: 'City or country of travel; for a flight "FROM-TO" using city names or airport codes' },
    provider: { ...nullable, description: 'Airline, hotel name, insurer, or tour company' },
    reference: { ...nullable, description: 'Flight number (e.g. TK 789) for tickets; booking/confirmation number otherwise. Never a passport or ID number.' },
    start_date: { ...nullable, description: 'ISO yyyy-mm-dd: departure, check-in or validity start' },
    end_date: { ...nullable, description: 'ISO yyyy-mm-dd: return, check-out or validity end' },
  },
};

const PROMPT = [
  'This file was uploaded to a travel agency CRM for a customer booking.',
  'It may be in Arabic, Hebrew, English or Turkish, or a mix.',
  'Classify it: flight_ticket (e-ticket or itinerary receipt), hotel_voucher (hotel booking/voucher/confirmation),',
  'trip_program (day-by-day program or itinerary of a tour package), visa, passport, travel_insurance,',
  'transfer (airport pickup, car rental, bus), tour_activity (excursion/activity ticket), invoice_receipt,',
  'id_card, or other.',
  'Then read only what is printed. If a value is missing or unreadable, return null. Do not guess.',
  'Never return passport numbers, ID numbers or card numbers in any field.',
].join(' ');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max = 60) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function cleanDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value.trim()) ? value.trim() : null;
}

export function normalizeClassification(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    document_type: DOCUMENT_TYPES.includes(r.document_type) ? r.document_type : 'other',
    traveler_name: cleanText(r.traveler_name),
    destination: cleanText(r.destination),
    provider: cleanText(r.provider),
    reference: cleanText(r.reference, 30),
    start_date: cleanDate(r.start_date),
    end_date: cleanDate(r.end_date),
  };
}

/**
 * The new name: "{type} - {main detail} - {dates}".
 *   تذكرة طيران - Turkish Airlines TK 789 - IST-TLV - 2026-12-01
 *   حجز فندق - Hilton Istanbul - 2026-12-01 → 2026-12-06
 *   برنامج الرحلة - تركيا
 */
export function buildDocumentTitle(info, fallback = '') {
  const c = normalizeClassification(info);
  const label = DOCUMENT_TYPE_LABELS[c.document_type];
  const dates = c.start_date && c.end_date && c.end_date !== c.start_date
    ? `${c.start_date} → ${c.end_date}`
    : c.start_date || c.end_date;
  let parts;
  switch (c.document_type) {
    case 'flight_ticket':
      parts = [[c.provider, c.reference].filter(Boolean).join(' '), c.destination, dates];
      break;
    case 'hotel_voucher':
      parts = [c.provider || c.destination, dates];
      break;
    case 'trip_program':
      parts = [c.destination || c.provider, dates];
      break;
    case 'visa':
    case 'travel_insurance':
      parts = [c.traveler_name, c.destination, dates];
      break;
    case 'passport':
    case 'id_card':
      parts = [c.traveler_name];
      break;
    case 'other':
      return cleanText(fallback, 120) || label;
    default:
      parts = [c.provider, c.destination, dates];
  }
  return [label, ...parts.filter(Boolean)].join(' - ').slice(0, 200);
}

export function canClassify(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  return mime === 'application/pdf' || IMAGE_MIME.test(mime);
}

const defaultClient = openaiConfig.apiKey ? new OpenAI({ apiKey: openaiConfig.apiKey }) : null;

/** Only our own Cloudinary uploads are fetched, so a crafted URL can't make the server call elsewhere. */
export function isFetchableUpload(fileUrl) {
  try {
    const url = new URL(fileUrl);
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    return url.protocol === 'https:'
      && url.hostname === 'res.cloudinary.com'
      && (!cloud || url.pathname.startsWith(`/${cloud}/`));
  } catch {
    return false;
  }
}

async function downloadUpload(fileUrl, fetchImpl) {
  const res = await fetchImpl(fileUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error('File too large to read');
  return buffer;
}

/**
 * Returns the classification, or null when the file can't be read (no API key, unsupported
 * type, download/AI error). A null result means "keep the original name".
 */
export async function classifyUploadedDocument({
  fileUrl,
  mimeType,
  fileName,
  ai = defaultClient,
  model = openaiConfig.importModel,
  fetchImpl = fetch,
} = {}) {
  if (!ai || !canClassify(mimeType) || !isFetchableUpload(fileUrl)) return null;
  try {
    const buffer = await downloadUpload(fileUrl, fetchImpl);
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    const content = String(mimeType).toLowerCase() === 'application/pdf'
      ? { type: 'input_file', filename: String(fileName || 'document.pdf').slice(0, 255), file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl, detail: 'high' };
    const response = await ai.responses.create({
      model,
      store: false,
      input: [{ role: 'user', content: [content, { type: 'input_text', text: PROMPT }] }],
      text: { format: { type: 'json_schema', name: 'booking_document', strict: true, schema: SCHEMA } },
    });
    if (response.status === 'incomplete') return null;
    return normalizeClassification(JSON.parse(response.output_text || '{}'));
  } catch (error) {
    console.warn('Document classification failed, keeping the original name:', error.message);
    return null;
  }
}
