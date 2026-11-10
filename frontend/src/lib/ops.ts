import { apiFetch } from './api'

export type QueueCounts = Record<
  string,
  { waiting: number; active: number; completed: number; failed: number; delayed: number }
>

export type FailedQueueJob = {
  id: string
  name: string
  queue: string
  lead_id: string | null
  attempts_made: number
  failed_reason: string | null
  finished_on: string | null
}

export type FailedDelivery = {
  id: string
  quote_version_id: string
  version_number?: number
  lead_id?: string
  channel: 'whatsapp' | 'email'
  recipient: string
  status: string
  error_message: string | null
  attempt_count: number
  updated_at: string
}

export async function fetchQueueStats(): Promise<{ queues: string[]; counts: QueueCounts }> {
  const res = await apiFetch('/api/ops/queues')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load queue stats')
  return data
}

export async function fetchFailedJobs(limit = 50): Promise<FailedQueueJob[]> {
  const res = await apiFetch(`/api/ops/queues/failed?limit=${limit}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load failed jobs')
  return data.jobs as FailedQueueJob[]
}

export async function retryFailedJob(queueName: string, jobId: string): Promise<void> {
  const res = await apiFetch(`/api/ops/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to retry job')
}

export async function fetchFailedDeliveries(limit = 50): Promise<FailedDelivery[]> {
  const res = await apiFetch(`/api/ops/deliveries/failed?limit=${limit}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to load failed deliveries')
  return data.deliveries as FailedDelivery[]
}

export async function retryFailedDelivery(deliveryId: string): Promise<void> {
  const res = await apiFetch(`/api/ops/deliveries/${deliveryId}/retry`, { method: 'POST' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to retry delivery')
}
