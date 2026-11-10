import { apiFetch } from './api'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ComparisonItem = {
  id: string // composite: "source_type:uuid"
  source_type: 'predefined' | 'flight_api' | 'hotel_api' | 'dealer'
  source_id: string
  label: string
  description: string | null
  net_cost: number | null
  currency: string
  sort_price: number | null
  meta: Record<string, unknown>
}

export type QuoteItem = {
  id: string
  quote_draft_id: string
  source_type: string
  source_id: string
  label: string
  description: string | null
  net_cost: number | null
  currency: string
  quantity: number
  item_order: number
  meta: Record<string, unknown>
}

export type Pricing = {
  net_total: number
  markup_amount: number
  extras_amount: number
  subtotal: number
  selling_price: number
  gross_margin: number
  gross_margin_pct: number | null
}

export type QuoteDraft = {
  id: string
  lead_id: string
  currency: string
  markup_type: 'percent' | 'fixed'
  markup_value: number
  extras_amount: number
  extras_label: string | null
  rounding_mode: 'none' | 'ceil' | 'floor' | 'round'
  status: string
  notes: string | null
  valid_until: string | null
  created_at: string
  updated_at: string
  items: QuoteItem[]
  pricing: Pricing
}

export type DraftConfig = {
  currency?: string
  markup_type?: 'percent' | 'fixed'
  markup_value?: number
  extras_amount?: number
  extras_label?: string
  rounding_mode?: 'none' | 'ceil' | 'floor' | 'round'
  notes?: string
  valid_until?: string | null
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function fetchComparison(leadId: string): Promise<{
  count: number
  items: ComparisonItem[]
  source_errors: { source: string; error: string }[]
}> {
  const res = await apiFetch(`/api/leads/${leadId}/comparison`, { cache: 'no-store' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load comparison')
  return data
}

export async function fetchQuoteDraft(leadId: string): Promise<QuoteDraft | null> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-draft`)
  if (res.status === 404) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load quote draft')
  return data.draft as QuoteDraft
}

export async function upsertQuoteDraft(leadId: string, config: DraftConfig): Promise<QuoteDraft> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-draft`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to save quote draft')
  return data.draft as QuoteDraft
}

export async function selectDraftItems(leadId: string, ids: string[]): Promise<QuoteDraft> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-draft/select`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to select items')
  return data.draft as QuoteDraft
}

export async function setDraftItems(
  leadId: string,
  items: Omit<QuoteItem, 'id' | 'quote_draft_id' | 'created_at' | 'item_order'>[],
): Promise<QuoteDraft> {
  const res = await apiFetch(`/api/leads/${leadId}/quote-draft/items`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to set draft items')
  return data.draft as QuoteDraft
}
