import { apiJson } from './api'
import { fetchCloudinarySign } from './predefinedQuotes'

export type BookingDocument = {
  id: string
  lead_id: string
  title: string
  file_url: string
  file_name?: string | null
  mime_type?: string | null
  uploaded_by?: string | null
  uploaded_by_email?: string | null
  created_at: string
}

export async function fetchLeadDocuments(leadId: string): Promise<BookingDocument[]> {
  const data = await apiJson<{ documents: BookingDocument[] }>(`/api/leads/${leadId}/documents`)
  return data.documents || []
}

export async function createLeadDocument(
  leadId: string,
  input: { title: string; file_url: string; file_name?: string; mime_type?: string },
): Promise<BookingDocument> {
  const data = await apiJson<{ document: BookingDocument }>(`/api/leads/${leadId}/documents`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.document
}

export async function deleteLeadDocument(leadId: string, documentId: string): Promise<void> {
  await apiJson(`/api/leads/${leadId}/documents/${documentId}`, { method: 'DELETE' })
}

/** @deprecated Prefer deleteLeadDocument(leadId, id) when the lead id is known. */
export async function deleteBookingDocument(documentId: string, leadId?: string): Promise<void> {
  if (!leadId) {
    throw new Error('leadId is required to delete a booking document')
  }
  await deleteLeadDocument(leadId, documentId)
}

export function formatFileSize(bytes?: number | null): string | null {
  if (bytes == null || !Number.isFinite(Number(bytes))) return null
  const n = Number(bytes)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Upload any file (PDF, image, etc.) to Cloudinary as a raw/auto asset. */
export async function uploadBookingFile(file: File): Promise<{ url: string; fileName: string; mimeType: string }> {
  const sign = await fetchCloudinarySign()
  const body = new FormData()
  body.append('file', file)
  body.append('api_key', sign.api_key)
  body.append('timestamp', String(sign.timestamp))
  body.append('signature', sign.signature)
  body.append('folder', sign.folder)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloud_name}/auto/upload`, {
    method: 'POST',
    body,
  })
  const data = (await response.json().catch(() => ({}))) as {
    secure_url?: string
    error?: { message?: string }
  }
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || 'File upload failed')
  }
  return {
    url: data.secure_url,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
  }
}
