import { Router } from 'express';
import { getLeadById } from '../services/leads.js';
import {
  createBookingDocument,
  deleteBookingDocument,
  getBookingDocument,
  listDocumentsForLead,
} from '../services/bookingDocuments.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.get('/leads/:id/documents', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const documents = await listDocumentsForLead(req.params.id);
    res.json({ count: documents.length, documents });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

router.post('/leads/:id/documents', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const document = await createBookingDocument({
      leadId: req.params.id,
      title: req.body?.title,
      fileUrl: req.body?.file_url,
      fileName: req.body?.file_name,
      mimeType: req.body?.mime_type,
      uploadedBy: req.admin?.id,
    });
    res.status(201).json({ document });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to add document' });
  }
});

router.delete('/leads/:leadId/documents/:id', requireRole('admin', 'agent'), async (req, res) => {
  try {
    const existing = await getBookingDocument(req.params.id);
    if (!existing || existing.lead_id !== req.params.leadId) {
      return res.status(404).json({ error: 'Document not found' });
    }
    await deleteBookingDocument(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete document' });
  }
});

export default router;
