import express, { Router } from 'express';
import {
  createPredefinedQuote,
  deletePredefinedQuote,
  getPredefinedQuote,
  listPredefinedQuotes,
  updatePredefinedQuote,
} from '../services/predefinedQuotes.js';
import { pipeQuotePdf } from '../services/predefinedQuotePdf.js';
import {
  approvePredefinedQuoteImport,
  importPredefinedQuoteBrochure,
  listPredefinedQuoteImports,
  rejectPredefinedQuoteImport,
} from '../services/predefinedQuoteImports.js';
import { getAgencySettings } from '../services/agencySettings.js';
import { getAttachment, getMessage, getOwnedAccount } from '../services/gmail.js';
import { sendQuoteToCustomer } from '../services/quoteToCustomer.js';

const router = Router();

async function handleBrochureUpload(req, res, next) {
  try {
    let fileName = 'brochure';
    try {
      fileName = decodeURIComponent(String(req.headers['x-file-name'] || fileName));
    } catch {
      fileName = 'brochure';
    }
    const result = await importPredefinedQuoteBrochure({
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''),
      fileName,
      contentType: req.headers['content-type'],
      uploadedBy: req.admin?.id,
      targetQuoteId: req.query.target_quote_id || null,
      reextract: req.query.reextract === '1' || req.query.reextract === 'true',
    });
    res.status(result.duplicate ? 200 : 201).json({
      // `import` (the first package) is kept for older clients; new ones read `imports`.
      import: result.importRecord,
      imports: result.importRecords,
      duplicate: result.duplicate,
      replaced: result.replaced || 0,
    });
  } catch (error) {
    next(error);
  }
}

// Accept any content-type; magic-byte validation happens in the service.
const brochureUpload = express.raw({ type: () => true, limit: '50mb' });

router.get('/predefined-quotes/imports', async (req, res, next) => {
  try {
    const imports = await listPredefinedQuoteImports({
      status: req.query.status || undefined,
      limit: req.query.limit,
    });
    res.json({ count: imports.length, imports });
  } catch (error) {
    next(error);
  }
});

router.post('/predefined-quotes/imports/upload', brochureUpload, handleBrochureUpload);
// Backward-compatible alias
router.post('/predefined-quotes/imports/pdf', brochureUpload, handleBrochureUpload);

/** Plain text of an email body; HTML is reduced to its visible text (tables keep their cells). */
export function emailBodyText(body = {}) {
  if (body.text && String(body.text).trim()) return String(body.text);
  return String(body.html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Reads a supplier email from the employee's own Gmail: one attachment (a brochure, an
 * Excel sheet) or, without `attachment_id`, the email text itself.
 */
router.post('/predefined-quotes/imports/email', async (req, res, next) => {
  try {
    const { account_id: accountId, message_id: messageId, attachment_id: attachmentId } = req.body || {};
    if (!messageId) return res.status(400).json({ error: 'message_id is required' });
    const account = await getOwnedAccount(req.admin?.id, accountId);
    if (!account) return res.status(404).json({ error: 'Email account not found' });

    const message = await getMessage(account, String(messageId));
    let buffer;
    let fileName;
    let contentType = '';
    if (attachmentId) {
      const attachment = (message.attachments || []).find((item) => item.attachmentId === attachmentId);
      if (!attachment) return res.status(404).json({ error: 'Attachment not found in this email' });
      buffer = await getAttachment(account, String(messageId), String(attachmentId));
      fileName = attachment.filename || 'attachment';
      contentType = attachment.mimeType || '';
    } else {
      const text = emailBodyText(message.body);
      if (!text) return res.status(400).json({ error: 'This email has no text to read' });
      const header = [message.subject && `Subject: ${message.subject}`, message.from && `From: ${message.from}`, message.date && `Date: ${message.date}`]
        .filter(Boolean)
        .join('\n');
      buffer = Buffer.from(`${header}\n\n${text}`, 'utf8');
      fileName = `${String(message.subject || 'email').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'email'}.txt`;
      contentType = 'text/plain';
    }

    const result = await importPredefinedQuoteBrochure({
      buffer,
      fileName,
      contentType,
      uploadedBy: req.admin?.id,
      reextract: req.body?.reextract === true,
    });
    return res.status(result.duplicate ? 200 : 201).json({
      import: result.importRecord,
      imports: result.importRecords,
      duplicate: result.duplicate,
      replaced: result.replaced || 0,
    });
  } catch (error) {
    if (error.code === 'reauth_required') return res.status(409).json({ error: 'reauth_required' });
    return next(error);
  }
});

router.post('/predefined-quotes/imports/:id/approve', async (req, res, next) => {
  try {
    const result = await approvePredefinedQuoteImport(req.params.id, {
      payload: req.body?.payload,
      targetQuoteId: req.body?.target_quote_id,
      reviewerId: req.admin?.id,
    });
    if (!result) return res.status(404).json({ error: 'Import not found' });
    return res.json({ import: result.importRecord, quote: result.quote });
  } catch (error) {
    return next(error);
  }
});

router.post('/predefined-quotes/imports/:id/reject', async (req, res, next) => {
  try {
    const importRecord = await rejectPredefinedQuoteImport(req.params.id, req.admin?.id);
    if (!importRecord) return res.status(404).json({ error: 'Import waiting for review not found' });
    return res.json({ import: importRecord });
  } catch (error) {
    return next(error);
  }
});

router.get('/predefined-quotes', async (req, res) => {
  try {
    const quotes = await listPredefinedQuotes({
      query: req.query.query || req.query.q || '',
      limit: Number(req.query.limit) || 200,
    });
    res.json({ count: quotes.length, quotes });
  } catch (error) {
    console.error('List predefined quotes failed:', error);
    res.status(500).json({ error: 'Failed to list quotes' });
  }
});

router.get('/predefined-quotes/:id/pdf', async (req, res) => {
  try {
    const quote = await getPredefinedQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    await pipeQuotePdf(quote, res, await getAgencySettings());
  } catch (error) {
    console.error('Download predefined quote failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download quote' });
    }
  }
});

router.post('/predefined-quotes/:id/send-to-customer', async (req, res) => {
  try {
    const result = await sendQuoteToCustomer({
      quoteId: req.params.id,
      phone: req.body?.phone,
      note: req.body?.note,
    });
    res.json({ sent: true, to: result.to, quote_title: result.quote.title });
  } catch (error) {
    console.error('Send quote to customer failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to send quote' });
  }
});

router.get('/predefined-quotes/:id', async (req, res) => {
  try {
    const quote = await getPredefinedQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ quote });
  } catch (error) {
    console.error('Get predefined quote failed:', error);
    res.status(500).json({ error: 'Failed to load quote' });
  }
});

router.post('/predefined-quotes', async (req, res) => {
  try {
    const quote = await createPredefinedQuote(req.body, { adminId: req.admin?.id });
    res.status(201).json({ quote });
  } catch (error) {
    console.error('Create predefined quote failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create quote' });
  }
});

router.patch('/predefined-quotes/:id', async (req, res) => {
  try {
    const quote = await updatePredefinedQuote(req.params.id, req.body);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ quote });
  } catch (error) {
    console.error('Update predefined quote failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update quote' });
  }
});

router.delete('/predefined-quotes/:id', async (req, res) => {
  try {
    const quote = await deletePredefinedQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json({ deleted: true, quote: { id: quote.id, title: quote.title } });
  } catch (error) {
    console.error('Delete predefined quote failed:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});

export default router;
