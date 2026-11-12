/**
 * Quote version service.
 * Locks a draft into an immutable snapshot, issues signed share tokens,
 * and tracks customer acceptance.
 */

import crypto from 'crypto';
import { query } from '../config/database.js';
import { getDraftForLead, hasDraftIssues, upsertDraft } from './quoteDrafts.js';
import { getLeadById, tryAutoTransitionLifecycle } from './leads.js';
import { publicQuoteSnapshot } from './publicQuote.js';
import { notifyQuoteAccepted, safeNotify } from './notifications.js';
import { logAuditEvent } from './audit.js';
import { notify } from './notifications.js';
import { getAgencySettings, quoteNeedsApproval } from './agencySettings.js';

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
export async function lockQuoteVersion(leadId, { actorId, actorRole, notes } = {}) {
  const [draft, lead] = await Promise.all([getDraftForLead(leadId), getLeadById(leadId)]);
  if (!draft) throw httpErr(404, 'No quote draft found for this lead');
  if (!lead) throw httpErr(404, 'Lead not found');
  if (!draft.items || draft.items.length === 0) {
    throw httpErr(400, 'Cannot lock a version with no items');
  }
  if (hasDraftIssues(draft.issues)) {
    const err = httpErr(400, 'Some items have no price or are in another currency. Fix them before locking the quote.');
    err.code = 'quote_items_invalid';
    err.details = draft.issues;
    throw err;
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

  // Agents' quotes wait for a manager when the agency asks for it (Settings → Quotes).
  const needsApproval = quoteNeedsApproval(await getAgencySettings(), {
    role: actorRole,
    marginPct: draft.pricing?.gross_margin_pct,
    marginAmount: draft.pricing?.gross_margin,
  });

  const result = await query(
    `INSERT INTO quote_versions
       (quote_draft_id, lead_id, version_number, snapshot, selling_price, currency, status, notes, created_by, approval_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $8, $9)
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
      needsApproval ? 'pending' : 'not_required',
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

/** True once a newer version of the same quote exists: only the latest one can be sent or accepted. */
export async function isSuperseded(version) {
  const { rows } = await query(
    `SELECT 1 FROM quote_versions WHERE quote_draft_id = $1 AND version_number > $2 LIMIT 1`,
    [version.quote_draft_id, version.version_number],
  );
  return rows.length > 0;
}

/** The quote's own "valid until" date has passed (it is valid through that whole day). */
export function isPastValidity(snapshot, now = new Date()) {
  const raw = snapshot?.valid_until;
  if (!raw) return false;
  const day = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return now.toISOString().slice(0, 10) > day;
}

/** Why a version can no longer be sent or accepted, or null when it still can. */
export async function versionBlock(version) {
  const snapshot = typeof version.snapshot === 'string' ? JSON.parse(version.snapshot) : version.snapshot;
  if (version.status === 'accepted') return { status: 409, code: 'already_accepted', message: 'This quote has already been accepted' };
  if (version.approval_status === 'pending') return { status: 409, code: 'approval_pending', message: 'This quote is waiting for a manager to approve it' };
  if (version.approval_status === 'rejected') return { status: 409, code: 'approval_rejected', message: 'A manager asked for changes to this quote. Lock a new version.' };
  if (await isSuperseded(version)) return { status: 409, code: 'superseded', message: 'A newer version of this quote has replaced it' };
  if (isPastValidity(snapshot)) return { status: 410, code: 'expired', message: 'This quote is past its valid-until date' };
  return null;
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
    `SELECT st.*, qv.snapshot, qv.status AS version_status, qv.selling_price, qv.currency, qv.accepted_at,
            qv.quote_draft_id, qv.version_number, qv.approval_status,
            EXISTS (SELECT 1 FROM quote_versions newer
                    WHERE newer.quote_draft_id = qv.quote_draft_id AND newer.version_number > qv.version_number) AS superseded
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
  if (row.views === 0) {
    const snap = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
    void import('./automations.js')
      .then(({ notifyQuoteViewed }) => notifyQuoteViewed({
        leadId: snap?.lead?.id,
        versionNumber: row.version_number,
        customer: snap?.lead?.customer_name || snap?.lead?.contact_name,
      }))
      .catch(() => {});
  }

  return {
    token: row.token,
    expires_at: row.expires_at,
    views: row.views + 1,
    version_status: row.version_status,
    selling_price: row.selling_price,
    currency: row.currency,
    accepted_at: row.accepted_at,
    superseded: Boolean(row.superseded),
    expired: isPastValidity(typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot),
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
  if (row.version_status === 'accepted') throw httpErr(409, 'This quote has already been accepted');
  if (row.superseded) throw httpErr(409, 'A newer version of this quote has replaced it. Please use the latest link.');
  if (row.expired) throw httpErr(410, 'This quote is past its valid-until date. Please contact us for an updated price.');
  if (row.approval_status === 'pending' || row.approval_status === 'rejected') throw httpErr(409, 'This quote is not ready yet. Please contact us.');

  const tokenRow = await query(`SELECT quote_version_id FROM share_tokens WHERE token = $1`, [token]);
  const versionId = tokenRow.rows[0]?.quote_version_id;
  if (!versionId) throw httpErr(404, 'Token not found');

  const accepted_by = [customerName, customerEmail].filter(Boolean).join(' / ') || null;

  // One statement decides the race: a double click or two tabs accept only once.
  const updated = await query(
    `UPDATE quote_versions
     SET status = 'accepted', accepted_at = NOW(), accepted_by = $2
     WHERE id = $1 AND status <> 'accepted' AND approval_status IN ('not_required', 'approved')
       AND NOT EXISTS (SELECT 1 FROM quote_versions newer
                       WHERE newer.quote_draft_id = quote_versions.quote_draft_id
                         AND newer.version_number > quote_versions.version_number)
     RETURNING id, lead_id, version_number`,
    [versionId, accepted_by],
  );
  const versionRow = updated.rows[0];
  if (!versionRow) throw httpErr(409, 'This quote has already been accepted');

  if (versionRow.lead_id) {
    // Through the normal stage rules (sent → accepted). Staff move it to booked, which
    // also creates the customer's portal account.
    await tryAutoTransitionLifecycle(versionRow.lead_id, 'quote_accepted');
    void logAuditEvent({
      entityType: 'quote_version',
      entityId: versionRow.id,
      action: 'quote_accepted',
      actorRole: 'customer',
      after: { version_number: versionRow.version_number, accepted_by },
    });
    void safeNotify(() => notifyQuoteAccepted(versionRow.lead_id, { acceptedBy: customerName }));
    // Hotel terms like "Cancel from 2026-12-05" become a deadline the team is warned about.
    void import('./deadlines.js')
      .then(async ({ deadlinesFromSnapshot }) => {
        const full = await getVersionById(versionId);
        const snap = typeof full?.snapshot === 'string' ? JSON.parse(full.snapshot) : full?.snapshot;
        return deadlinesFromSnapshot(versionRow.lead_id, snap);
      })
      .catch((error) => console.error('[deadlines] from quote failed:', error.message));
  }
  return { accepted: true, version_id: versionId };
}

// ── manager approval ──────────────────────────────────────────────────────────

async function approvers() {
  const { rows } = await query(
    `SELECT id FROM admins WHERE role = 'admin' AND COALESCE(approval_status, 'approved') = 'approved'`,
  );
  return rows.map((r) => r.id);
}

/** Tell the managers a quote is waiting. Called after a version is locked as pending. */
export async function requestQuoteApproval(version, { requestedByEmail } = {}) {
  if (version?.approval_status !== 'pending') return;
  const snapshot = typeof version.snapshot === 'string' ? JSON.parse(version.snapshot) : version.snapshot;
  await notify({
    adminIds: await approvers(),
    kind: 'quote_approval_needed',
    leadId: version.lead_id,
    collapse: false,
    data: {
      version_id: version.id,
      version_number: version.version_number,
      customer: snapshot?.lead?.customer_name || snapshot?.lead?.contact_name || null,
      by: requestedByEmail || null,
      price: version.selling_price,
      currency: version.currency,
      margin_pct: snapshot?.pricing?.gross_margin_pct ?? null,
    },
  });
}

/** Approve, or send back with a note. Only a pending version can be reviewed. */
export async function reviewQuoteVersion(versionId, { decision, note, reviewer }) {
  if (!['approved', 'rejected'].includes(decision)) throw httpErr(400, 'decision must be approved or rejected');
  const cleanNote = String(note ?? '').trim().slice(0, 1000) || null;
  if (decision === 'rejected' && !cleanNote) throw httpErr(400, 'Say what needs changing');
  const { rows } = await query(
    `UPDATE quote_versions
     SET approval_status = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4
     WHERE id = $1 AND approval_status = 'pending'
     RETURNING *`,
    [versionId, decision, reviewer.id, cleanNote],
  );
  const version = rows[0];
  if (!version) {
    const existing = await getVersionById(versionId);
    if (!existing) throw httpErr(404, 'Quote version not found');
    throw httpErr(409, 'This quote is not waiting for approval');
  }
  void logAuditEvent({
    entityType: 'quote_version',
    entityId: version.id,
    action: decision === 'approved' ? 'quote_approved' : 'quote_changes_requested',
    actorId: reviewer.id,
    actorRole: reviewer.role,
    after: { version_number: version.version_number, note: cleanNote },
  });
  if (version.created_by && version.created_by !== reviewer.id) {
    await safeNotify(() => notify({
      adminIds: [version.created_by],
      kind: 'quote_reviewed',
      leadId: version.lead_id,
      collapse: false,
      data: {
        version_id: version.id,
        version_number: version.version_number,
        decision,
        note: cleanNote,
        by: reviewer.email || null,
      },
    }));
  }
  return version;
}

/** Quotes waiting for a manager, oldest first. */
export async function listPendingApprovals() {
  const { rows } = await query(
    `SELECT qv.id, qv.lead_id, qv.version_number, qv.selling_price, qv.currency, qv.created_at,
            qv.snapshot->'pricing'->>'gross_margin_pct' AS margin_pct,
            qv.snapshot->'lead'->>'customer_name' AS customer_name,
            qv.snapshot->'lead'->>'destination' AS destination,
            a.email AS created_by_email
     FROM quote_versions qv
     LEFT JOIN admins a ON a.id = qv.created_by
     WHERE qv.approval_status = 'pending'
     ORDER BY qv.created_at ASC
     LIMIT 200`,
  );
  return rows;
}

// ── new price after the customer negotiates ──────────────────────────────────

/**
 * Locks a new version at the price agreed with the customer. The draft's markup becomes the
 * fixed amount that gives exactly that price (rounding off), so the items stay the same and
 * only the profit changes. The older version is replaced, and the approval rules apply as
 * for any locked quote.
 */
export async function reviseQuotePrice(leadId, { sellingPrice, notes, actorId, actorRole } = {}) {
  const target = Number(sellingPrice);
  if (!Number.isFinite(target) || target <= 0) throw httpErr(400, 'Enter the new total price');
  const draft = await getDraftForLead(leadId);
  if (!draft) throw httpErr(404, 'No quote draft found for this lead');
  const cost = Number(draft.pricing?.net_total || 0) + Number(draft.extras_amount || 0);
  const markup = Math.round((target - cost) * 100) / 100;
  if (markup < 0) {
    const err = httpErr(400, 'That price is below cost');
    err.code = 'below_cost';
    throw err;
  }
  await upsertDraft(leadId, {
    currency: draft.currency,
    markup_type: 'fixed',
    markup_value: markup,
    extras_amount: draft.extras_amount,
    extras_label: draft.extras_label,
    rounding_mode: 'none',
    notes: draft.notes,
    valid_until: draft.valid_until,
  });
  return lockQuoteVersion(leadId, { actorId, actorRole, notes });
}
