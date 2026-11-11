import { apiFetch } from './api'

export type Range = { from: string; to: string }

export type PipelineReport = {
  range: Range
  new_leads: number
  funnel: Array<{ stage: 'new' | 'sent' | 'accepted' | 'booked'; count: number; rate: number | null }>
  lost: number
  by_source: Array<{ source: string; count: number }>
  current_pipeline: Array<{ status: string; count: number }>
  quotes_sent: number
  quotes_accepted: number
  accepted_value: Array<{ currency: string; total: number; count: number }>
}

export type EmployeeRow = {
  id: string
  email: string
  role: string
  leads_assigned: number
  open_leads: number
  quotes_sent: number
  quotes_accepted: number
  accepted_value: number | null
  customer_replies: number
  avg_first_reply_minutes: number | null
  first_reply_samples: number
}

type LeadRef = { lead_id: string; customer_name: string; phone: string; destination: string; assigned_to: string | null }

export type OverdueReport = {
  generated_at: string
  thresholds: { reply_hours: number; quote_days: number; stale_days: number }
  overdue_reminders: Array<{ id: string; text: string; remind_at: string; customer_name: string; phone: string; contact_id: string }>
  unanswered_customers: Array<LeadRef & { waiting_since: string; last_message: string }>
  quotes_without_reply: Array<LeadRef & { sent_at: string }>
  stalled_requests: Array<LeadRef & { lifecycle_status: string; last_activity: string }>
}

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to build the report')
  return data as T
}

const qs = (range: Range) => `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`

export const fetchPipelineReport = (range: Range) => get<PipelineReport>(`/api/reports/pipeline?${qs(range)}`)
export const fetchEmployeeReport = (range: Range) => get<{ employees: EmployeeRow[] }>(`/api/reports/employees?${qs(range)}`)
export const fetchOverdueReport = () => get<OverdueReport>('/api/reports/overdue')

export type Preset = 'today' | '7d' | '30d' | 'month' | 'custom'

/** Ranges are [from, to): "today" is midnight to now in the browser's time zone. */
export function presetRange(preset: Exclude<Preset, 'custom'>, now = new Date()): Range {
  const to = now.toISOString()
  const start = new Date(now)
  if (preset === 'today') start.setHours(0, 0, 0, 0)
  else if (preset === '7d') start.setTime(now.getTime() - 7 * 86_400_000)
  else if (preset === '30d') start.setTime(now.getTime() - 30 * 86_400_000)
  else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return { from: start.toISOString(), to }
}

/** Custom range from two yyyy-mm-dd inputs; the end day is included. */
export function customRange(fromDay: string, toDay: string): Range | null {
  const from = new Date(`${fromDay}T00:00:00`)
  const to = new Date(`${toDay}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  to.setDate(to.getDate() + 1)
  return from < to ? { from: from.toISOString(), to: to.toISOString() } : null
}

function cell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV with a BOM so Excel opens Arabic text correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
