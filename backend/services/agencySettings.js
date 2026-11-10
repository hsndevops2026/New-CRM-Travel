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
});

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
