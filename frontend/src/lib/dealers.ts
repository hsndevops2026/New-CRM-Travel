import { apiFetch } from './api'

export type Dealer = {
  id: string
  name: string
  phone: string
  company?: string | null
  notes?: string | null
  whatsapp_group_id?: string | null
  destinations?: string[]
  services?: string[]
  created_at: string
  updated_at?: string
}

export type DealerInput = {
  name: string
  phone: string
  company?: string
  notes?: string
  whatsapp_group_id?: string
  destinations?: string[]
  services?: string[]
}

export type DealerCountryCode = {
  id: string
  name: string
  iso_code?: string | null
  dial_code: string
  created_at?: string
  updated_at?: string
}

export type DealerCountryCodeInput = {
  name: string
  iso_code?: string
  dial_code: string
}

export type DealerRequest = {
  id: string
  lead_id: string
  dealer_id?: string | null
  dealer_name?: string
  dealer_phone?: string
  request_code: string
  status: string
  message_body: string
  sent_at?: string | null
  deadline_at?: string | null
  whatsapp_group_jid?: string | null
  group_name?: string | null
  created_at: string
}

export type DealerResponse = {
  id: string
  dealer_request_id: string
  request_code?: string
  lead_id?: string
  dealer_name?: string
  from_number?: string | null
  whatsapp_group_jid?: string | null
  group_name?: string | null
  raw_text: string
  extracted?: Record<string, unknown> | null
  extraction_confidence?: string
  extraction_errors?: string[] | null
  review_status: string
  reviewed_at?: string | null
  ai_rank_reason?: string | null
  is_recommended?: boolean
  is_best?: boolean
  best_confirmed_at?: string | null
  created_at: string
}

export async function fetchDealers(query = ''): Promise<Dealer[]> {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/dealers${suffix}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load dealers')
  return (data.dealers || []) as Dealer[]
}

export async function createDealer(input: DealerInput): Promise<Dealer> {
  const response = await apiFetch('/api/dealers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to save dealer')
  return data.dealer as Dealer
}

export async function updateDealer(id: string, input: DealerInput): Promise<Dealer> {
  const response = await apiFetch(`/api/dealers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update dealer')
  return data.dealer as Dealer
}

export async function deleteDealer(id: string): Promise<void> {
  const response = await apiFetch(`/api/dealers/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete dealer')
}

export async function fetchDealerCountryCodes(): Promise<DealerCountryCode[]> {
  const response = await apiFetch('/api/dealer-country-codes')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load country codes')
  return (data.country_codes || []) as DealerCountryCode[]
}

export async function createDealerCountryCode(input: DealerCountryCodeInput): Promise<DealerCountryCode> {
  const response = await apiFetch('/api/dealer-country-codes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to create country code')
  return data.country_code as DealerCountryCode
}

export async function updateDealerCountryCode(
  id: string,
  input: DealerCountryCodeInput,
): Promise<DealerCountryCode> {
  const response = await apiFetch(`/api/dealer-country-codes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to update country code')
  return data.country_code as DealerCountryCode
}

export async function deleteDealerCountryCode(id: string): Promise<void> {
  const response = await apiFetch(`/api/dealer-country-codes/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to delete country code')
}

export async function sendQuoteToDealer(args: { dealerId: string; quoteId: string }): Promise<void> {
  const response = await apiFetch('/api/dealers/send', {
    method: 'POST',
    body: JSON.stringify({ dealer_id: args.dealerId, quote_id: args.quoteId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to send quote to dealer')
}

export async function dispatchRfq(args: {
  leadId: string
  dealerId?: string
  groupJid?: string
  groupName?: string
  deadlineHours?: number
}): Promise<DealerRequest> {
  const response = await apiFetch('/api/dealer-requests', {
    method: 'POST',
    body: JSON.stringify({
      lead_id: args.leadId,
      dealer_id: args.dealerId || undefined,
      group_jid: args.groupJid || undefined,
      group_name: args.groupName || undefined,
      deadline_hours: args.deadlineHours ?? 24,
    }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to dispatch RFQ')
  return data.dealer_request as DealerRequest
}

export async function fetchDealerRequests(params: {
  leadId?: string
  dealerId?: string
  status?: string
} = {}): Promise<DealerRequest[]> {
  const qs = new URLSearchParams()
  if (params.leadId) qs.set('lead_id', params.leadId)
  if (params.dealerId) qs.set('dealer_id', params.dealerId)
  if (params.status) qs.set('status', params.status)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const response = await apiFetch(`/api/dealer-requests${suffix}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load dealer requests')
  return data.dealer_requests as DealerRequest[]
}

export async function fetchDealerResponses(params: {
  dealerRequestId?: string
  leadId?: string
  reviewStatus?: string
} = {}): Promise<DealerResponse[]> {
  const qs = new URLSearchParams()
  if (params.dealerRequestId) qs.set('dealer_request_id', params.dealerRequestId)
  if (params.leadId) qs.set('lead_id', params.leadId)
  if (params.reviewStatus) qs.set('review_status', params.reviewStatus)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const response = await apiFetch(`/api/dealer-responses${suffix}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load dealer responses')
  return data.dealer_responses as DealerResponse[]
}

export async function reviewResponse(
  responseId: string,
  approved: boolean,
  correctedData?: Record<string, unknown>,
): Promise<DealerResponse> {
  const response = await apiFetch(`/api/dealer-responses/${responseId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ approved, corrected_data: correctedData }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to review response')
  return data.dealer_response as DealerResponse
}

export async function confirmBestOffer(responseId: string): Promise<DealerResponse> {
  const response = await apiFetch(`/api/dealer-responses/${responseId}/best`, { method: 'PATCH' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to confirm best offer')
  return data.dealer_response as DealerResponse
}

export type WhatsAppGroup = {
  jid: string
  name: string
  imgUrl?: string | null
  source?: 'session' | 'dealer'
}

export function looksLikeGroupJid(value: string) {
  const raw = String(value || '').trim()
  return /@g\.us\b/i.test(raw) || /^120363\d{8,}$/.test(raw) || /^\d{6,}-\d{6,}$/.test(raw)
}

export type WhatsAppGroupsResult = {
  groups: WhatsAppGroup[]
  sessionCount: number
  sessionStatus?: string | null
  sessionName?: string | null
}

export async function fetchWhatsAppGroups(force = false): Promise<WhatsAppGroupsResult> {
  const suffix = force ? '?force=true' : ''
  const response = await apiFetch(`/api/whatsapp-groups${suffix}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load WhatsApp groups')
  return {
    groups: (data.groups || []) as WhatsAppGroup[],
    sessionCount: Number(data.session_count || 0),
    sessionStatus: data.session_status || null,
    sessionName: data.session_name || null,
  }
}

export type UnmatchedDealerMessage = {
  id: string
  from_number?: string | null
  group_id?: string | null
  body?: string | null
  resolved?: boolean
  created_at?: string
}

export async function fetchUnmatchedDealerMessages(resolved = false): Promise<UnmatchedDealerMessage[]> {
  const response = await apiFetch(`/api/dealer-unmatched?resolved=${resolved ? 'true' : 'false'}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load unmatched messages')
  return (data.messages || []) as UnmatchedDealerMessage[]
}

export async function resolveUnmatchedDealerMessage(id: string): Promise<void> {
  const response = await apiFetch(`/api/dealer-unmatched/${id}/resolve`, { method: 'PATCH' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Failed to resolve message')
}
