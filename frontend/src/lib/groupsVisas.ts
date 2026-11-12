import { apiFetch, apiJson } from './api'

export type VisaStatus = 'unknown' | 'not_needed' | 'needed' | 'documents' | 'applied' | 'approved' | 'rejected'

export const VISA_STATUS_LABEL: Record<VisaStatus, string> = {
  unknown: 'Not checked',
  not_needed: 'No visa needed',
  needed: 'Visa needed',
  documents: 'Collecting documents',
  applied: 'Applied',
  approved: 'Approved',
  rejected: 'Rejected',
}

export type VisaRule = { destination: string; requires_visa: boolean; documents: string | null; processing_days: number | null }
export type VisaTraveller = {
  id: string
  full_name: string
  is_child: boolean
  nationality: string | null
  visa_status: VisaStatus
  visa_notes: string | null
  visa_applied_at: string | null
  visa_expected_at: string | null
}
export type LeadVisas = { destination: string | null; travel_date: string | null; rule: VisaRule | null; travellers: VisaTraveller[] }

export const fetchVisas = (leadId: string) => apiJson<LeadVisas>(`/api/leads/${leadId}/visas`)
export const updateVisa = async (leadId: string, travellerId: string, input: Partial<VisaTraveller>) =>
  (await apiJson<{ traveller: VisaTraveller }>(`/api/leads/${leadId}/visas/${travellerId}`, { method: 'PATCH', body: JSON.stringify(input) })).traveller
export const saveVisaRule = async (input: VisaRule) =>
  (await apiJson<{ rule: VisaRule }>('/api/visa-rules', { method: 'PUT', body: JSON.stringify(input) })).rule

export type GroupTrip = {
  id: string
  title: string
  destination: string | null
  travel_date: string | null
  return_date: string | null
  seats_total: number
  seats_used: number
  seats_left?: number
  price_per_person: string | number | null
  currency: string
  notes: string | null
  status: 'open' | 'closed' | 'cancelled'
  bookings?: { id: string; phone: string; adults_count: number | null; children_count: number | null; lifecycle_status: string | null; group_room: string | null; customer: string | null }[]
  travellers?: { id: string; lead_id: string; full_name: string; is_child: boolean; date_of_birth: string | null; nationality: string | null; passport_number: string | null; passport_expiry: string | null; visa_status: VisaStatus }[]
}

export const fetchGroupTrips = async (all = false) => (await apiJson<{ groups: GroupTrip[] }>(`/api/group-trips${all ? '?all=1' : ''}`)).groups
export const fetchGroupTrip = async (id: string) => (await apiJson<{ group: GroupTrip }>(`/api/group-trips/${id}`)).group
export const createGroupTrip = async (input: Partial<GroupTrip>) =>
  (await apiJson<{ group: GroupTrip }>('/api/group-trips', { method: 'POST', body: JSON.stringify(input) })).group
export const updateGroupTrip = async (id: string, input: Partial<GroupTrip>) =>
  (await apiJson<{ group: GroupTrip }>(`/api/group-trips/${id}`, { method: 'PATCH', body: JSON.stringify(input) })).group
export const setBookingRoom = (groupId: string, leadId: string, room: string) =>
  apiJson(`/api/group-trips/${groupId}/bookings/${leadId}`, { method: 'PATCH', body: JSON.stringify({ room }) })
export const setLeadGroup = (leadId: string, groupId: string | null) =>
  apiJson(`/api/leads/${leadId}/group`, { method: 'PUT', body: JSON.stringify({ group_trip_id: groupId }) })

/** Downloads the rooming list (the request needs the sign-in header, so no plain link). */
export async function downloadRoomingList(groupId: string, title: string) {
  const res = await apiFetch(`/api/group-trips/${groupId}/rooming.csv`)
  if (!res.ok) throw new Error('Could not download the list')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'rooming-list'}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 0–100, for the seats bar. */
export const seatsPercent = (g: Pick<GroupTrip, 'seats_total' | 'seats_used'>) =>
  g.seats_total > 0 ? Math.min(100, Math.round((g.seats_used / g.seats_total) * 100)) : 0
