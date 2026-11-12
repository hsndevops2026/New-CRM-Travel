import { apiJson } from './api'

export type DeadlineKind = 'free_cancellation' | 'option_expiry' | 'supplier_payment' | 'ticketing' | 'other'

export type Deadline = {
  id: string
  lead_id: string
  kind: DeadlineKind
  label: string
  supplier: string | null
  due_at: string
  status: 'open' | 'done' | 'dismissed'
  source: 'manual' | 'quote'
  destination?: string | null
  customer?: string | null
}

export type BoardTrip = {
  id: string
  destination: string | null
  travel_date: string | null
  return_date: string | null
  adults_count: number | null
  children_count: number | null
  customer: string | null
}

export type Board = { from: string; to: string; trips: BoardTrip[]; deadlines: Deadline[] }

export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  free_cancellation: 'Free cancellation ends',
  option_expiry: 'Flight option expires',
  supplier_payment: 'Pay the supplier',
  ticketing: 'Issue tickets',
  other: 'Other',
}

export const fetchDeadlines = async (leadId: string) => (await apiJson<{ deadlines: Deadline[] }>(`/api/leads/${leadId}/deadlines`)).deadlines
export const addDeadline = async (leadId: string, input: { kind: DeadlineKind; label: string; due_at: string; supplier?: string }) =>
  (await apiJson<{ deadline: Deadline }>(`/api/leads/${leadId}/deadlines`, { method: 'POST', body: JSON.stringify(input) })).deadline
export const updateDeadline = async (leadId: string, id: string, input: Partial<Pick<Deadline, 'status' | 'due_at' | 'label'>>) =>
  (await apiJson<{ deadline: Deadline }>(`/api/leads/${leadId}/deadlines/${id}`, { method: 'PATCH', body: JSON.stringify(input) })).deadline
export const deleteDeadline = (leadId: string, id: string) => apiJson(`/api/leads/${leadId}/deadlines/${id}`, { method: 'DELETE' })
export const fetchBoard = (from: string, to: string) => apiJson<Board>(`/api/operations/board?from=${from}&to=${to}`)

/** yyyy-mm-dd in local time. */
export function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** What each day of the board holds: departures, returns, people away, deadlines. */
export function boardDays(board: Board) {
  const days: { day: string; departures: BoardTrip[]; returns: BoardTrip[]; away: BoardTrip[]; deadlines: Deadline[] }[] = []
  for (let day = board.from; day <= board.to; day = addDays(day, 1)) {
    days.push({
      day,
      departures: board.trips.filter((t) => t.travel_date === day),
      returns: board.trips.filter((t) => t.return_date === day),
      away: board.trips.filter((t) => t.travel_date && t.return_date && t.travel_date < day && t.return_date > day),
      deadlines: board.deadlines.filter((d) => dayKey(new Date(d.due_at)) === day),
    })
  }
  return days
}
