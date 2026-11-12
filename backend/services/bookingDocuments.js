import { query } from '../config/database.js';

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function listDocumentsForLead(leadId) {
  const result = await query(
    `SELECT d.*, a.email AS uploaded_by_email
     FROM booking_documents d
     LEFT JOIN admins a ON a.id = d.uploaded_by
     WHERE d.lead_id = $1
     ORDER BY d.created_at DESC`,
    [leadId],
  );
  return result.rows;
}

export async function listDocumentsForLeads(leadIds = []) {
  const ids = Array.isArray(leadIds) ? leadIds.filter(Boolean) : [];
  if (!ids.length) return [];
  const result = await query(
    `SELECT d.*, a.email AS uploaded_by_email
     FROM booking_documents d
     LEFT JOIN admins a ON a.id = d.uploaded_by
     WHERE d.lead_id = ANY($1::uuid[])
     ORDER BY d.created_at DESC`,
    [ids],
  );
  return result.rows;
}

export async function listDocumentsForPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  const result = await query(
    `SELECT d.*, a.email AS uploaded_by_email, l.destination, l.travel_date, l.booking_type
     FROM booking_documents d
     JOIN leads l ON l.id = d.lead_id
     LEFT JOIN admins a ON a.id = d.uploaded_by
     WHERE regexp_replace(l.phone, '\\D', '', 'g') = $1
     ORDER BY d.created_at DESC`,
    [digits],
  );
  return result.rows;
}

export async function createBookingDocument({
  leadId,
  title,
  fileUrl,
  fileName,
  mimeType,
  uploadedBy,
  documentType = null,
  extracted = null,
} = {}) {
  const cleanTitle = String(title || '').trim();
  const cleanUrl = String(fileUrl || '').trim();
  if (!leadId) throw httpErr(400, 'lead_id is required');
  if (!cleanTitle) throw httpErr(400, 'title is required');
  if (!cleanUrl) throw httpErr(400, 'file_url is required');
  try {
    // eslint-disable-next-line no-new
    new URL(cleanUrl);
  } catch {
    throw httpErr(400, 'file_url must be a valid URL');
  }

  const result = await query(
    `INSERT INTO booking_documents (lead_id, title, file_url, file_name, mime_type, uploaded_by, document_type, extracted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      leadId,
      cleanTitle,
      cleanUrl,
      fileName ? String(fileName).trim() : null,
      mimeType ? String(mimeType).trim() : null,
      uploadedBy || null,
      documentType || null,
      extracted ? JSON.stringify(extracted) : null,
    ],
  );
  return result.rows[0];
}

export async function getBookingDocument(id) {
  const result = await query(`SELECT * FROM booking_documents WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function deleteBookingDocument(id) {
  const result = await query(`DELETE FROM booking_documents WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
}
