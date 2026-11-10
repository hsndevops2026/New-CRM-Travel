import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import { authConfig } from '../config/auth.js';
import { normalizeEmail, publicAdmin, validatePassword } from './admins.js';
import { getAgencySettings } from './agencySettings.js';
import { resolveFrontendBaseUrl } from './quoteDelivery.js';
import { sendMail } from './mail.js';

const BCRYPT_ROUNDS = 12;

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function requireCustomerEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@') || !normalized.includes('.')) {
    throw httpErr(400, 'A valid customer email is required when booking');
  }
  return normalized;
}

export function generateCustomerPassword() {
  // ~16 url-safe chars; always meets passwordMinLength
  const raw = randomBytes(12).toString('base64url');
  const min = authConfig.passwordMinLength || 8;
  return raw.length >= min ? raw : `${raw}${randomBytes(4).toString('base64url')}`;
}

export async function findCustomerByContactId(contactId) {
  if (!contactId) return null;
  const result = await query(
    `SELECT * FROM admins WHERE contact_id = $1 AND role = 'customer' LIMIT 1`,
    [contactId],
  );
  return result.rows[0] || null;
}

export async function findCustomerByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await query(
    `SELECT * FROM admins WHERE email = $1 AND role = 'customer' LIMIT 1`,
    [normalized],
  );
  return result.rows[0] || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendCustomerWelcomeEmail({
  email,
  password,
  contactName,
  agency,
  loginUrl,
  sendMailFn = sendMail,
} = {}) {
  const brand = agency || (await getAgencySettings());
  const link = loginUrl || `${resolveFrontendBaseUrl()}/login`;
  const name = String(contactName || '').trim() || 'there';
  const agencyName = brand.agency_name || 'your travel agency';

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#303030">
      <div style="background:${escapeHtml(brand.primary_color || '#0f766e')};padding:20px 28px;border-radius:8px 8px 0 0">
        <span style="color:#fff;font-size:20px;font-weight:700">${escapeHtml(agencyName)}</span>
      </div>
      <div style="border:1px solid #e8e8e8;border-top:none;padding:28px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 12px;font-size:18px">Your customer portal is ready</h2>
        <p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 16px">
          Your booking is confirmed. Use the login below to view your bookings, documents, and chat history.
        </p>
        <p style="margin:0 0 6px"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0 0 20px"><strong>Temporary password:</strong> ${escapeHtml(password)}</p>
        <a href="${escapeHtml(link)}"
           style="display:inline-block;background:${escapeHtml(brand.primary_color || '#0f766e')};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
          Sign in to your portal
        </a>
        <p style="color:#9a9a9a;font-size:12px;margin-top:24px">
          Keep this password private. You can sign in any time at ${escapeHtml(link)}.
        </p>
      </div>
    </div>
  `.trim();

  await sendMailFn({
    to: email,
    subject: `${agencyName} — your customer portal login`,
    html,
    text: `Hi ${name},\n\nYour booking is confirmed.\nLogin: ${link}\nEmail: ${email}\nTemporary password: ${password}\n`,
  });
}

/**
 * Create (or reuse) a customer login for a contact. Sends the auto-generated
 * password by email only when a new account is created.
 *
 * @returns {{ customer: object, created: boolean, password: string|null, emailSent: boolean, emailError: string|null }}
 */
export async function ensureCustomerAccount(
  { contactId, email, contactName, sendMailFn = sendCustomerWelcomeEmail } = {},
  { forceResend = false } = {},
) {
  const normalizedEmail = requireCustomerEmail(email);
  if (!contactId) throw httpErr(400, 'contactId is required');

  const existing = await findCustomerByContactId(contactId);
  if (existing) {
    if (existing.email !== normalizedEmail) {
      // Keep login email in sync with the contact when staff updates it on book.
      const clash = await query(
        `SELECT id, role FROM admins WHERE email = $1 AND id <> $2 LIMIT 1`,
        [normalizedEmail, existing.id],
      );
      if (clash.rows[0]) {
        throw httpErr(409, 'That email already belongs to another account');
      }
      await query(`UPDATE admins SET email = $2 WHERE id = $1`, [existing.id, normalizedEmail]);
      existing.email = normalizedEmail;
    }
    if (forceResend) {
      const password = generateCustomerPassword();
      validatePassword(password);
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await query(`UPDATE admins SET password_hash = $2 WHERE id = $1`, [existing.id, passwordHash]);
      let emailError = null;
      try {
        await sendMailFn({
          email: normalizedEmail,
          password,
          contactName,
        });
      } catch (err) {
        emailError = err.message || 'Failed to send welcome email';
        console.error('[customers] welcome email failed:', emailError);
      }
      return {
        customer: publicAdmin(existing),
        created: false,
        password,
        emailSent: !emailError,
        emailError,
      };
    }
    return {
      customer: publicAdmin(existing),
      created: false,
      password: null,
      emailSent: false,
      emailError: null,
    };
  }

  const emailTaken = await query(`SELECT id, role FROM admins WHERE email = $1 LIMIT 1`, [
    normalizedEmail,
  ]);
  if (emailTaken.rows[0]) {
    throw httpErr(
      409,
      emailTaken.rows[0].role === 'customer'
        ? 'A customer account with this email already exists for another contact'
        : 'That email already belongs to a staff account',
    );
  }

  const password = generateCustomerPassword();
  validatePassword(password);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await query(
    `INSERT INTO admins (email, password_hash, role, approval_status, lead_credits, contact_id)
     VALUES ($1, $2, 'customer', 'approved', 0, $3)
     RETURNING id, email, role, approval_status, lead_credits, leads_used, created_at, contact_id`,
    [normalizedEmail, passwordHash, contactId],
  );
  const customer = result.rows[0];

  let emailError = null;
  try {
    await sendMailFn({
      email: normalizedEmail,
      password,
      contactName,
    });
  } catch (err) {
    emailError = err.message || 'Failed to send welcome email';
    console.error('[customers] welcome email failed:', emailError);
  }

  return {
    customer: publicAdmin(customer),
    created: true,
    password,
    emailSent: !emailError,
    emailError,
  };
}
