/**
 * Foundation routes: lead assignment, lifecycle transitions, message history, audit log.
 * All protected by requireAuth (mounted under /api in createApp.js).
 */
import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { assignLead, transitionLifecycle, getLeadById } from '../services/leads.js';
import { listMessagesForLead, saveMessage } from '../services/messages.js';
import { listAuditEvents, logAuditEvent } from '../services/audit.js';

const router = Router();

// ── Lead assignment ──────────────────────────────────────────────────────────

router.patch('/leads/:id/assign', async (req, res) => {
  try {
    const lead = await assignLead(req.params.id, req.body?.assigned_to || null);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    void logAuditEvent({
      entityType: 'lead',
      entityId: req.params.id,
      action: 'assigned',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { assigned_to: req.body?.assigned_to || null },
    });
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to assign lead' });
  }
});

// ── Lifecycle transitions ────────────────────────────────────────────────────

router.patch('/leads/:id/lifecycle', async (req, res) => {
  try {
    const before = await getLeadById(req.params.id);
    const lead = await transitionLifecycle(req.params.id, req.body?.lifecycle_status, {
      contact_name: req.body?.contact_name,
      contact_email: req.body?.contact_email,
    });

    // A no-op transition changes nothing — don't write a phantom audit event.
    if (before?.lifecycle_status !== lead?.lifecycle_status) {
      void logAuditEvent({
        entityType: 'lead',
        entityId: req.params.id,
        action: 'lifecycle_changed',
        actorId: req.admin?.id,
        actorRole: req.admin?.role,
        before: { lifecycle_status: before?.lifecycle_status },
        after: { lifecycle_status: lead?.lifecycle_status },
      });
    }
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to change lifecycle' });
  }
});

// ── Message history ──────────────────────────────────────────────────────────

router.get('/leads/:id/messages', async (req, res) => {
  try {
    const messages = await listMessagesForLead(req.params.id);
    res.json({ count: messages.length, messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/leads/:id/messages', async (req, res) => {
  try {
    const message = await saveMessage({
      leadId: req.params.id,
      direction: req.body?.direction || 'outbound',
      channel: req.body?.channel || 'whatsapp',
      fromNumber: req.body?.from_number,
      toNumber: req.body?.to_number,
      body: req.body?.body,
      status: req.body?.status || 'sent',
      raw: req.body?.raw || {},
    });
    res.status(201).json({ message });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// ── Audit log ────────────────────────────────────────────────────────────────

router.get('/audit', requireRole('admin'), async (req, res) => {
  try {
    const events = await listAuditEvents({
      entityType: req.query.entity_type,
      entityId: req.query.entity_id,
      limit: Number(req.query.limit) || 100,
    });
    res.json({ count: events.length, events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load audit events' });
  }
});

router.get('/leads/:id/audit', async (req, res) => {
  try {
    const events = await listAuditEvents({
      entityType: 'lead',
      entityId: req.params.id,
      limit: 200,
    });
    res.json({ count: events.length, events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load audit events' });
  }
});

export default router;
