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
  document_type?: string | null
  created_at: string
}

export async function fetchLeadDocuments(leadId: string): Promise<BookingDocument[]> {
  const data = await apiJson<{ documents: BookingDocument[] }>(`/api/leads/${leadId}/documents`)
  return data.documents || []
}

export async function createLeadDocument(
  leadId: string,
  input: { title: string; file_url: string; file_name?: string; mime_type?: string; classify?: boolean },
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

export type BulkUploadResult = { documents: BookingDocument[]; failed: string[] }

/**
 * Uploads several files one after another. Each one is read on the server and renamed
 * after what it is (ticket, hotel voucher, trip program…). Unless a title is given,
 * which then names a single file as typed.
 */
export async function uploadAndClassifyFiles(
  leadId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
  title?: string,
): Promise<BulkUploadResult> {
  const documents: BookingDocument[] = []
  const failed: string[] = []
  const fixedTitle = files.length === 1 ? title?.trim() : ''
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    onProgress?.(i, files.length)
    try {
      const uploaded = await uploadBookingFile(file)
      documents.push(await createLeadDocument(leadId, {
        title: fixedTitle || file.name.replace(/\.[^.]+$/, '') || file.name,
        file_url: uploaded.url,
        file_name: uploaded.fileName,
        mime_type: uploaded.mimeType,
        classify: !fixedTitle,
      }))
    } catch {
      failed.push(file.name)
    }
  }
  onProgress?.(files.length, files.length)
  return { documents, failed }
}

export const DOCUMENT_TYPE_NAMES: Record<string, string> = {
  flight_ticket: 'Flight ticket',
  hotel_voucher: 'Hotel booking',
  trip_program: 'Trip program',
  visa: 'Visa',
  passport: 'Passport',
  travel_insurance: 'Travel insurance',
  transfer: 'Transfer',
  tour_activity: 'Tour',
  invoice_receipt: 'Invoice',
  id_card: 'ID card',
}
