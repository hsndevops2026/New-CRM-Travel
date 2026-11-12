import { apiFetch } from './api'
import type { Pricing, QuoteItem } from './quoteDrafts'
import type { AgencySettings } from './agencySettings'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuoteVersion = {
  id: string
  quote_draft_id: string
  lead_id: string
  version_number: number
  snapshot: QuoteSnapshot
  selling_price: number | null
  currency: string
  status: 'sent' | 'accepted' | 'revoked'
  accepted_at: string | null
  accepted_by: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  /** not_required · pending (waiting for a manager) · approved · rejected (changes asked). */
  approval_status?: 'not_required' | 'pending' | 'approved' | 'rejected'
  reviewed_at?: string | null
  review_note?: string | null
}

export type QuoteSnapshot = {
  title: string
  version_number: number
  currency: string
  notes: string | null
  valid_until: string | null
  lead: {
    id: string
    destination?: string
    origin?: string
    travel_date?: string
    return_date?: string
    nights?: number
    adults_count?: number
    children_count?: number
    customer_name?: string
    booking_type?: string
  }
  items: Omit<QuoteItem, 'id' | 'quote_draft_id' | 'created_at' | 'item_order'>[]
  pricing: Pricing
  markup_type: 'percent' | 'fixed'
  markup_value: number
}

export type QuoteDelivery = {
  id: string
  quote_version_id: string
  channel: 'whatsapp' | 'email'
  recipient: string
  status: 'pending' | 'sent' | 'delivered' | 'failed'
  provider_id: string | null
  error_message: string | null
  attempt_count: number
  sent_at: string | null
  created_at: string
  updated_at: string
}

export type ShareTokenView = {
  token: string
  expires_at: string
  views: number
  version_status: string
  selling_price: number | null
  currency: string
  accepted_at: string | null
  /** A newer version replaced this one: it can be read but not accepted. */
  superseded?: boolean
  /** The quote's valid-until date has passed. */
  expired?: boolean
  snapshot: {
    title: string
    version_number: number
    currency: string
    notes: string | null
    valid_until: string | null
    lead: Omit<QuoteSnapshot['lead'], 'id'>
    items: Array<Pick<QuoteItem, 'label' | 'description' | 'quantity'> & { meta?: Record<string, unknown> }>
    pricing: { selling_price: number | null }
  }
  agency: AgencySettings
}

// ── API ───────────────────────────────────────────────────────────────────────

export async function lockVersion(leadId: string, notes?: string): Promise<QuoteVersion> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-versions`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to lock version')
  return data.version as QuoteVersion
}

export async function fetchVersions(leadId: string): Promise<QuoteVersion[]> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-versions`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load versions')
  return data.versions as QuoteVersion[]
}

export async function sendVersion(
  versionId: string,
  args: { channel: 'whatsapp' | 'email'; recipient: string; expiry_hours?: number },
): Promise<{ delivery_id: string; token: string; share_link: string; status: string }> {
  const res = await apiFetch(`/api/quote-versions/${versionId}/send`, {
    method: 'POST',
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to send quote')
  return data
}

export async function fetchDeliveries(versionId: string): Promise<QuoteDelivery[]> {
  const res = await apiFetch(`/api/quote-versions/${versionId}/deliveries`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load deliveries')
  return data.deliveries as QuoteDelivery[]
}

export async function retryDelivery(deliveryId: string): Promise<{ status: string }> {
  const res = await apiFetch(`/api/quote-deliveries/${deliveryId}/retry`, { method: 'POST' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to retry delivery')
  return data
}

export async function revokeVersion(versionId: string): Promise<void> {
  const res = await apiFetch(`/api/quote-versions/${versionId}/revoke`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to revoke')
  }
}

/** Fetch PDF with staff auth and open in a new tab. */
export async function openVersionPdf(versionId: string): Promise<void> {
  const res = await apiFetch(`/api/quote-versions/${versionId}/pdf`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || 'Failed to load PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ── Public (no auth) ──────────────────────────────────────────────────────────

export async function fetchPublicQuote(token: string): Promise<ShareTokenView> {
  const res = await fetch(`/api/q/${token}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Quote not found')
  return data as ShareTokenView
}

export async function acceptPublicQuote(
  token: string,
  args: { customer_name?: string; customer_email?: string },
): Promise<{ accepted: boolean }> {
  const res = await fetch(`/api/q/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to accept quote')
  return data
}

export function publicPdfUrl(token: string): string {
  return `/api/q/${token}/pdf`
}

export async function reviewVersion(versionId: string, decision: 'approved' | 'rejected', note?: string): Promise<QuoteVersion> {
  const res = await apiFetch(`/api/quote-versions/${versionId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Review failed')
  return data.version as QuoteVersion
}

/** Can this version go to the customer yet? */
export function awaitingApproval(version: Pick<QuoteVersion, 'approval_status'>): boolean {
  return version.approval_status === 'pending' || version.approval_status === 'rejected'
}
