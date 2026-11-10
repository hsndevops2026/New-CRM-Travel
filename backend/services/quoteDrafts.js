import { query } from '../config/database.js';
import { calculatePricing, validateMarkupConfig } from './pricingEngine.js';
import { getComparisonItems } from './comparisonNormalizer.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validCurrency(c) {
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c);
}

// ── read ──────────────────────────────────────────────────────────────────────

export async function getDraftForLead(leadId) {
  const draftResult = await query(
    `SELECT * FROM quote_drafts WHERE lead_id = $1 LIMIT 1`,
    [leadId],
  );
  const draft = draftResult.rows[0] || null;
  if (!draft) return null;

  const itemsResult = await query(
    `SELECT * FROM quote_items WHERE quote_draft_id = $1 ORDER BY item_order ASC, created_at ASC`,
    [draft.id],
  );
  const items = itemsResult.rows;

  const pricing = calculatePricing({
    items,
    markup_type: draft.markup_type,
    markup_value: draft.markup_value,
    extras_amount: draft.extras_amount,
    rounding_mode: draft.rounding_mode,
  });

  return { ...draft, items, pricing };
}

// ── upsert draft (create or update config) ────────────────────────────────────

export async function upsertDraft(leadId, {
  currency,
  markup_type = 'percent',
  markup_value = 0,
  extras_amount = 0,
  extras_label,
  rounding_mode = 'none',
  notes,
  valid_until,
} = {}) {
  // Validate
  validateMarkupConfig({ markup_type, markup_value, extras_amount });
  if (currency && !validCurrency(currency)) throw httpErr(400, 'currency must be a 3-letter ISO code');

  const cur = currency || 'USD';
  const validUntil = valid_until || null;

  const result = await query(
    `INSERT INTO quote_drafts
       (lead_id, currency, markup_type, markup_value, extras_amount, extras_label,
        rounding_mode, notes, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (lead_id) DO UPDATE SET
       currency      = EXCLUDED.currency,
       markup_type   = EXCLUDED.markup_type,
       markup_value  = EXCLUDED.markup_value,
       extras_amount = EXCLUDED.extras_amount,
       extras_label  = EXCLUDED.extras_label,
       rounding_mode = EXCLUDED.rounding_mode,
       notes         = EXCLUDED.notes,
       valid_until   = EXCLUDED.valid_until,
       updated_at    = NOW()
     RETURNING *`,
    [leadId, cur, markup_type, markup_value, extras_amount, extras_label || null, rounding_mode, notes || null, validUntil],
  );
  return getDraftForLead(leadId);
}

// ── replace selected items ────────────────────────────────────────────────────

/**
 * Replace all items on the draft with the given selection.
 * Each item must have: { source_type, source_id, label, net_cost, currency, quantity?, description?, meta? }
 * Items are sourced from the comparison normalizer by the caller or the route handler.
 */
export async function setDraftItems(leadId, items) {
  const draft = await getDraftForLead(leadId);
  if (!draft) throw httpErr(404, 'No quote draft found for this lead. Create one first.');

  // Validate items
  if (!Array.isArray(items)) throw httpErr(400, 'items must be an array');
  for (const item of items) {
    if (!item.source_type || !item.source_id) throw httpErr(400, 'Each item needs source_type and source_id');
    if (!item.label) throw httpErr(400, 'Each item needs a label');
  }

  // Delete old, insert new
  await query(`DELETE FROM quote_items WHERE quote_draft_id = $1`, [draft.id]);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await query(
      `INSERT INTO quote_items
         (quote_draft_id, source_type, source_id, label, description,
          net_cost, currency, quantity, item_order, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        draft.id,
        item.source_type,
        String(item.source_id),
        item.label,
        item.description || null,
        item.net_cost != null ? Number(item.net_cost) : null,
        item.currency || 'USD',
        Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        i,
        JSON.stringify(item.meta || {}),
      ],
    );
  }

  return getDraftForLead(leadId);
}

// ── select items from comparison by source IDs ────────────────────────────────

/**
 * Convenience: given a list of composite IDs like ["predefined:uuid", "flight_api:uuid"],
 * resolve them from the normalizer and set them as draft items.
 */
function normalizeComparisonId(value) {
  return String(value || '').trim().toLowerCase();
}

function comparisonItemKey(item) {
  return `${String(item.source_type || '').toLowerCase()}:${normalizeComparisonId(item.source_id)}`;
}

export async function selectComparisonItems(leadId, selectedIds) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return setDraftItems(leadId, []);
  }

  const { items: allItems } = await getComparisonItems(leadId);
  const byId = new Map(allItems.map((item) => [normalizeComparisonId(item.id), item]));
  const byKey = new Map(allItems.map((item) => [comparisonItemKey(item), item]));

  const chosen = [];
  const seen = new Set();

  for (const rawId of selectedIds) {
    const normalizedId = normalizeComparisonId(rawId);
    let item = byId.get(normalizedId);

    if (!item && normalizedId.includes(':')) {
      const [, ...rest] = normalizedId.split(':');
      const sourceId = rest.join(':');
      item =
        allItems.find((candidate) => normalizeComparisonId(candidate.source_id) === sourceId) ||
        byKey.get(normalizedId);
    }

    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      chosen.push(item);
    }
  }

  if (chosen.length === 0) {
    throw httpErr(400, 'None of the provided IDs matched available comparison items');
  }

  return setDraftItems(leadId, chosen);
}

// ── recalculate only (no DB write, returns pricing for current state) ─────────

export async function recalculateDraft(leadId) {
  return getDraftForLead(leadId);
}

// ── comparison items for lead (public helper) ─────────────────────────────────

export async function getLeadComparison(leadId) {
  return getComparisonItems(leadId);
}
