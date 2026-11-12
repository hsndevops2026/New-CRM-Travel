import { locale } from './i18n'
export type Lead = {
  id: string
  phone: string
  booking_type: 'hotel' | 'flight' | 'package' | string
  origin: string | null
  destination: string
  travel_date: string
  return_date: string
  nights: number
  adults_count: number
  children_count: number
  children_ages: number[]
  budget: string | null
  hotel_name: string | null
  notes: string | null
  summary: string | null
  status?: string
  source?: string
  quote_status?: 'processing' | 'completed' | 'error' | 'package' | null
  quote_error?: string | null
  quotes_fetched_at?: string | null
  quote_search?: {
    phase?: string
    /** Which flight provider produced the quotes: 'booking.com' | 'google_flights'. */
    flight_provider?: string
  } | null
  predefined_quote_id?: string | null
  predefined_quote_title?: string | null
  predefined_quote_type?: string | null
  pending_package_offer_id?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_id?: string | null
  group_trip_id?: string | null
  assigned_to?: string | null
  lifecycle_status?: string | null
  /** Stages the API will accept from the current one; server-computed. */
  lifecycle_allowed?: string[]
  created_at: string
}

export type LeadInput = {
  phone: string
  booking_type: 'hotel' | 'flight' | 'package'
  origin?: string
  destination: string
  travel_date: string
  return_date: string
  adults_count: number
  children_count: number
  children_ages?: number[] | string
  hotel_name?: string
  notes?: string
  status?: string
  source?: string
}

export type LeadsResponse = {
  count: number
  leads: Lead[]
}

export type FlightLeg = {
  airline: string | null
  departure_airport?: string
  departure_city?: string
  departure_time?: string
  arrival_airport?: string
  arrival_city?: string
  arrival_time?: string
  duration?: string
}

export type FlightSegment = {
  airline: string
  flight_number: string | null
  departure_airport?: string
  departure_city?: string
  departure_time?: string
  arrival_airport?: string
  arrival_city?: string
  arrival_time?: string
  duration: string
  stops: number
  legs: FlightLeg[]
}

export type FlightQuote = {
  id: string
  price: number | null
  currency: string
  outbound: FlightSegment | null
  inbound: FlightSegment | null
}

export type FlightQuotesResponse = {
  lead_id?: string
  quote_status?: string | null
  quote_error?: string | null
  quotes_fetched_at?: string | null
  from: { id: string; name: string; code?: string | null } | null
  to: { id: string; name: string; code?: string | null } | null
  search: Record<string, unknown> | null
  count: number
  quotes: FlightQuote[]
}

export type HotelQuoteDetail = {
  hotel_code: string | null
  hotel_name: string | null
  category: string | null
  destination_code: string | null
  destination_name: string | null
  zone_code: string | null
  zone_name: string | null
  latitude: number | null
  longitude: number | null
  room_code: string | null
  room_name: string | null
  rate_key: string | null
  rate_class: string | null
  rate_type: string | null
  net: number | null
  selling_rate: number | null
  price: number | null
  currency: string
  board_code: string | null
  board_name: string | null
  allotment: number | null
  payment_type: string | null
  packaging: boolean
  adults: number | null
  children: number | null
  children_ages: unknown
  rooms: number | null
  rate_comments_id: string | null
  promotions: { code: string | null; name: string | null; amount: number | null }[] | null
  refundable: boolean
  free_cancellation: boolean
  cancellation_summary: string
  cancellation_policies: { amount?: string | number; from?: string }[]
}

export type HotelQuote = {
  id: string
  external_id: string | null
  hotel_name: string | null
  category: string | null
  destination_code: string | null
  destination_name: string | null
  zone_name: string | null
  latitude: number | null
  longitude: number | null
  price: number | null
  currency: string
  room_code?: string | null
  room_name?: string | null
  rate_key: string | null
  rate_type: string | null
  rate_class?: string | null
  board_code: string | null
  board_name: string | null
  review_score?: number | null
  review_count?: number | null
  review_word?: string | null
  photo_url?: string | null
  refundable?: boolean
  free_cancellation?: boolean
  cancellation_summary?: string | null
  cancellation_policies: unknown | null
  details?: HotelQuoteDetail[]
  provider?: string | null
  created_at: string
}

export type HotelSourceResult = {
  ok: boolean
  error: string | null
  count: number
  destination: { code?: string; name?: string; dest_id?: string } | null
  search: Record<string, unknown> | null
  quotes: HotelQuote[]
}

export type HotelSourcesResponse = {
  lead_id: string
  destination: string
  sources: {
    hotelbeds: HotelSourceResult
    booking: HotelSourceResult
    airbnb: HotelSourceResult
  }
}

export const HOTEL_SOURCE_ORDER = [
  { id: 'booking.com', label: 'Booking.com' },
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'hotelbeds', label: 'Hotelbeds' },
] as const

export function hotelProviderLabel(provider?: string | null) {
  if (provider === 'booking.com') return 'Booking.com'
  if (provider === 'airbnb') return 'Airbnb'
  return 'Hotelbeds'
}

export type HotelQuotesResponse = {
  lead_id?: string
  quote_status?: string | null
  quote_error?: string | null
  quotes_fetched_at?: string | null
  destination: { code: string; name: string; countryCode?: string | null } | null
  search: Record<string, unknown> | null
  count: number
  quotes: HotelQuote[]
}

export function formatDate(value: string) {
  if (!value) return '—'
  const dateOnly = value.slice(0, 10)
  const date = new Date(`${dateOnly}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateOnly
  return date.toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatWhen(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatPhone(phone: string) {
  if (!phone) return '—'
  return phone.startsWith('+') ? phone : `+${phone}`
}

export function leadTitle(lead: Lead) {
  if ((lead.booking_type === 'flight' || lead.booking_type === 'package') && lead.origin) {
    return `${lead.origin} → ${lead.destination}`
  }
  return lead.destination
}

export function leadPerson(lead: Lead) {
  const name = String(lead.contact_name || '').trim()
  return name || formatPhone(lead.phone)
}

export function formatTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatMoney(amount: number | null, currency = 'USD') {
  if (amount == null || Number.isNaN(amount)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

/** Backend base URL. Empty in local Vite (proxy). Set VITE_API_URL on Vercel. */
export { apiUrl } from './api'
import { apiFetch, apiJson } from './api'

export async function fetchFlightQuotes(lead: Lead): Promise<FlightQuotesResponse> {
  const response = await apiFetch(`/api/leads/${lead.id}/quotes`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load flight quotes')
  return data as FlightQuotesResponse
}

export async function fetchHotelQuotes(lead: Lead): Promise<HotelQuotesResponse> {
  const response = await apiFetch(`/api/leads/${lead.id}/hotel-quotes`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load hotel quotes')
  return data as HotelQuotesResponse
}

const hotelSourcesCache = new Map<string, HotelSourcesResponse>()
const hotelSourcesInflight = new Map<string, Promise<HotelSourcesResponse>>()

export async function fetchHotelSources(lead: Lead): Promise<HotelSourcesResponse> {
  const cached = hotelSourcesCache.get(lead.id)
  if (cached) return cached

  const pending = hotelSourcesInflight.get(lead.id)
  if (pending) return pending

  const request = (async () => {
    const response = await apiFetch(`/api/leads/${lead.id}/hotel-sources`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load hotels')
    const payload = data as HotelSourcesResponse
    hotelSourcesCache.set(lead.id, payload)
    return payload
  })().finally(() => {
    hotelSourcesInflight.delete(lead.id)
  })

  hotelSourcesInflight.set(lead.id, request)
  return request
}

export function clearHotelSourcesCache(leadId?: string) {
  if (leadId) hotelSourcesCache.delete(leadId)
  else hotelSourcesCache.clear()
}

export async function retryHotelQuotes(leadId: string): Promise<void> {
  clearHotelSourcesCache(leadId)
  const response = await apiFetch(`/api/leads/${leadId}/hotel-quotes/retry`, { method: 'POST' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to retry hotel quotes')
}

export async function retryFlightQuotes(leadId: string): Promise<Lead> {
  const response = await apiFetch(`/api/leads/${leadId}/quotes/retry`, { method: 'POST' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to retry quotes')
  return data.lead as Lead
}

export async function fetchLeads(): Promise<Lead[]> {
  const response = await apiFetch('/api/leads')
  if (!response.ok) throw new Error('Could not load leads')
  const data = (await response.json()) as LeadsResponse
  return data.leads || []
}

export async function fetchLeadById(id: string): Promise<Lead> {
  const response = await apiFetch(`/api/leads/${id}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load lead')
  return data.lead as Lead
}

export async function retryPackageQuotes(leadId: string): Promise<Lead> {
  const response = await apiFetch(`/api/leads/${leadId}/package-quotes/retry`, { method: 'POST' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to retry package quotes')
  return data.lead as Lead
}

export type PackageOfferInfo = {
  pending: boolean
  package: { id: string; title: string; destination?: string | null; nights?: number | null } | null
}

export async function fetchPackageOffer(leadId: string): Promise<PackageOfferInfo> {
  const data = await apiJson<PackageOfferInfo>(`/api/leads/${leadId}/package-offer`)
  return data
}

export async function acceptPackageOffer(leadId: string): Promise<Lead> {
  const data = await apiJson<{ lead: Lead }>(`/api/leads/${leadId}/package-offer/accept`, { method: 'POST' })
  return data.lead
}

export async function declinePackageOffer(leadId: string): Promise<Lead> {
  const data = await apiJson<{ lead: Lead }>(`/api/leads/${leadId}/package-offer/decline`, { method: 'POST' })
  return data.lead
}

export async function createLead(payload: LeadInput): Promise<Lead> {
  const response = await apiFetch('/api/leads', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to create lead')
  return (data.lead || data) as Lead
}

export type SimulateWhatsAppResult = {
  phone: string
  complete: boolean
  missing: string[]
  collected: Record<string, unknown>
  reply: string
  restart_notice?: string | null
  restarted?: boolean
  lead: Lead | null
  awaiting_package?: boolean
  predefined_quote?: { id: string; title: string; destination?: string | null } | null
}

/** CRM test: same WhatsApp intake pipeline, no Wasender send. */
export async function simulateWhatsAppMessage(payload: {
  message: string
  phone?: string
}): Promise<SimulateWhatsAppResult> {
  const response = await apiFetch('/api/leads/simulate-whatsapp', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to simulate WhatsApp message')
  return data as SimulateWhatsAppResult
}

/* ── CRM test: WhatsApp voice notes ─────────────────────────────────────── */

/** What a finished voice test returns. */
export type SimulateVoiceOutcome = {
  transcript?: string
  /** The normal intake result (reply, collected fields, lead…). */
  result?: SimulateWhatsAppResult | null
  /** Set when the note could not become a lead (silence, too long); `reply` says why. */
  skipped?: 'too_long' | 'empty' | 'lead_exists'
  reply?: string
}

export type SimulateVoiceStatus =
  | { status: 'queued' }
  | { status: 'processing'; transcript?: string | null }
  | { status: 'done'; outcome: SimulateVoiceOutcome }
  | { status: 'failed'; error: string }

const AUDIO_TYPE_BY_EXT: Record<string, string> = {
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
}

/** Browsers often leave File.type empty for .m4a/.opus; fall back to the extension. */
export function audioContentType(blob: Blob, fileName = '') {
  if (blob.type && blob.type.startsWith('audio/')) return blob.type
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return AUDIO_TYPE_BY_EXT[ext] || blob.type || 'application/octet-stream'
}

/**
 * Queues a voice note on the real voice queue (same worker as a WhatsApp voice
 * note; nothing is sent to WhatsApp). Resolves with the job id to poll.
 */
export async function startSimulatedVoice(
  audio: Blob,
  options: { phone?: string; seconds?: number | null; fileName?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': audioContentType(audio, options.fileName),
  }
  if (options.phone) headers['X-Phone'] = options.phone
  if (options.seconds) headers['X-Audio-Seconds'] = String(Math.round(options.seconds * 10) / 10)

  const response = await apiFetch('/api/leads/simulate-voice', {
    method: 'POST',
    headers,
    body: audio,
    signal: options.signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.job_id) throw new Error(data.error || 'Failed to start the voice test')
  return data.job_id as string
}

export async function fetchSimulatedVoice(jobId: string, signal?: AbortSignal): Promise<SimulateVoiceStatus> {
  const response = await apiFetch(`/api/leads/simulate-voice/${encodeURIComponent(jobId)}`, { signal })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to read the voice test')
  return data as SimulateVoiceStatus
}

/** Queues the audio, then polls until the worker is finished. */
export async function simulateVoiceMessage(
  audio: Blob,
  options: {
    phone?: string
    seconds?: number | null
    fileName?: string
    signal?: AbortSignal
    onStatus?: (status: SimulateVoiceStatus) => void
    intervalMs?: number
    timeoutMs?: number
  } = {},
): Promise<SimulateVoiceOutcome> {
  const { onStatus, intervalMs = 1000, timeoutMs = 120_000, signal } = options
  const jobId = await startSimulatedVoice(audio, options)
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const status = await fetchSimulatedVoice(jobId, signal)
    onStatus?.(status)
    if (status.status === 'done') return status.outcome
    if (status.status === 'failed') throw new Error(status.error)
    if (Date.now() > deadline) {
      throw new Error('The voice test is taking too long. Check that the backend worker is running.')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export async function bulkCreateLeads(leads: LeadInput[]) {
  const response = await apiFetch('/api/leads/bulk', {
    method: 'POST',
    body: JSON.stringify({ leads, source: 'csv' }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to import leads')
  return data as {
    created_count: number
    failed_count: number
    created: Lead[]
    failed: Array<{ row: number; error: string }>
  }
}

export async function updateLeadStatus(
  id: string,
  status: string,
  contact_name?: string,
  contact_email?: string,
): Promise<Lead> {
  const response = await apiFetch(`/api/leads/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, contact_name, contact_email }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update status')
  return data.lead
}

export async function deleteLead(id: string): Promise<void> {
  const response = await apiFetch(`/api/leads/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete lead')
}

export async function deleteLeadsBulk(ids: string[]): Promise<number> {
  const response = await apiFetch('/api/leads/delete-bulk', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to delete leads')
  return data.deleted_count || 0
}

/** Minimal CSV parser supporting quoted fields */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.trim())
      if (row.some((cell) => cell)) rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field.length || row.length) {
    row.push(field.trim())
    if (row.some((cell) => cell)) rows.push(row)
  }

  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {}
    headers.forEach((header, index) => {
      obj[header] = cells[index] || ''
    })
    return obj
  })
}

export function csvRowToLeadInput(row: Record<string, string>): LeadInput {
  return {
    phone: row.phone || '',
    booking_type: String(row.booking_type || 'hotel').toLowerCase() === 'flight'
      ? 'flight'
      : String(row.booking_type || 'hotel').toLowerCase() === 'package'
        ? 'package'
        : 'hotel',
    origin: row.origin || undefined,
    destination: row.destination || '',
    travel_date: row.travel_date || '',
    return_date: row.return_date || '',
    adults_count: Number(row.adults_count || 1),
    children_count: Number(row.children_count || 0),
    children_ages: row.children_ages || undefined,
    hotel_name: row.hotel_name || undefined,
    notes: row.notes || undefined,
    status: row.status || 'new',
    source: 'csv',
  }
}

export const CSV_TEMPLATE = `phone,booking_type,origin,destination,travel_date,return_date,adults_count,children_count,children_ages,hotel_name,notes,status
919800000001,hotel,,Dubai,2026-10-01,2026-10-07,2,0,,Atlantis,Sea view,new
919800000002,flight,Delhi,Dubai,2026-11-01,2026-11-08,1,1,6,,,new
`

export type LifecycleStatus =
  | 'intake'
  | 'sourcing'
  | 'awaiting_dealers'
  | 'comparing'
  | 'drafting'
  | 'ready_to_send'
  | 'sent'
  | 'accepted'
  | 'booked'
  | 'lost'
  | 'archived'

export async function assignLead(id: string, assignedTo: string | null): Promise<Lead> {
  const data = await apiJson<{ lead: Lead }>(`/api/leads/${id}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ assigned_to: assignedTo }),
  })
  return data.lead
}

export async function transitionLifecycle(
  id: string,
  lifecycleStatus: LifecycleStatus,
  opts?: { contact_name?: string; contact_email?: string },
): Promise<Lead> {
  const data = await apiJson<{ lead: Lead }>(`/api/leads/${id}/lifecycle`, {
    method: 'PATCH',
    body: JSON.stringify({
      lifecycle_status: lifecycleStatus,
      contact_name: opts?.contact_name,
      contact_email: opts?.contact_email,
    }),
  })
  return data.lead
}

export async function fetchLeadMessages(leadId: string): Promise<unknown[]> {
  const data = await apiJson<{ messages: unknown[] }>(`/api/leads/${leadId}/messages`)
  return data.messages
}

export async function fetchLeadAudit(leadId: string): Promise<unknown[]> {
  const data = await apiJson<{ events: unknown[] }>(`/api/leads/${leadId}/audit`)
  return data.events
}
