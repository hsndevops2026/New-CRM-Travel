import express, { Router } from 'express';
import {
  listLeads,
  listUserLeads,
  getLeadById,
  createLeadFromInput,
  createLeadsBulk,
  updateLeadStatus,
  deleteLead,
  deleteLeads,
  acceptPackageOffer,
  declinePackageOffer,
  retryPackageQuotes,
} from '../services/leads.js';
import { getPredefinedQuote } from '../services/predefinedQuotes.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';
import { allocateLeads, createCreditedLead } from '../services/permissions.js';
import { isTranscriptionConfigured } from '../services/transcription.js';
import {
  MAX_TEST_AUDIO_BYTES,
  describeSimulatedJob,
  enqueueSimulatedVoice,
} from '../services/voiceSimulation.js';

const router = Router();

router.get('/leads', async (req, res) => {
  try {
    if (req.admin.role === 'agent') await allocateLeads(req.admin.id);
    const leads = req.admin.role === 'agent'
      ? await listUserLeads(req.admin.id, 200)
      : await listLeads(200);
    res.json({
      count: leads.length,
      leads,
    });
  } catch (error) {
    console.error('List leads failed:', error);
    res.status(500).json({ error: 'Failed to list leads' });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (error) {
    console.error('Get lead failed:', error);
    res.status(500).json({ error: 'Failed to load lead' });
  }
});

router.post('/leads', async (req, res) => {
  try {
    const input = {
      ...req.body,
      source: req.body?.source || 'crm',
    };
    const result = req.admin.role === 'agent'
      ? await createCreditedLead(req.admin.id, () => createLeadFromInput(input))
      : await createLeadFromInput(input);
    res.status(201).json(result);
  } catch (error) {
    console.error('Create lead failed:', error.message);
    res.status(error.status || 500).json({
      error: error.message || 'Failed to create lead',
      details: error.details || null,
    });
  }
});

/**
 * CRM test harness: same intake as WhatsApp, without sending Wasender replies.
 * Reuse the same phone across turns to continue a conversation.
 */
router.post('/leads/simulate-whatsapp', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const phone = String(req.body?.phone || '9990001111').trim();
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await handleIncomingLeadMessage({
      from: phone,
      text: message,
      skipWhatsApp: true,
      source: 'whatsapp',
    });

    if (!result) {
      return res.status(400).json({ error: 'Empty phone or message' });
    }

    res.json(result);
  } catch (error) {
    console.error('Simulate WhatsApp failed:', error);
    res.status(500).json({
      error: error.message || 'Failed to simulate WhatsApp message',
    });
  }
});

// Audio arrives as the raw request body (like the brochure upload), not JSON.
const simulatedVoiceUpload = express.raw({ type: () => true, limit: MAX_TEST_AUDIO_BYTES });

/**
 * CRM test for WhatsApp voice notes. The audio goes through the real `voice-messages`
 * queue and worker (transcribe → LLM → lead), but nothing is sent to WhatsApp.
 * Responds 202 with a job id; poll GET /leads/simulate-voice/:jobId for the outcome.
 * Headers: Content-Type = the audio mimetype, X-Phone = test phone, X-Audio-Seconds.
 */
router.post('/leads/simulate-voice', simulatedVoiceUpload, async (req, res) => {
  try {
    if (!isTranscriptionConfigured()) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not configured — cannot transcribe audio' });
    }
    const { jobId } = await enqueueSimulatedVoice({
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      contentType: req.headers['content-type'],
      phone: req.headers['x-phone'],
      seconds: req.headers['x-audio-seconds'],
    });
    res.status(202).json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Simulate voice failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to queue voice test' });
  }
});

router.get('/leads/simulate-voice/:jobId', async (req, res) => {
  try {
    const state = await describeSimulatedJob(req.params.jobId);
    if (!state) return res.status(404).json({ error: 'Voice test not found (it may have expired)' });
    res.json(state);
  } catch (error) {
    console.error('Simulate voice status failed:', error.message);
    res.status(500).json({ error: error.message || 'Failed to read voice test' });
  }
});

router.post('/leads/bulk', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.leads) ? req.body.leads : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'leads array is required' });
    }

    const source = req.body?.source || 'csv';
    const prepared = rows.map((row) => ({ ...row, source: row.source || source }));
    const result = req.admin.role === 'agent'
      ? { created: [], failed: [] }
      : await createLeadsBulk(prepared);
    if (req.admin.role === 'agent') {
      for (let i = 0; i < prepared.length; i += 1) {
        try {
          const created = await createCreditedLead(req.admin.id, () => createLeadFromInput(prepared[i]));
          result.created.push(created.lead);
        } catch (error) {
          result.failed.push({ row: i + 1, error: error.message, data: prepared[i] });
        }
      }
    }

    res.status(201).json({
      created_count: result.created.length,
      failed_count: result.failed.length,
      created: result.created,
      failed: result.failed,
    });
  } catch (error) {
    console.error('Bulk create failed:', error);
    res.status(500).json({ error: 'Failed to import leads' });
  }
});

router.patch('/leads/:id/status', async (req, res) => {
  try {
    const lead = await updateLeadStatus(req.params.id, req.body?.status, {
      contact_name: req.body?.contact_name,
      contact_email: req.body?.contact_email,
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update status' });
  }
});

router.delete('/leads/:id', async (req, res) => {
  try {
    const lead = await deleteLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ deleted: true, lead });
  } catch (error) {
    console.error('Delete lead failed:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

router.post('/leads/delete-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const deleted = await deleteLeads(ids);
    res.json({ deleted_count: deleted.length, deleted });
  } catch (error) {
    console.error('Bulk delete failed:', error);
    res.status(500).json({ error: 'Failed to delete leads' });
  }
});

router.post('/leads/:id/package-offer/accept', async (req, res) => {
  try {
    const lead = await acceptPackageOffer(req.params.id);
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to accept package offer' });
  }
});

router.post('/leads/:id/package-offer/decline', async (req, res) => {
  try {
    const lead = await declinePackageOffer(req.params.id);
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to decline package offer' });
  }
});

router.get('/leads/:id/package-offer', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const quote = lead.pending_package_offer_id
      ? await getPredefinedQuote(lead.pending_package_offer_id)
      : null;
    res.json({
      pending: Boolean(lead.pending_package_offer_id),
      package: quote
        ? { id: quote.id, title: quote.title, destination: quote.destination, nights: quote.nights }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load package offer' });
  }
});

router.post('/leads/:id/package-quotes/retry', async (req, res) => {
  try {
    const lead = await retryPackageQuotes(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to retry package quotes' });
  }
});

export default router;
