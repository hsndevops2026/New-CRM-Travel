import { Router } from 'express';
import { getLeadById } from '../services/leads.js';
import {
  createBookingDocument,
  deleteBookingDocument,
  getBookingDocument,
  listDocumentsForLead,
} from '../services/bookingDocuments.js';
import { requireRole } from '../middleware/requireRole.js';
import { buildDocumentTitle, classifyUploadedDocument } from '../services/documentClassifier.js';

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
    const body = req.body || {};
    let title = body.title;
    let fileName = body.file_name;
    let info = null;
    // classify: read the file and rename it after what it is (ticket, hotel, program…).
    if (body.classify) {
      info = await classifyUploadedDocument({
        fileUrl: body.file_url,
        mimeType: body.mime_type,
        fileName: body.file_name,
      });
      if (info) {
        title = buildDocumentTitle(info, title);
        const ext = String(body.file_name || '').match(/\.[A-Za-z0-9]{1,6}$/)?.[0] || '';
        fileName = `${title}${ext}`;
      }
    }
    const document = await createBookingDocument({
      leadId: req.params.id,
      title,
      fileUrl: body.file_url,
      fileName,
      mimeType: body.mime_type,
      uploadedBy: req.admin?.id,
      documentType: info?.document_type || null,
      extracted: info,
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
