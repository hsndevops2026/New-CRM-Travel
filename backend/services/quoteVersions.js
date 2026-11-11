import { notifyQuoteAccepted, safeNotify } from './notifications.js';
/**
 * Quote version service.
 * Locks a draft into an immutable snapshot, issues signed share tokens,
 * and tracks customer acceptance.
 */

import crypto from 'crypto';
import { query } from '../config/database.js';
import { getDraftForLead } from './quoteDrafts.js';
import { getLeadById } from './leads.js';
import { publicQuoteSnapshot } from './publicQuote.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// ── lock a version ────────────────────────────────────────────────────────────

/**
 * Creates an immutable quote_versions row from the current draft state.
 * Each call increments the version_number for that draft.
 */
export async function lockQuoteVersion(leadId, { actorId, notes } = {}) {
  const [draft, lead] = await Promise.all([getDraftForLead(leadId), getLeadById(leadId)]);
  if (!draft) throw httpErr(404, 'No quote draft found for this lead');
  if (!lead) throw httpErr(404, 'Lead not found');
  if (!draft.items || draft.items.length === 0) {
    throw httpErr(400, 'Cannot lock a version with no items');
  }

  // Determine next version number
  const maxResult = await query(
    `SELECT COALESCE(MAX(version_number), 0) AS max FROM quote_versions WHERE quote_draft_id = $1`,
    [draft.id],
  );
  const nextVersion = Number(maxResult.rows[0].max) + 1;

  // Build the immutable snapshot
  const snapshot = {
    title: [lead.destination, lead.booking_type].filter(Boolean).join(' — ') || 'Travel Quote',
    version_number: nextVersion,
    currency: draft.currency,
    notes: notes || draft.notes,
    valid_until: draft.valid_until,
    lead: {
      id: lead.id,
      destination: lead.destination,
      origin: lead.origin,
      travel_date: lead.travel_date,
      return_date: lead.return_date,
      nights: lead.nights,
      adults_count: lead.adults_count,
      children_count: lead.children_count,
      customer_name: lead.contact_name || null,
      booking_type: lead.booking_type,
    },
    items: draft.items.map((item) => ({
      source_type: item.source_type,
      source_id: item.source_id,
      label: item.label,
      description: item.description,
      net_cost: item.net_cost != null ? Number(item.net_cost) : null,
      currency: item.currency,
      quantity: item.quantity,
      meta: item.meta || {},
    })),
    pricing: draft.pricing,
    markup_type: draft.markup_type,
    markup_value: Number(draft.markup_value),
  };

  const result = await query(
    `INSERT INTO quote_versions
       (quote_draft_id, lead_id, version_number, snapshot, selling_price, currency, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $8)
     RETURNING *`,
    [
      draft.id,
      leadId,
      nextVersion,
      JSON.stringify(snapshot),
      draft.pricing?.selling_price ?? null,
      draft.currency,
      notes || draft.notes || null,
      actorId || null,
    ],
  );

  return { version: result.rows[0], snapshot };
}

// ── list versions ─────────────────────────────────────────────────────────────

export async function listVersionsForLead(leadId) {
  const result = await query(
    `SELECT qv.*, qd.currency AS draft_currency
     FROM quote_versions qv
     JOIN quote_drafts qd ON qd.id = qv.quote_draft_id
     WHERE qv.lead_id = $1
     ORDER BY qv.version_number DESC`,
    [leadId],
  );
  return result.rows;
}

export async function getVersionById(versionId) {
  const result = await query(
    `SELECT * FROM quote_versions WHERE id = $1 LIMIT 1`,
    [versionId],
  );
  return result.rows[0] || null;
}

// ── share tokens ──────────────────────────────────────────────────────────────

/**
 * Creates a signed share token for a version (expiry in hours, default 72h).
 */
export async function createShareToken(versionId, { expiryHours = 72 } = {}) {
  const version = await getVersionById(versionId);
  if (!version) throw httpErr(404, 'Quote version not found');

  const token = generateToken();
  const expiresAt = new Date(Date.now() + expiryHours * 3600_000);

  const result = await query(
    `INSERT INTO share_tokens (quote_version_id, token, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [versionId, token, expiresAt.toISOString()],
  );

  return result.rows[0];
}

/**
 * Resolve a public token → version + snapshot (increments view count).
 * Returns null if token is expired, revoked, or not found.
 */
export async function resolveShareToken(token) {
  const result = await query(
    `SELECT st.*, qv.snapshot, qv.status AS version_status, qv.selling_price, qv.currency, qv.accepted_at
     FROM share_tokens st
     JOIN quote_versions qv ON qv.id = st.quote_version_id
     WHERE st.token = $1 LIMIT 1`,
    [token],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.revoked) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Increment view count
  await query(`UPDATE share_tokens SET views = views + 1 WHERE id = $1`, [row.id]);

  return {
    token: row.token,
    expires_at: row.expires_at,
    views: row.views + 1,
    version_status: row.version_status,
    selling_price: row.selling_price,
    currency: row.currency,
    accepted_at: row.accepted_at,
    snapshot: publicQuoteSnapshot(row.snapshot),
  };
}

/**
 * Revoke all tokens for a version.
 */
export async function revokeTokensForVersion(versionId) {
  await query(
    `UPDATE share_tokens SET revoked = TRUE WHERE quote_version_id = $1`,
    [versionId],
  );
}

// ── acceptance ────────────────────────────────────────────────────────────────

/**
 * Customer accepts a quote via their share token.
 * Marks the version as accepted and advances the lead lifecycle to 'booked'.
 */
export async function acceptQuoteVersion(token, { customerName, customerEmail } = {}) {
  const row = await resolveShareToken(token);
  if (!row) throw httpErr(404, 'Quote link is invalid, expired, or has been revoked');
  if (row.version_status === 'accepted') {
    throw httpErr(409, 'This quote has already been accepted');
  }

  // Resolve the version ID
  const tokenRow = await query(`SELECT quote_version_id FROM share_tokens WHERE token = $1`, [token]);
  const versionId = tokenRow.rows[0]?.quote_version_id;
  if (!versionId) throw httpErr(404, 'Token not found');

  const accepted_by = [customerName, customerEmail].filter(Boolean).join(' / ') || null;

  await query(
    `UPDATE quote_versions
     SET status = 'accepted', accepted_at = NOW(), accepted_by = $2
     WHERE id = $1`,
    [versionId, accepted_by],
  );

  // Move lead lifecycle to booked
  const versionRow = await getVersionById(versionId);
  if (versionRow?.lead_id) {
    await query(
      `UPDATE leads SET lifecycle_status = 'booked' WHERE id = $1`,
      [versionRow.lead_id],
    );
  }

  if (versionRow?.lead_id) {
    void safeNotify(() => notifyQuoteAccepted(versionRow.lead_id, { acceptedBy: customerName }));
  }
  return { accepted: true, version_id: versionId };
}
