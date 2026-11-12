import { Router } from 'express';
import {
  lockQuoteVersion,
  listVersionsForLead,
  getVersionById,
  revokeTokensForVersion,
  resolveShareToken,
  acceptQuoteVersion,
  listPendingApprovals,
  requestQuoteApproval,
  reviewQuoteVersion,
} from '../services/quoteVersions.js';
import { requireRole } from '../middleware/requireRole.js';
import { safeNotify } from '../services/notifications.js';
import {
  sendQuoteVersion,
  retryDelivery,
  listDeliveries,
} from '../services/quoteDelivery.js';
import { pipeVersionPdf, quotePdfLanguage } from '../services/quotationPdf.js';
import { logAuditEvent } from '../services/audit.js';
import { getAgencySettings, publicAgencySettings } from '../services/agencySettings.js';

const router = Router();
const publicRouter = Router();

// ── Manager approval ─────────────────────────────────────────────────────────

router.get('/quote-approvals', requireRole('admin'), async (_req, res) => {
  try {
    res.json({ approvals: await listPendingApprovals() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load approvals' });
  }
});

router.post('/quote-versions/:id/review', requireRole('admin'), async (req, res) => {
  try {
    const version = await reviewQuoteVersion(req.params.id, {
      decision: req.body?.decision,
      note: req.body?.note,
      reviewer: { id: req.admin.id, role: req.admin.role, email: req.admin.email },
    });
    res.json({ version });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Review failed' });
  }
});

// ── Lock a version (requires auth) ───────────────────────────────────────────

router.post('/leads/:leadId/quote-versions', async (req, res) => {
  try {
    const { notes } = req.body || {};
    const { version, snapshot } = await lockQuoteVersion(req.params.leadId, {
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      notes,
    });
    void safeNotify(() => requestQuoteApproval(version, { requestedByEmail: req.admin?.email }));
    void logAuditEvent({
      entityType: 'quote_version',
      entityId: version.id,
      action: 'version_locked',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { version_number: version.version_number, selling_price: version.selling_price },
    });
    res.status(201).json({ version, snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code, details: error.details });
  }
});

router.get('/leads/:leadId/quote-versions', async (req, res) => {
  try {
    const versions = await listVersionsForLead(req.params.leadId);
    res.json({ count: versions.length, versions });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/quote-versions/:id', async (req, res) => {
  try {
    const version = await getVersionById(req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    res.json({ version });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ── PDF download (auth protected) ─────────────────────────────────────────────

router.get('/quote-versions/:id/pdf', async (req, res) => {
  try {
    const version = await getVersionById(req.params.id);
    if (!version) return res.status(404).json({ error: 'Version not found' });
    const snapshot = typeof version.snapshot === 'string'
      ? JSON.parse(version.snapshot)
      : version.snapshot;
    await pipeVersionPdf(snapshot, res, await getAgencySettings(), await quotePdfLanguage(snapshot, req.query.lang));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ── Revoke tokens ─────────────────────────────────────────────────────────────

router.post('/quote-versions/:id/revoke', async (req, res) => {
  try {
    await revokeTokensForVersion(req.params.id);
    void logAuditEvent({
      entityType: 'quote_version',
      entityId: req.params.id,
      action: 'tokens_revoked',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
    });
    res.json({ revoked: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ── Send (WhatsApp / email) ───────────────────────────────────────────────────

router.post('/quote-versions/:id/send', async (req, res) => {
  try {
    const { channel, recipient, expiry_hours } = req.body || {};
    if (!channel || !recipient) {
      return res.status(400).json({ error: 'channel and recipient are required' });
    }
    const result = await sendQuoteVersion({
      versionId: req.params.id,
      channel,
      recipient,
      expiryHours: Number(expiry_hours) || 72,
    });
    void logAuditEvent({
      entityType: 'quote_version',
      entityId: req.params.id,
      action: 'quote_sent',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { channel, recipient, status: result.status },
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

router.get('/quote-versions/:id/deliveries', async (req, res) => {
  try {
    const deliveries = await listDeliveries(req.params.id);
    res.json({ count: deliveries.length, deliveries });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/quote-deliveries/:id/retry', async (req, res) => {
  try {
    const result = await retryDelivery(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ── Public routes (no auth — token is the credential) ────────────────────────

publicRouter.get('/q/:token', async (req, res) => {
  try {
    const data = await resolveShareToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Quote link is invalid, expired, or revoked' });
    const agency = publicAgencySettings(await getAgencySettings());
    res.json({ ...data, agency });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

publicRouter.get('/q/:token/pdf', async (req, res) => {
  try {
    const data = await resolveShareToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Quote link is invalid, expired, or revoked' });
    const snapshot = typeof data.snapshot === 'string' ? JSON.parse(data.snapshot) : data.snapshot;
    await pipeVersionPdf(snapshot, res, await getAgencySettings(), await quotePdfLanguage(snapshot, req.query.lang));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

publicRouter.post('/q/:token/accept', async (req, res) => {
  try {
    const { customer_name, customer_email } = req.body || {};
    const result = await acceptQuoteVersion(req.params.token, {
      customerName: customer_name,
      customerEmail: customer_email,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export const quoteVersionsAuthRoutes = router;
export const quoteVersionsPublicRoutes = publicRouter;
