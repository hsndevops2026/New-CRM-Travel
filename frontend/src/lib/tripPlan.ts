import { apiFetch } from './api'

export type TripPlanItem = {
  id: string
  lead_id: string
  day_number: number | null
  position: number
  title: string
  details: string
  kind: 'activity' | 'trip_idea' | 'package' | 'note'
  source: 'system' | 'general'
  package_id: string | null
  price: number | null
  currency: string | null
}

export type NewTripPlanItem = {
  title: string
  details?: string
  kind?: TripPlanItem['kind']
  source?: 'system' | 'general'
  package_id?: string | null
  day_number?: number | null
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || fallback)
  return data as T
}

const base = (leadId: string) => `/api/leads/${encodeURIComponent(leadId)}/trip-plan`

export async function fetchTripPlan(leadId: string) {
  return json<{ lead: { id: string; destination: string; customer_name: string; language?: 'ar' | 'en' }; items: TripPlanItem[] }>(
    await apiFetch(base(leadId)),
    'Failed to load the trip program',
  )
}

export async function addTripPlanItems(leadId: string, items: NewTripPlanItem[]) {
  const data = await json<{ items: TripPlanItem[] }>(
    await apiFetch(`${base(leadId)}/items`, { method: 'POST', body: JSON.stringify({ items }) }),
    'Failed to add to the trip program',
  )
  return data.items
}

export async function updateTripPlanItem(leadId: string, itemId: string, patch: Partial<NewTripPlanItem>) {
  const data = await json<{ items: TripPlanItem[] }>(
    await apiFetch(`${base(leadId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    'Failed to update the trip program',
  )
  return data.items
}

export async function deleteTripPlanItem(leadId: string, itemId: string) {
  const data = await json<{ items: TripPlanItem[] }>(
    await apiFetch(`${base(leadId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    'Failed to delete from the trip program',
  )
  return data.items
}

export async function previewTripPlan(leadId: string, lang: 'ar' | 'en') {
  const data = await json<{ text: string }>(
    await apiFetch(`${base(leadId)}/preview`, { method: 'POST', body: JSON.stringify({ lang }) }),
    'Failed to prepare the message',
  )
  return data.text
}

export async function sendTripPlan(leadId: string, text: string) {
  return json<{ message: unknown }>(
    await apiFetch(`${base(leadId)}/send`, { method: 'POST', body: JSON.stringify({ text }) }),
    'Failed to send the trip program',
  )
}
