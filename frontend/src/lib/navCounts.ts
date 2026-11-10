import { apiJson } from './api'

export type NavCounts = {
  /** Leads still being worked. */
  leads_open: number
  /** Customer conversations waiting for a reply. */
  inbox_awaiting: number
  /** Staff sign-ups waiting for approval — null unless you are an admin. */
  approvals_pending: number | null
  /** Undone reminders due today or overdue. */
  reminders_open: number
}

export function fetchNavCounts(signal?: AbortSignal) {
  return apiJson<NavCounts>('/api/nav/counts', { signal })
}
