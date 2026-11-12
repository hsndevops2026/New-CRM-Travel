import { apiJson } from './api'

export type PassportIssue = 'expired' | 'expires_during_trip' | 'under_six_months' | 'missing_passport' | 'missing_birth_date'

export type Traveller = {
  id?: string
  full_name: string
  is_child: boolean
  date_of_birth: string | null
  nationality: string | null
  passport_number: string | null
  passport_expiry: string | null
  issues?: PassportIssue[]
}

export type TravellerList = {
  travellers: Traveller[]
  expected: { adults: number; children: number }
  trip: { travel_date: string | null; return_date: string | null }
  link: { url: string; expires_at: string; submitted_at: string | null } | null
}

export type TravellerForm = {
  destination: string | null
  trip: { travel_date: string | null; return_date: string | null }
  expected: { adults: number; children: number }
  travellers: Traveller[]
  submitted_at: string | null
}

export const ISSUE_TEXT: Record<PassportIssue, string> = {
  expired: 'Passport expired before the trip',
  expires_during_trip: 'Passport expires during the trip',
  under_six_months: 'Passport valid less than 6 months after the return',
  missing_passport: 'Passport details missing',
  missing_birth_date: 'Date of birth missing',
}

export const emptyTraveller = (isChild = false): Traveller => ({
  full_name: '', is_child: isChild, date_of_birth: null, nationality: null, passport_number: null, passport_expiry: null,
})

/** Rows to show: what's saved, padded to the number of travellers on the lead. */
export function padTravellers(list: Traveller[], expected: { adults: number; children: number }): Traveller[] {
  const rows = [...list]
  const adults = rows.filter((t) => !t.is_child).length
  const children = rows.filter((t) => t.is_child).length
  for (let i = adults; i < expected.adults; i += 1) rows.push(emptyTraveller(false))
  for (let i = children; i < expected.children; i += 1) rows.push(emptyTraveller(true))
  return rows.length ? rows : [emptyTraveller(false)]
}

/** Rows with a name are saved; blank padding rows are dropped. */
export const filledTravellers = (rows: Traveller[]) =>
  rows.filter((t) => t.full_name.trim()).map((t) => ({
    full_name: t.full_name,
    is_child: t.is_child,
    date_of_birth: t.date_of_birth,
    nationality: t.nationality,
    passport_number: t.passport_number,
    passport_expiry: t.passport_expiry,
  }))

export async function fetchTravellers(leadId: string) {
  return apiJson<TravellerList>(`/api/leads/${leadId}/travellers`)
}

export async function saveTravellers(leadId: string, travellers: Traveller[]) {
  return apiJson<TravellerList>(`/api/leads/${leadId}/travellers`, { method: 'PUT', body: JSON.stringify({ travellers: filledTravellers(travellers) }) })
}

export async function makeTravellerLink(leadId: string, send: boolean) {
  return apiJson<{ url: string }>(`/api/leads/${leadId}/travellers/link`, { method: 'POST', body: JSON.stringify({ send }) })
}

// ── public (no sign-in) ──

export async function fetchTravellerForm(token: string): Promise<TravellerForm> {
  const res = await fetch(`/api/public/travellers/${encodeURIComponent(token)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'This link has expired. Please ask us for a new one.')
  return data as TravellerForm
}

export async function submitTravellerForm(token: string, travellers: Traveller[]) {
  const res = await fetch(`/api/public/travellers/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ travellers: filledTravellers(travellers) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not save. Please try again.')
  return data as { saved: number; problems: number }
}
