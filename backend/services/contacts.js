import { query } from '../config/database.js';
import { normalizeEmail } from './admins.js';

export function normalizeContactPhone(phone) {
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
  const value = normalizeContactPhone(phone);
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

function optionalEmail(email) {
  if (email == null || email === '') return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (!normalized.includes('@') || !normalized.includes('.')) {
    const error = new Error('email must be valid');
    error.status = 400;
    throw error;
  }
  return normalized;
}

export async function upsertContact({ phone, name, email } = {}) {
  const normalized = requirePhone(phone);
  const contactName = requireName(name);
  const contactEmail = email !== undefined ? optionalEmail(email) : undefined;

  try {
    if (contactEmail !== undefined) {
      const result = await query(
        `INSERT INTO contacts (phone, name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE
           SET name = EXCLUDED.name,
               email = COALESCE(EXCLUDED.email, contacts.email),
               updated_at = NOW()
         RETURNING *`,
        [normalized, contactName, contactEmail],
      );
      return result.rows[0];
    }

    const result = await query(
      `INSERT INTO contacts (phone, name)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name,
             updated_at = NOW()
       RETURNING *`,
      [normalized, contactName],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const conflict = new Error(
        String(error.constraint || error.message || '').toLowerCase().includes('email')
          ? 'A contact with this email already exists'
          : 'A contact with this phone number already exists',
      );
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

export async function getContactByPhone(phone) {
  const normalized = normalizeContactPhone(phone);
  if (!normalized) return null;
  const result = await query(`SELECT * FROM contacts WHERE phone = $1`, [normalized]);
  return result.rows[0] || null;
}

export async function getContactById(id) {
  const result = await query(`SELECT * FROM contacts WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function listContacts({ query: search = '', limit = 200 } = {}) {
  const term = String(search || '').trim();
  if (!term) {
    const result = await query(
      `SELECT * FROM contacts ORDER BY name ASC, created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  const result = await query(
    `SELECT * FROM contacts
     WHERE name ILIKE $1 OR phone ILIKE $2 OR COALESCE(email, '') ILIKE $1
     ORDER BY name ASC, created_at DESC
     LIMIT $3`,
    [`%${term}%`, `%${normalizeContactPhone(term) || term}%`, limit],
  );
  return result.rows;
}

export async function updateContact(id, { name, phone, email, preferred_language } = {}) {
  const existing = await getContactById(id);
  if (!existing) return null;

  const contactName = name !== undefined ? requireName(name) : existing.name;
  const contactPhone = phone !== undefined ? requirePhone(phone) : existing.phone;
  const contactEmail =
    email !== undefined ? optionalEmail(email) : existing.email || null;
  // '' or null clears the override (the WhatsApp conversation decides again).
  let language = existing.preferred_language ?? null;
  if (preferred_language !== undefined) {
    if (preferred_language === null || preferred_language === '') language = null;
    else if (['ar', 'en'].includes(preferred_language)) language = preferred_language;
    else {
      const error = new Error('preferred_language must be ar or en');
      error.status = 400;
      throw error;
    }
  }

  try {
    const result = await query(
      `UPDATE contacts
       SET name = $2, phone = $3, email = $4, preferred_language = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, contactName, contactPhone, contactEmail, language],
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === '23505') {
      const conflict = new Error(
        String(error.constraint || '').includes('email')
          ? 'A contact with this email already exists'
          : 'A contact with this phone number already exists',
      );
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

export async function deleteContact(id) {
  const result = await query(`DELETE FROM contacts WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}
