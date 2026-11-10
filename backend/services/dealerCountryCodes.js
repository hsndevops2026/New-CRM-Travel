import { query } from '../config/database.js';

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeInput({ name, iso_code, dial_code } = {}) {
  const normalizedName = String(name || '').trim();
  const normalizedIso = String(iso_code || '').trim().toUpperCase() || null;
  const normalizedDial = String(dial_code || '').replace(/\D/g, '');

  if (!normalizedName) throw validationError('Country name is required');
  if (!/^[0-9]{1,3}$/.test(normalizedDial)) {
    throw validationError('Calling code must contain 1 to 3 digits');
  }
  if (normalizedIso && !/^[A-Z]{2}$/.test(normalizedIso)) {
    throw validationError('ISO code must contain exactly 2 letters');
  }
  return { name: normalizedName, iso_code: normalizedIso, dial_code: normalizedDial };
}

function duplicateError(error) {
  if (error.code !== '23505') return error;
  const conflict = new Error('This calling code already exists');
  conflict.status = 409;
  return conflict;
}

async function assertDialCodeUnused(dialCode) {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM dealers WHERE phone LIKE $1`,
    [`${dialCode}%`],
  );
  if (result.rows[0]?.count > 0) {
    const error = new Error('This calling code is used by a dealer and cannot be changed or deleted');
    error.status = 409;
    throw error;
  }
}

export async function listDealerCountryCodes() {
  const result = await query(
    `SELECT id, name, iso_code, dial_code, created_at, updated_at
     FROM dealer_country_codes
     ORDER BY name ASC`,
  );
  return result.rows;
}

export async function createDealerCountryCode(input) {
  const value = normalizeInput(input);
  try {
    const result = await query(
      `INSERT INTO dealer_country_codes (name, iso_code, dial_code)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [value.name, value.iso_code, value.dial_code],
    );
    return result.rows[0];
  } catch (error) {
    throw duplicateError(error);
  }
}

export async function updateDealerCountryCode(id, input) {
  const existing = await query(`SELECT * FROM dealer_country_codes WHERE id = $1`, [id]);
  if (!existing.rows[0]) return null;
  const value = normalizeInput(input);
  if (value.dial_code !== existing.rows[0].dial_code) {
    await assertDialCodeUnused(existing.rows[0].dial_code);
  }
  try {
    const result = await query(
      `UPDATE dealer_country_codes
       SET name = $2, iso_code = $3, dial_code = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, value.name, value.iso_code, value.dial_code],
    );
    return result.rows[0] || null;
  } catch (error) {
    throw duplicateError(error);
  }
}

export async function deleteDealerCountryCode(id) {
  const existing = await query(`SELECT * FROM dealer_country_codes WHERE id = $1`, [id]);
  if (!existing.rows[0]) return null;
  await assertDialCodeUnused(existing.rows[0].dial_code);
  const result = await query(
    `DELETE FROM dealer_country_codes WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}
