import { query } from '../config/database.js';

export const DEFAULT_AGENCY_SETTINGS = Object.freeze({
  agency_name: process.env.AGENCY_NAME || 'Horizon',
  agency_slug: process.env.AGENCY_SLUG || 'horizon',
  logo_url: process.env.AGENCY_LOGO_URL || null,
  primary_color: process.env.AGENCY_PRIMARY_COLOR || '#0f766e',
  quotation_template: process.env.AGENCY_QUOTATION_TEMPLATE || 'classic',
  phone: process.env.AGENCY_PHONE || null,
  email: process.env.AGENCY_EMAIL || null,
  website: process.env.AGENCY_WEBSITE || null,
  address: process.env.AGENCY_ADDRESS || null,
  quotation_footer:
    process.env.AGENCY_QUOTATION_FOOTER ||
    'Prices are indicative and subject to availability.',
  quote_approval_mode: 'agents',
  quote_approval_min_margin: 10,
  quote_approval_min_margin_type: 'percent',
  auto_quote_followup: false,
  quote_followup_hours: 48,
  lead_wait_alert_minutes: 15,
  auto_trip_messages: false,
  google_review_url: null,
  emergency_phone: null,
});

export const QUOTE_APPROVAL_MODES = ['off', 'agents', 'below_margin'];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function optionalText(value, maxLength, field) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (text.length > maxLength) throw httpError(400, `${field} is too long`);
  return text || null;
}

function validateUrl(value, field) {
  const text = optionalText(value, 2000, field);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw httpError(400, `${field} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw httpError(400, `${field} must use http or https`);
  }
  return url.toString();
}

export function normalizeAgencySettings(input = {}, { partial = false } = {}) {
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  if (!partial || has('agency_name')) {
    const name = optionalText(input.agency_name, 160, 'agency_name');
    if (!name) throw httpError(400, 'agency_name is required');
    output.agency_name = name;
  }
  if (!partial || has('logo_url')) output.logo_url = validateUrl(input.logo_url, 'logo_url');
  if (!partial || has('primary_color')) {
    const color = String(input.primary_color || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw httpError(400, 'primary_color must be a 6-digit hex color');
    }
    output.primary_color = color.toLowerCase();
  }
  if (!partial || has('quotation_template')) {
    const template = String(input.quotation_template || '').trim().toLowerCase();
    if (!['classic', 'modern'].includes(template)) {
      throw httpError(400, 'quotation_template must be classic or modern');
    }
    output.quotation_template = template;
  }
  for (const [field, maxLength] of [
    ['phone', 64],
    ['email', 320],
    ['address', 500],
    ['quotation_footer', 500],
  ]) {
    if (!partial || has(field)) output[field] = optionalText(input[field], maxLength, field);
  }
  if (!partial || has('website')) output.website = validateUrl(input.website, 'website');
  if (has('quote_approval_mode')) {
    const mode = String(input.quote_approval_mode || '').trim();
    if (!QUOTE_APPROVAL_MODES.includes(mode)) throw httpError(400, 'quote_approval_mode must be off, agents or below_margin');
    output.quote_approval_mode = mode;
  }
  for (const key of ['auto_quote_followup', 'auto_trip_messages']) {
    if (has(key)) output[key] = input[key] === true || input[key] === 'true';
  }
  if (has('quote_followup_hours')) {
    const hours = Number(input.quote_followup_hours);
    if (!Number.isInteger(hours) || hours < 6 || hours > 24 * 14) throw httpError(400, 'quote_followup_hours must be between 6 and 336');
    output.quote_followup_hours = hours;
  }
  if (has('lead_wait_alert_minutes')) {
    const minutes = Number(input.lead_wait_alert_minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) throw httpError(400, 'lead_wait_alert_minutes must be between 0 and 1440');
    output.lead_wait_alert_minutes = minutes;
  }
  if (has('google_review_url')) output.google_review_url = validateUrl(input.google_review_url, 'google_review_url');
  if (has('emergency_phone')) output.emergency_phone = optionalText(input.emergency_phone, 64, 'emergency_phone');
  if (has('quote_approval_min_margin_type')) {
    const type = String(input.quote_approval_min_margin_type || '').trim();
    if (!['percent', 'fixed'].includes(type)) throw httpError(400, 'quote_approval_min_margin_type must be percent or fixed');
    output.quote_approval_min_margin_type = type;
  }
  if (has('quote_approval_min_margin')) {
    const margin = Number(input.quote_approval_min_margin);
    const type = output.quote_approval_min_margin_type || input.quote_approval_min_margin_type || 'percent';
    const max = type === 'fixed' ? 10_000_000 : 100;
    if (!Number.isFinite(margin) || margin < 0 || margin > max) {
      throw httpError(400, type === 'fixed' ? 'The minimum profit must be a positive amount' : 'quote_approval_min_margin must be between 0 and 100');
    }
    output.quote_approval_min_margin = Math.round(margin * 100) / 100;
  }

  if (output.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.email)) {
    throw httpError(400, 'email must be valid');
  }
  return output;
}

export async function getAgencySettings() {
  const result = await query('SELECT * FROM agency_settings WHERE id = 1');
  return result.rows[0] || { id: 1, ...DEFAULT_AGENCY_SETTINGS };
}

export async function updateAgencySettings(input) {
  const normalized = normalizeAgencySettings(input, { partial: true });
  const fields = Object.keys(normalized);
  if (!fields.length) return getAgencySettings();

  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => normalized[field]);
  const result = await query(
    `UPDATE agency_settings
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = 1
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export function publicAgencySettings(settings) {
  const value = settings || DEFAULT_AGENCY_SETTINGS;
  return {
    agency_name: value.agency_name,
    logo_url: value.logo_url,
    primary_color: value.primary_color,
    quotation_template: value.quotation_template,
    phone: value.phone,
    email: value.email,
    website: value.website,
    address: value.address,
    quotation_footer: value.quotation_footer,
  };
}

/**
 * Does a quote locked by this person need a manager's OK before it goes to the customer?
 * Admins never need it. `marginPct` is the quote's gross margin in percent.
 */
export function quoteNeedsApproval(settings, { role, marginPct, marginAmount }) {
  if (role === 'admin') return false;
  const mode = settings?.quote_approval_mode || DEFAULT_AGENCY_SETTINGS.quote_approval_mode;
  if (mode === 'off') return false;
  if (mode === 'agents') return true;
  const min = Number(settings?.quote_approval_min_margin ?? DEFAULT_AGENCY_SETTINGS.quote_approval_min_margin);
  // The manager sets the floor as a percentage of the price, or as a profit amount in the
  // quote's currency.
  const actual = settings?.quote_approval_min_margin_type === 'fixed' ? Number(marginAmount) : Number(marginPct);
  return !Number.isFinite(actual) || actual < min;
}

/** What staff see in Settings: the public fields plus internal rules like quote approval. */
export function staffAgencySettings(settings) {
  const value = settings || DEFAULT_AGENCY_SETTINGS;
  return {
    ...publicAgencySettings(value),
    quote_approval_mode: value.quote_approval_mode || DEFAULT_AGENCY_SETTINGS.quote_approval_mode,
    quote_approval_min_margin: Number(value.quote_approval_min_margin ?? DEFAULT_AGENCY_SETTINGS.quote_approval_min_margin),
    quote_approval_min_margin_type: value.quote_approval_min_margin_type || 'percent',
    auto_quote_followup: Boolean(value.auto_quote_followup),
    quote_followup_hours: Number(value.quote_followup_hours ?? 48),
    lead_wait_alert_minutes: Number(value.lead_wait_alert_minutes ?? 15),
    auto_trip_messages: Boolean(value.auto_trip_messages),
    google_review_url: value.google_review_url || null,
    emergency_phone: value.emergency_phone || null,
  };
}
