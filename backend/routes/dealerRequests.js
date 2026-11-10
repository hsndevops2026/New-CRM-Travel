import { Router } from 'express';
import {
  dispatchDealerRfq,
  listDealerRequests,
  listDealerResponses,
  reviewDealerResponse,
  confirmBestDealerResponse,
  listUnmatchedMessages,
  resolveUnmatchedMessage,
} from '../services/dealerRequests.js';
import { listKnownWhatsAppGroups } from '../services/whatsappGroups.js';
import { logAuditEvent } from '../services/audit.js';

const router = Router();

// ── RFQ dispatch ─────────────────────────────────────────────────────────────

router.post('/dealer-requests', async (req, res) => {
  try {
    const { lead_id, dealer_id, group_jid, group_name, deadline_hours } = req.body || {};
    if (!lead_id || (!dealer_id && !group_jid)) {
      return res.status(400).json({ error: 'lead_id and a WhatsApp group or dealer are required' });
    }
    const result = await dispatchDealerRfq({
      leadId: lead_id,
      dealerId: dealer_id || null,
      groupJid: group_jid || null,
      groupName: group_name || null,
      deadlineHours: Number(deadline_hours) || 24,
      actorId: req.admin?.id,
    });
    void logAuditEvent({
      entityType: 'lead',
      entityId: lead_id,
      action: 'dealer_rfq_sent',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: {
        dealer_id: dealer_id || null,
        group_jid: group_jid || null,
        request_code: result.dealerRequest.request_code,
      },
    });
    res.status(201).json({ dealer_request: result.dealerRequest });
  } catch (error) {
    console.error('Dispatch RFQ failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to dispatch RFQ' });
  }
});

router.get('/dealer-requests', async (req, res) => {
  try {
    const requests = await listDealerRequests({
      leadId: req.query.lead_id,
      dealerId: req.query.dealer_id,
      status: req.query.status,
      limit: Number(req.query.limit) || 100,
      userId: req.admin.role === 'agent' ? req.admin.id : null,
    });
    res.json({ count: requests.length, dealer_requests: requests });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list dealer requests' });
  }
});

// ── Dealer responses ──────────────────────────────────────────────────────────

router.get('/dealer-responses', async (req, res) => {
  try {
    const responses = await listDealerResponses({
      dealerRequestId: req.query.dealer_request_id,
      leadId: req.query.lead_id,
      reviewStatus: req.query.review_status,
      limit: Number(req.query.limit) || 100,
      userId: req.admin.role === 'agent' ? req.admin.id : null,
    });
    res.json({ count: responses.length, dealer_responses: responses });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list dealer responses' });
  }
});

router.patch('/dealer-responses/:id/review', async (req, res) => {
  try {
    const { approved, corrected_data } = req.body || {};
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved (boolean) is required' });
    }
    const response = await reviewDealerResponse({
      responseId: req.params.id,
      approved,
      reviewerId: req.admin?.id,
      correctedData: corrected_data || null,
    });
    if (!response) return res.status(404).json({ error: 'Response not found' });
    void logAuditEvent({
      entityType: 'dealer_response',
      entityId: req.params.id,
      action: approved ? 'response_approved' : 'response_rejected',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { review_status: response.review_status },
    });
    res.json({ dealer_response: response });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to review response' });
  }
});

router.patch('/dealer-responses/:id/best', async (req, res) => {
  try {
    const response = await confirmBestDealerResponse({
      responseId: req.params.id,
      reviewerId: req.admin?.id,
    });
    if (!response) return res.status(404).json({ error: 'Response not found' });
    void logAuditEvent({
      entityType: 'dealer_response',
      entityId: req.params.id,
      action: 'best_offer_confirmed',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      after: { is_best: true },
    });
    res.json({ dealer_response: response });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to confirm best offer' });
  }
});

router.get('/whatsapp-groups', async (req, res) => {
  try {
    const result = await listKnownWhatsAppGroups({ force: req.query.force === 'true' });
    res.json({
      count: result.groups.length,
      session_count: result.session_count,
      session_status: result.session_status,
      session_name: result.session_name,
      groups: result.groups,
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to list WhatsApp groups' });
  }
});

// ── Exception inbox (unmatched group messages) ────────────────────────────────

router.get('/dealer-unmatched', async (req, res) => {
  try {
    const messages = await listUnmatchedMessages({
      limit: Number(req.query.limit) || 100,
      resolved: req.query.resolved === 'true',
    });
    res.json({ count: messages.length, messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list unmatched messages' });
  }
});

router.patch('/dealer-unmatched/:id/resolve', async (req, res) => {
  try {
    await resolveUnmatchedMessage(req.params.id);
    res.json({ resolved: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve message' });
  }
});

export default router;
