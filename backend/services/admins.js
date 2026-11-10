import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import { authConfig } from '../config/auth.js';

const BCRYPT_ROUNDS = 12;

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < authConfig.passwordMinLength) {
    const error = new Error(
      `Password must be at least ${authConfig.passwordMinLength} characters`,
    );
    error.status = 400;
    throw error;
  }
  return value;
}

export function publicAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role || 'admin',
    approval_status: row.approval_status || 'approved',
    lead_credits: Number(row.lead_credits || 0),
    leads_used: Number(row.leads_used || 0),
    contact_id: row.contact_id || null,
    created_at: row.created_at,
  };
}

export async function findAdminByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await query(`SELECT * FROM admins WHERE email = $1 LIMIT 1`, [
    normalized,
  ]);
  return result.rows[0] || null;
}

export async function findAdminById(id) {
  if (!id) return null;
  const result = await query(`SELECT * FROM admins WHERE id = $1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

const STAFF_OR_CUSTOMER_ROLES = new Set(['admin', 'agent', 'customer']);

export async function createAdmin({
  email,
  password,
  role = 'agent',
  approvalStatus = 'pending',
  contactId = null,
} = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    const error = new Error('A valid email is required');
    error.status = 400;
    throw error;
  }
  if (!STAFF_OR_CUSTOMER_ROLES.has(role)) {
    const error = new Error('Invalid role');
    error.status = 400;
    throw error;
  }
  // Public signup must never create customer or bootstrap admin accounts.
  if (role === 'customer' && !contactId) {
    const error = new Error('Customer accounts require a contact');
    error.status = 400;
    throw error;
  }

  const validatedPassword = validatePassword(password);
  const existing = await findAdminByEmail(normalized);
  if (existing) {
    const error = new Error('An account with this email already exists');
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(validatedPassword, BCRYPT_ROUNDS);
  const result = await query(
    `INSERT INTO admins (email, password_hash, role, approval_status, lead_credits, contact_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, role, approval_status, lead_credits, leads_used, created_at, contact_id`,
    [
      normalized,
      passwordHash,
      role,
      approvalStatus,
      role === 'agent' ? 3 : 0,
      contactId || null,
    ],
  );

  return result.rows[0];
}

export async function ensureBootstrapAdmin(env = process.env) {
  const email = normalizeEmail(env.INITIAL_ADMIN_EMAIL);
  const password = String(env.INITIAL_ADMIN_PASSWORD_MIN_12_CHARS || '');

  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error(
      'Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD_MIN_12_CHARS.',
    );
  }

  const existing = await findAdminByEmail(email);
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('INITIAL_ADMIN_EMAIL belongs to a user account. Choose another admin email.');
    }
    return { admin: publicAdmin(existing), created: false };
  }

  const admin = await createAdmin({ email, password, role: 'admin', approvalStatus: 'approved' });
  return { admin: publicAdmin(admin), created: true };
}

export async function verifyAdminCredentials(email, password) {
  const admin = await findAdminByEmail(email);
  if (!admin) return null;

  const ok = await bcrypt.compare(String(password || ''), admin.password_hash);
  if (!ok) return null;

  return admin;
}
