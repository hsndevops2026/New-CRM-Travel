import { apiJson } from './api'
import type { Range } from './reports'

export type BookingCost = { id: string; supplier: string | null; description: string; amount: number; currency: string; paid: boolean }
export type CostSummary = { price: number | null; currency: string | null; costs: number; profit: number | null; margin_pct: number | null; other_currency: boolean }
export type CostList = { costs: BookingCost[]; summary: CostSummary }

export type ProfitRow = {
  id: string; destination: string | null; travel_date: string | null; customer: string | null
  price: number; currency: string; cost: number; cost_source: 'actual' | 'quoted'; profit: number; margin_pct: number | null; employee: string | null
}
export type ProfitReport = { bookings: ProfitRow[]; totals: { currency: string; sales: number; cost: number; profit: number; bookings: number }[] }

export type SupplierRow = {
  id: string; name: string; company: string | null; requests: number; answered: number
  answer_rate: number | null; median_minutes: number | null; picked: number; picked_and_booked: number
}

export type TargetRow = {
  id: string; email: string; role: string; currency: string; target_amount: number | null; commission_pct: number
  bookings: number; sales: number; profit: number; progress_pct: number | null; commission: number; other_currency_bookings: number
}

const qs = (r: Range) => new URLSearchParams(r).toString()

export const fetchCosts = (leadId: string) => apiJson<CostList>(`/api/leads/${leadId}/costs`)
export const addCost = (leadId: string, input: { description: string; amount: number; currency: string; supplier?: string; paid?: boolean }) =>
  apiJson<CostList>(`/api/leads/${leadId}/costs`, { method: 'POST', body: JSON.stringify(input) })
export const setCostPaid = (leadId: string, id: string, paid: boolean) =>
  apiJson<CostList>(`/api/leads/${leadId}/costs/${id}`, { method: 'PATCH', body: JSON.stringify({ paid }) })
export const removeCost = (leadId: string, id: string) => apiJson<CostList>(`/api/leads/${leadId}/costs/${id}`, { method: 'DELETE' })

export const fetchProfitReport = (r: Range) => apiJson<ProfitReport>(`/api/reports/profit?${qs(r)}`)
export const fetchSupplierReport = async (r: Range) => (await apiJson<{ suppliers: SupplierRow[] }>(`/api/reports/suppliers?${qs(r)}`)).suppliers
export const fetchTargets = (month: string) => apiJson<{ month: string; people: TargetRow[] }>(`/api/targets?month=${month}`)
export const saveTarget = (input: { admin_id: string; month: string; target_amount: number; currency: string; commission_pct: number }) =>
  apiJson<{ month: string; people: TargetRow[] }>('/api/targets', { method: 'PUT', body: JSON.stringify(input) })

export function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency || ''} ${Math.round(amount)}`
  }
}
