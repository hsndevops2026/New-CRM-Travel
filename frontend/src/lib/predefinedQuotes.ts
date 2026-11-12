import { apiFetch, apiJson } from './api'
import { formatDate, formatMoney } from './leads'

export type QuoteType = 'hotel' | 'flight' | 'package'
/** `fixed`: exact dates (10–20 Oct). `period`: whole months (Jan, Feb, Oct) — any trip inside them. */
export type AvailabilityMode = 'fixed' | 'period'

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export type QuoteItemType = 'hotel' | 'flight'
export type FlightDirection = 'outbound' | 'return'

export type PredefinedQuoteItem = {
  id?: string
  item_type: QuoteItemType
  sort_order?: number
  title?: string | null
  description?: string | null
  image_url?: string | null
  price?: number | null
  currency?: string | null
  hotel_name?: string | null
  city?: string | null
  country?: string | null
  category?: string | null
  board_name?: string | null
  room_name?: string | null
  check_in?: string | null
  check_out?: string | null
  nights?: number | null
  airline?: string | null
  flight_number?: string | null
  departure_airport?: string | null
  arrival_airport?: string | null
  departure_city?: string | null
  arrival_city?: string | null
  departure_time?: string | null
  arrival_time?: string | null
  duration?: string | null
  stops?: number | null
  direction?: FlightDirection | string | null
  /** Server-filled extras (e.g. Google image gallery on save). */
  extra?: {
    gallery_urls?: string[]
    gallery_query?: string
    [key: string]: unknown
  } | null
}

export type PredefinedQuote = {
  id: string
  /** Shown on the public offers page. */
  is_public?: boolean
  title: string
  quote_type: QuoteType
  destination?: string | null
  origin?: string | null
  description?: string | null
  cover_image_url?: string | null
  currency: string
  total_price?: number | null
  notes?: string | null
  travel_date?: string | null
  return_date?: string | null
  availability_mode?: AvailabilityMode
  /** 1–12; only meaningful for a `period` package. */
  available_months?: number[]
  nights?: number | null
  adults_count: number
  children_count: number
  children_ages?: number[]
  created_at: string
  updated_at?: string
  items: PredefinedQuoteItem[]
  display_total?: number | null
}

export type PredefinedQuoteInput = {
  title: string
  destination?: string
  origin?: string
  description?: string
  cover_image_url?: string
  currency?: string
  total_price?: number | null
  notes?: string
  travel_date?: string
  return_date?: string
  availability_mode?: AvailabilityMode
  available_months?: number[]
  nights?: number | null
  adults_count?: number
  children_count?: number
  children_ages?: number[]
  items: PredefinedQuoteItem[]
}

export type PredefinedQuoteImportStatus =
  | 'processing'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'failed'

export type PredefinedQuoteImport = {
  id: string
  file_name: string
  file_hash: string
  file_size: number
  status: PredefinedQuoteImportStatus
  target_quote_id?: string | null
  approved_quote_id?: string | null
  extracted_payload?: PredefinedQuoteInput | null
  warnings: string[]
  error_message?: string | null
  uploaded_by_email?: string | null
  reviewed_by_email?: string | null
  reviewed_at?: string | null
  /** A brochure with several hotels/offers yields one import record per package. */
  batch_id?: string | null
  /** 0-based position of this package within its brochure. */
  batch_index?: number | null
  batch_total?: number | null
  /** Where the package is printed in the source, e.g. "3-4". */
  source_pages?: string | null
  created_at: string
  updated_at?: string
}

/** "Package 3 of 11 · page 4" — empty for single-package / legacy imports. */
export function importBatchLabel(record: Pick<PredefinedQuoteImport, 'batch_index' | 'batch_total' | 'source_pages'>) {
  const { batch_index: index, batch_total: total, source_pages: pages } = record
  const parts: string[] = []
  if (typeof index === 'number' && typeof total === 'number' && total > 1) {
    parts.push(`Package ${index + 1} of ${total}`)
  }
  if (pages) parts.push(/[-,]/.test(pages) ? `pages ${pages}` : `page ${pages}`)
  return parts.join(' · ')
}

export type CloudinarySign = {
  cloud_name: string
  api_key: string
  folder: string
  timestamp: number
  signature: string
}

export function emptyHotelItem(partial?: Partial<PredefinedQuoteItem>): PredefinedQuoteItem {
  return {
    item_type: 'hotel',
    hotel_name: '',
    city: '',
    country: '',
    category: '',
    room_name: '',
    board_name: '',
    check_in: '',
    check_out: '',
    price: null,
    image_url: '',
    description: '',
    ...partial,
  }
}

export function emptyFlightItem(partial?: Partial<PredefinedQuoteItem>): PredefinedQuoteItem {
  return {
    item_type: 'flight',
    airline: '',
    flight_number: '',
    direction: 'outbound',
    departure_airport: '',
    arrival_airport: '',
    departure_city: '',
    arrival_city: '',
    departure_time: '',
    arrival_time: '',
    duration: '',
    stops: 0,
    price: null,
    image_url: '',
    description: '',
    ...partial,
  }
}

/** Seed items for a freshly chosen quote type in the create modal. */
export function itemsForQuoteType(type: QuoteType): PredefinedQuoteItem[] {
  if (type === 'flight') return [emptyFlightItem({ direction: 'outbound' })]
  if (type === 'package') {
    return [emptyHotelItem(), emptyFlightItem({ direction: 'outbound' })]
  }
  return [emptyHotelItem()]
}

export function hasReturnFlight(items: PredefinedQuoteItem[]) {
  return items.some((item) => item.item_type === 'flight' && item.direction === 'return')
}

/** Build a return leg that mirrors the outbound route when possible. */
export function emptyReturnFlightItem(outbound?: PredefinedQuoteItem | null): PredefinedQuoteItem {
  return emptyFlightItem({
    direction: 'return',
    departure_airport: outbound?.arrival_airport || '',
    arrival_airport: outbound?.departure_airport || '',
    departure_city: outbound?.arrival_city || '',
    arrival_city: outbound?.departure_city || '',
  })
}

export function deriveQuoteType(items: PredefinedQuoteItem[]): QuoteType {
  const hasHotel = items.some((item) => item.item_type === 'hotel')
  const hasFlight = items.some((item) => item.item_type === 'flight')
  if (hasHotel && hasFlight) return 'package'
  if (hasFlight) return 'flight'
  return 'hotel'
}

export function displayTotal(quote: Pick<PredefinedQuote, 'total_price' | 'items' | 'display_total'>) {
  if (quote.display_total != null) return quote.display_total
  if (quote.total_price != null && !Number.isNaN(Number(quote.total_price))) {
    return Number(quote.total_price)
  }
  const sum = (quote.items || []).reduce((total, item) => total + (Number(item.price) || 0), 0)
  return sum > 0 ? sum : null
}

export function quoteTypeLabel(type: string) {
  if (type === 'package') return 'Flight + Hotel'
  if (type === 'flight') return 'Flight'
  return 'Hotel'
}

export function hotelLocationLabel(item: Pick<PredefinedQuoteItem, 'city' | 'country'>) {
  return [item.city, item.country].filter(Boolean).join(', ')
}

/** "Jan, Feb, Oct" (or full names) in calendar order; empty for none. */
export function monthsLabel(months: number[] | null | undefined, full = false): string {
  return [...new Set((months ?? []).map(Number))]
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    .sort((a, b) => a - b)
    .map((m) => (full ? MONTH_NAMES[m - 1] : MONTH_NAMES[m - 1].slice(0, 3)))
    .join(', ')
}

/** When a package can be offered: its exact dates, or its months. */
export function availabilityLabel(quote: Pick<PredefinedQuote, 'availability_mode' | 'available_months' | 'travel_date' | 'return_date'>): string {
  if (quote.availability_mode === 'period') return monthsLabel(quote.available_months, true)
  const from = quote.travel_date ? formatDate(quote.travel_date) : ''
  const to = quote.return_date ? formatDate(quote.return_date) : ''
  return [from, to].filter(Boolean).join(' → ')
}

export function quoteSummary(quote: PredefinedQuote) {
  const hotels = quote.items.filter((item) => item.item_type === 'hotel').length
  const flights = quote.items.filter((item) => item.item_type === 'flight').length
  const parts = [
    quote.origin && quote.destination ? `${quote.origin} → ${quote.destination}` : quote.destination,
    quote.availability_mode === 'period'
      ? monthsLabel(quote.available_months) || null
      : quote.travel_date
        ? formatDate(quote.travel_date)
        : null,
    hotels ? `${hotels} hotel${hotels === 1 ? '' : 's'}` : null,
    flights ? `${flights} flight${flights === 1 ? '' : 's'}` : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

export function formatQuoteMoney(amount: number | null | undefined, currency = 'USD') {
  return formatMoney(amount ?? null, currency)
}

export async function fetchPredefinedQuotes(search = '') {
  const params = new URLSearchParams()
  if (search.trim()) params.set('query', search.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const data = await apiJson<{ quotes: PredefinedQuote[] }>(`/api/predefined-quotes${suffix}`)
  return data.quotes || []
}

export async function createPredefinedQuote(input: PredefinedQuoteInput) {
  const data = await apiJson<{ quote: PredefinedQuote }>('/api/predefined-quotes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.quote
}

/** Sends a library package to a customer's WhatsApp number. */
export async function sendQuoteToCustomer(id: string, input: { phone: string; note?: string }) {
  return apiJson<{ sent: boolean; to: string; quote_title: string }>(`/api/predefined-quotes/${id}/send-to-customer`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updatePredefinedQuote(id: string, input: PredefinedQuoteInput) {
  const data = await apiJson<{ quote: PredefinedQuote }>(`/api/predefined-quotes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return data.quote
}

export async function deletePredefinedQuote(id: string) {
  await apiJson(`/api/predefined-quotes/${id}`, { method: 'DELETE' })
}

export async function fetchPredefinedQuoteImports(status?: PredefinedQuoteImportStatus) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const suffix = params.toString() ? `?${params}` : ''
  const data = await apiJson<{ imports: PredefinedQuoteImport[] }>(
    `/api/predefined-quotes/imports${suffix}`,
  )
  return data.imports || []
}

const BROCHURE_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function brochureContentType(file: File) {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.toLowerCase().split('.').pop() || ''
  return BROCHURE_MIME_BY_EXT[ext] || 'application/octet-stream'
}

export function isBrochureFile(file: File) {
  const type = brochureContentType(file).toLowerCase()
  if (type === 'application/pdf' || type.startsWith('image/')) return true
  const ext = file.name.toLowerCase().split('.').pop() || ''
  return Boolean(BROCHURE_MIME_BY_EXT[ext])
}

export async function uploadPredefinedQuoteBrochure(file: File, { reextract = false }: { reextract?: boolean } = {}) {
  const response = await apiFetch(`/api/predefined-quotes/imports/upload${reextract ? '?reextract=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': brochureContentType(file),
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  })
  const data = (await response.json().catch(() => ({}))) as {
    import?: PredefinedQuoteImport
    imports?: PredefinedQuoteImport[]
    duplicate?: boolean
    replaced?: number
    error?: string
  }
  if (!response.ok || !data.import) throw new Error(data.error || 'Failed to import brochure')
  return {
    importRecord: data.import,
    // Every package found in the brochure (older servers only send `import`).
    importRecords: data.imports?.length ? data.imports : [data.import],
    duplicate: Boolean(data.duplicate),
    /** Unreviewed packages from an earlier read that this re-read replaced. */
    replaced: data.replaced ?? 0,
  }
}

/** @deprecated Prefer uploadPredefinedQuoteBrochure */
export async function uploadPredefinedQuotePdf(file: File) {
  return uploadPredefinedQuoteBrochure(file)
}

export async function approvePredefinedQuoteImport(
  id: string,
  payload: PredefinedQuoteInput,
  targetQuoteId?: string | null,
) {
  const data = await apiJson<{ import: PredefinedQuoteImport; quote: PredefinedQuote }>(
    `/api/predefined-quotes/imports/${id}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ payload, target_quote_id: targetQuoteId || null }),
    },
  )
  return data
}

export async function rejectPredefinedQuoteImport(id: string) {
  const data = await apiJson<{ import: PredefinedQuoteImport }>(
    `/api/predefined-quotes/imports/${id}/reject`,
    { method: 'POST', body: '{}' },
  )
  return data.import
}

export async function fetchCloudinarySign() {
  return apiJson<CloudinarySign>('/api/uploads/cloudinary-sign')
}

export async function uploadQuoteImage(file: File) {
  const sign = await fetchCloudinarySign()
  const body = new FormData()
  body.append('file', file)
  body.append('api_key', sign.api_key)
  body.append('timestamp', String(sign.timestamp))
  body.append('signature', sign.signature)
  body.append('folder', sign.folder)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloud_name}/image/upload`, {
    method: 'POST',
    body,
  })
  const data = (await response.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } }
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || 'Image upload failed')
  }
  return data.secure_url
}

export async function downloadPredefinedQuotePdf(quote: PredefinedQuote) {
  const response = await apiFetch(`/api/predefined-quotes/${quote.id}/pdf`)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || 'Failed to download quote')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const slug = quote.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  link.href = url
  link.download = `${slug || 'quote'}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}
