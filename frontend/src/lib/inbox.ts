import { apiFetch } from './api'

export type ThreadKind = 'customer' | 'dealer' | 'group'

export type Thread = {
  id: string
  kind: ThreadKind
  title: string
  subtitle: string
  last_message: string
  last_at: string | null
  lead_id?: string
  phone?: string
  lifecycle_status?: string
  dealer_request_id?: string
  request_code?: string
  request_status?: string
  pending_response_id?: string | null
  last_direction?: string | null
  group_jid?: string
}

export type ChatMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
  status: string
  channel: string
  meta?: Record<string, unknown>
  synthetic?: boolean
}

export type ThreadDetail = Thread & {
  pending_response?: {
    id: string
    raw_text: string
    review_status: string
    extracted?: Record<string, unknown> | null
    extraction_confidence?: string
  } | null
}

export async function fetchThreads(kind: 'all' | ThreadKind = 'all'): Promise<Thread[]> {
  const qs = kind === 'all' ? '' : `?kind=${kind}`
  const res = await apiFetch(`/api/inbox/threads${qs}`, { cache: 'no-store' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load threads')
  return data.threads as Thread[]
}

export async function fetchThreadMessages(
  threadId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ thread: ThreadDetail; messages: ChatMessage[] }> {
  const params = new URLSearchParams()
  if (opts.before) params.set('before', opts.before)
  if (opts.limit) params.set('limit', String(opts.limit))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const res = await apiFetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages${suffix}`, {
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load messages')
  return data as { thread: ThreadDetail; messages: ChatMessage[] }
}

export async function sendThreadMessage(threadId: string, body: string): Promise<ChatMessage> {
  const res = await apiFetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/send`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to send message')
  return data.message as ChatMessage
}

export function customerThreadId(leadId: string) {
  return `customer:${leadId}`
}

export function customerPhoneThreadId(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `customer:phone:${digits}`
}

export function dealerThreadId(dealerRequestId: string) {
  return `dealer:${dealerRequestId}`
}

export function groupThreadId(groupJid: string) {
  return `group:${groupJid}`
}

export function formatThreadTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
