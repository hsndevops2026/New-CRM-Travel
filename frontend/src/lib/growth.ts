import { apiJson } from './api'
import type { AgencySettings } from './agencySettings'

export type PublicOffer = {
  id: string
  title: string
  quote_type: string
  destination: string | null
  origin: string | null
  description: string | null
  cover_image_url: string | null
  currency: string
  price: number | null
  nights: number | null
  travel_date: string | null
  availability_mode: 'fixed' | 'period'
  available_months: number[]
}

export type PastCustomer = {
  contact_id: string | null
  name: string | null
  phone: string
  trips: number
  last_destination: string | null
  last_travel_date: string | null
  last_offer_at: string | null
}

export type TravelHistory = {
  trips: { id: string; destination: string | null; travel_date: string | null; return_date: string | null; price: number | null; currency: string | null }[]
  totals: { currency: string; amount: number }[]
}

// ── public ──
export async function fetchPublicOffers(): Promise<{ offers: PublicOffer[]; agency: AgencySettings }> {
  const res = await fetch('/api/public/offers')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load offers')
  return data
}

export async function requestPublicOffer(id: string, input: Record<string, string | number>) {
  const res = await fetch(`/api/public/offers/${id}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not send. Please try again.')
}

// ── staff ──
export const setPackagePublic = (id: string, isPublic: boolean) =>
  apiJson<{ id: string; is_public: boolean }>(`/api/predefined-quotes/${id}/public`, { method: 'PATCH', body: JSON.stringify({ is_public: isPublic }) })

export async function fetchPastCustomers(params: { month?: number | ''; destination?: string }) {
  const q = new URLSearchParams()
  if (params.month) q.set('month', String(params.month))
  if (params.destination) q.set('destination', params.destination)
  return (await apiJson<{ customers: PastCustomer[] }>(`/api/past-customers?${q}`)).customers
}

export const sendPastCustomerOffer = (input: { phone: string; text: string; offer_id?: string }) =>
  apiJson<{ sent: boolean }>('/api/past-customers/send', { method: 'POST', body: JSON.stringify(input) })

export const fetchTravelHistory = (contactId: string) => apiJson<TravelHistory>(`/api/contacts/${contactId}/travel-history`)

/** The suggested message for a past customer; staff edit it before sending. */
export function offerTemplate(c: Pick<PastCustomer, 'name' | 'last_destination'>, offersUrl: string, lang: 'ar' | 'en') {
  const name = (c.name || '').trim().split(/\s+/)[0]
  if (lang === 'en') {
    return `Hi${name ? ` ${name}` : ''}! ${c.last_destination ? `Hope you have good memories of ${c.last_destination}. ` : ''}We have new offers for this season, take a look: ${offersUrl}\nReply here if anything catches your eye.`
  }
  return `مرحباً${name ? ` ${name}` : ''}! ${c.last_destination ? `نتمنى أن تكون رحلتك إلى ${c.last_destination} قد تركت لك ذكريات جميلة. ` : ''}لدينا عروض جديدة لهذا الموسم، تفضّل بالاطلاع عليها: ${offersUrl}\nإذا أعجبك شيء، اكتب لنا هنا.`
}
