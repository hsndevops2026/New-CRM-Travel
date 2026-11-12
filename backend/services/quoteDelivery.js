import { customerLanguage } from './customerLanguage.js';
/**
 * Quote delivery service.
 * Handles WhatsApp and email sends with idempotency, status tracking, and retry support.
 * Email uses Nodemailer (SMTP via env vars); WhatsApp uses Wasender.
 */

import { createRequire } from 'module';
import { query } from '../config/database.js';
import { sendTextMessage, sendDocumentMessage, formatRecipient } from './wasender.js';
import { buildVersionPdfBuffer } from './quotationPdf.js';
import { getVersionById, createShareToken, versionBlock } from './quoteVersions.js';
import { saveMessage } from './messages.js';
import { tryAutoTransitionLifecycle } from './leads.js';
import { getAgencySettings } from './agencySettings.js';
import { brandedFooterText } from './pdfBranding.js';

const require = createRequire(import.meta.url);

// Lazy nodemailer import so the app starts without SMTP config
let _nodemailer = null;
function nodemailer() {
  if (!_nodemailer) _nodemailer = require('nodemailer');
  return _nodemailer;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function money(amount, currency = 'USD') {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount)}`;
  }
}

function isLocalFrontendOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return /localhost|127\.0\.0\.1/i.test(String(origin || ''));
  }
}

/** Public CRM origin used in customer WhatsApp/email quote links. */
export function resolveFrontendBaseUrl({
  frontendUrl = process.env.FRONTEND_URL,
  corsOrigins = process.env.CORS_ORIGINS,
  fallback = 'http://localhost:5173',
} = {}) {
  const explicit = String(frontendUrl || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const origins = String(corsOrigins || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const publicOrigin = origins.find((origin) => !isLocalFrontendOrigin(origin));
  if (publicOrigin) return publicOrigin;

  return origins[0] || fallback;
}

function shareLink(token) {
  return `${resolveFrontendBaseUrl()}/quote/${token}`;
}

function publicPdfLink(token) {
  const base =
    process.env.BACKEND_URL ||
    process.env.API_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  return `${String(base).replace(/\/$/, '')}/api/q/${token}/pdf`;
}

// ── WhatsApp delivery ─────────────────────────────────────────────────────────

export function buildWhatsAppMessage(snapshot, token, agency, lang = 'ar') {
  const ar = lang === 'ar';
  const pricing = snapshot.pricing || {};
  const lead = snapshot.lead || {};
  const lines = [];

  lines.push(ar ? `*عرض سعر رحلتك من ${agency.agency_name}* ✈️` : `*${agency.agency_name} Travel Quote* ✈️`);
  lines.push('');
  if (lead.destination) lines.push(`📍 ${lead.destination}`);
  if (lead.travel_date) lines.push(`📅 ${lead.travel_date}${lead.return_date ? ' → ' + lead.return_date : ''}`);
  if (pricing.selling_price) {
    lines.push(ar ? `💰 المجموع: *${money(pricing.selling_price, snapshot.currency)}*` : `💰 Total: *${money(pricing.selling_price, snapshot.currency)}*`);
  }
  if (snapshot.valid_until) lines.push(ar ? `⏳ ساري حتى: ${snapshot.valid_until}` : `⏳ Valid until: ${snapshot.valid_until}`);
  lines.push('');
  lines.push(ar ? '👉 لمشاهدة العرض والموافقة عليه:' : '👉 View & accept your quote:');
  lines.push(`${shareLink(token)}${ar ? '?lang=ar' : ''}`);
  lines.push('');
  lines.push(ar ? '_للاستفسار، رد على هذه الرسالة._' : '_Reply to this message if you have any questions._');

  return lines.join('\n');
}

async function sendWhatsApp(delivery, snapshot, token, agency) {
  const message = buildWhatsAppMessage(snapshot, token, agency, await customerLanguage(delivery.recipient));
  const leadId = snapshot.lead?.id || null;

  try {
    await sendDocumentMessage(delivery.recipient, {
      text: message,
      documentUrl: publicPdfLink(token),
      fileName: `quote-v${snapshot.version_number || 1}.pdf`,
    });
  } catch (err) {
    console.error('[quoteDelivery] WhatsApp PDF send failed, falling back to text:', err.message);
    await sendTextMessage(delivery.recipient, message);
  }

  if (leadId) {
    await saveMessage({
      leadId,
      direction: 'outbound',
      channel: 'whatsapp',
      toNumber: delivery.recipient,
      body: message,
      status: 'sent',
      raw: { kind: 'quote_delivery', token, pdf: publicPdfLink(token) },
    });
  }
}

// ── Email delivery ─────────────────────────────────────────────────────────────

function getSmtpTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  if (!user || !pass) throw httpErr(503, 'SMTP credentials not configured (SMTP_USER / SMTP_PASS)');

  return nodemailer().createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendEmail(delivery, snapshot, token, agency) {
  const transport = getSmtpTransport();
  const pricing = snapshot.pricing || {};
  const lead = snapshot.lead || {};
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const link = shareLink(token);
  const totalStr = pricing.selling_price ? money(pricing.selling_price, snapshot.currency) : '';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#303030">
      <div style="background:${escapeHtml(agency.primary_color)};padding:24px 32px;border-radius:8px 8px 0 0">
        ${agency.logo_url ? `<img src="${escapeHtml(agency.logo_url)}" alt="" style="max-height:42px;max-width:110px;vertical-align:middle;margin-right:14px">` : ''}
        <span style="color:#fff;font-size:22px;font-weight:700">${escapeHtml(agency.agency_name)}</span>
        <span style="color:#9a9a9a;font-size:12px;margin-left:12px">Travel Quotation</span>
      </div>
      <div style="border:1px solid #e8e8e8;border-top:none;padding:32px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px;font-size:20px">Your travel quote is ready</h2>
        ${lead.destination ? `<p style="color:#616161;margin:4px 0">${escapeHtml(lead.destination)}</p>` : ''}
        ${lead.travel_date ? `<p style="color:#616161;margin:4px 0">${escapeHtml(lead.travel_date)}${lead.return_date ? ' → ' + escapeHtml(lead.return_date) : ''}</p>` : ''}
        ${totalStr ? `<p style="font-size:18px;font-weight:700;margin:16px 0">Total: ${escapeHtml(totalStr)}</p>` : ''}
        <a href="${escapeHtml(link)}" style="display:inline-block;background:${escapeHtml(agency.primary_color)};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0">
          View &amp; Accept Quote
        </a>
        ${snapshot.valid_until ? `<p style="color:#9a9a9a;font-size:12px;margin-top:16px">Valid until ${escapeHtml(snapshot.valid_until)}</p>` : ''}
        <p style="color:#9a9a9a;font-size:11px;border-top:1px solid #e8e8e8;padding-top:16px;margin-top:24px">
          ${escapeHtml(brandedFooterText(agency))}
        </p>
      </div>
    </div>
  `.trim();

  // Attach PDF
  let attachments = [];
  try {
    const pdfBuffer = await buildVersionPdfBuffer(snapshot, agency);
    attachments = [{
      filename: `quote-v${snapshot.version_number || 1}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }];
  } catch (err) {
    console.error('[quoteDelivery] PDF attachment failed:', err.message);
  }

  await transport.sendMail({
    from,
    to: delivery.recipient,
    subject: `Your Travel Quote${lead.destination ? ' — ' + lead.destination : ''} ${totalStr ? '(' + totalStr + ')' : ''}`.trim(),
    html,
    attachments,
  });
}

// ── delivery record management ─────────────────────────────────────────────────

async function upsertDeliveryRecord(versionId, channel, recipient) {
  // Idempotency: return existing pending/sent record for same version+channel+recipient
  const existing = await query(
    `SELECT * FROM quote_deliveries
     WHERE quote_version_id = $1 AND channel = $2 AND recipient = $3
     ORDER BY created_at DESC LIMIT 1`,
    [versionId, channel, recipient],
  );
  if (existing.rows[0] && ['pending', 'sent', 'delivered'].includes(existing.rows[0].status)) {
    return existing.rows[0];
  }

  const result = await query(
    `INSERT INTO quote_deliveries (quote_version_id, channel, recipient, status, attempt_count)
     VALUES ($1, $2, $3, 'pending', 0)
     RETURNING *`,
    [versionId, channel, recipient],
  );
  return result.rows[0];
}

async function markDeliveryStatus(deliveryId, status, { providerId, errorMessage } = {}) {
  const isSent = status === 'sent';
  const isDelivered = status === 'delivered';

  await query(
    `UPDATE quote_deliveries
     SET status = $2,
         provider_id = COALESCE($3, provider_id),
         error_message = $4,
         attempt_count = attempt_count + 1,
         sent_at = CASE WHEN $5 THEN NOW() ELSE sent_at END,
         delivered_at = CASE WHEN $6 THEN NOW() ELSE delivered_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [deliveryId, status, providerId || null, errorMessage || null, isSent, isDelivered],
  );
}

// ── public send API ───────────────────────────────────────────────────────────

/**
 * Send a quote version via one channel (whatsapp | email).
 * Creates a share token, builds the message, sends, and records the result.
 */
export async function sendQuoteVersion({ versionId, channel, recipient, expiryHours = 72 }) {
  if (!['whatsapp', 'email'].includes(channel)) {
    throw httpErr(400, 'channel must be "whatsapp" or "email"');
  }
  if (!recipient) throw httpErr(400, 'recipient is required');

  const normalizedRecipient =
    channel === 'whatsapp' ? formatRecipient(recipient) : String(recipient).trim();
  if (channel === 'whatsapp' && !/^\+[1-9]\d{7,14}$/.test(normalizedRecipient)) {
    throw httpErr(400, 'WhatsApp recipient must be a valid international phone number (E.164)');
  }

  const version = await getVersionById(versionId);
  if (!version) throw httpErr(404, 'Quote version not found');
  const block = await versionBlock(version);
  if (block) {
    const err = httpErr(block.status, block.message);
    err.code = block.code;
    throw err;
  }

  const snapshot = typeof version.snapshot === 'string'
    ? JSON.parse(version.snapshot)
    : version.snapshot;
  const agency = await getAgencySettings();

  // Create (or reuse) a share token
  const tokenRow = await createShareToken(versionId, { expiryHours });
  const token = tokenRow.token;

  // Create delivery record
  const delivery = await upsertDeliveryRecord(versionId, channel, normalizedRecipient);

  try {
    if (channel === 'whatsapp') {
      await sendWhatsApp(delivery, snapshot, token, agency);
    } else {
      await sendEmail(delivery, snapshot, token, agency);
    }
    await markDeliveryStatus(delivery.id, 'sent');
    if (snapshot.lead?.id) {
      void tryAutoTransitionLifecycle(snapshot.lead.id, 'quote_sent');
    }
    return { delivery_id: delivery.id, token, share_link: shareLink(token), status: 'sent' };
  } catch (err) {
    const message = String(err.message || 'Delivery failed');
    await markDeliveryStatus(delivery.id, 'failed', { errorMessage: message });
    throw httpErr(err.status || 502, message.startsWith('Delivery failed:') ? message : `Delivery failed: ${message}`);
  }
}

/**
 * Retry a failed delivery.
 */
export async function retryDelivery(deliveryId) {
  const result = await query(
    `SELECT qd.*, qv.snapshot, qv.id AS version_id
     FROM quote_deliveries qd
     JOIN quote_versions qv ON qv.id = qd.quote_version_id
     WHERE qd.id = $1 LIMIT 1`,
    [deliveryId],
  );
  const row = result.rows[0];
  if (!row) throw httpErr(404, 'Delivery not found');
  if (!['failed', 'pending'].includes(row.status)) {
    throw httpErr(409, 'Only failed or pending deliveries can be retried');
  }

  return sendQuoteVersion({
    versionId: row.version_id,
    channel: row.channel,
    recipient: row.recipient,
  });
}

// ── list helpers ──────────────────────────────────────────────────────────────

export async function listDeliveries(versionId) {
  const result = await query(
    `SELECT * FROM quote_deliveries WHERE quote_version_id = $1 ORDER BY created_at DESC`,
    [versionId],
  );
  return result.rows;
}

export async function listFailedDeliveries(limit = 50) {
  const result = await query(
    `SELECT qd.*, qv.version_number, qv.lead_id
     FROM quote_deliveries qd
     JOIN quote_versions qv ON qv.id = qd.quote_version_id
     WHERE qd.status = 'failed'
     ORDER BY qd.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}
