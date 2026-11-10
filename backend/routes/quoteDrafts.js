import { Router } from 'express';
import {
  getDraftForLead,
  upsertDraft,
  setDraftItems,
  selectComparisonItems,
  getLeadComparison,
} from '../services/quoteDrafts.js';
import { logAuditEvent } from '../services/audit.js';

const router = Router();

// ── Comparison ────────────────────────────────────────────────────────────────

// GET /api/leads/:leadId/comparison
// Returns all normalized comparison items for the lead (all sources combined)
router.get('/leads/:leadId/comparison', async (req, res) => {
  try {
    const { items, errors } = await getLeadComparison(req.params.leadId);
    res.json({ count: items.length, items, source_errors: errors });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ── Draft CRUD ────────────────────────────────────────────────────────────────

// GET /api/leads/:leadId/quote-draft
router.get('/leads/:leadId/quote-draft', async (req, res) => {
  try {
    const draft = await getDraftForLead(req.params.leadId);
    if (!draft) return res.status(404).json({ error: 'No draft found for this lead' });
    res.json({ draft });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// PUT /api/leads/:leadId/quote-draft
// Create or update pricing config
router.put('/leads/:leadId/quote-draft', async (req, res) => {
  try {
    const draft = await upsertDraft(req.params.leadId, req.body || {});
    void logAuditEvent({
      entityType: 'quote_draft',
      entityId: draft.id,
      action: 'draft_upserted',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: {
        markup_type: draft.markup_type,
        markup_value: draft.markup_value,
        currency: draft.currency,
      },
    });
    res.json({ draft });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// PUT /api/leads/:leadId/quote-draft/items
// Replace all selected items (full list of {source_type, source_id, label, net_cost, …})
router.put('/leads/:leadId/quote-draft/items', async (req, res) => {
  try {
    const items = req.body?.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'body.items must be an array' });
    }
    const draft = await setDraftItems(req.params.leadId, items);
    res.json({ draft });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// POST /api/leads/:leadId/quote-draft/select
// Select items from comparison by composite IDs (e.g. ["predefined:uuid", "hotel_api:uuid"])
router.post('/leads/:leadId/quote-draft/select', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'body.ids must be an array of comparison item IDs' });
    }
    const draft = await selectComparisonItems(req.params.leadId, ids);
    void logAuditEvent({
      entityType: 'quote_draft',
      entityId: draft.id,
      action: 'items_selected',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { item_count: draft.items.length, ids },
    });
    res.json({ draft });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
