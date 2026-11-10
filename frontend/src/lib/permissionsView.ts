export type ApprovalStatus = 'pending' | 'approved' | 'revoked'

export type StaffUser = {
  id: string
  email: string
  approval_status: ApprovalStatus
  lead_credits: number
  leads_used: number
  created_at: string
}

export type StaffTab = 'pending' | 'approved' | 'revoked'

export const STAFF_TABS: Array<{ id: StaffTab; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'revoked', label: 'Blocked / rejected' },
]

export function staffCounts(users: StaffUser[]): Record<StaffTab, number> {
  const count = (status: ApprovalStatus) => users.filter((u) => u.approval_status === status).length
  return { pending: count('pending'), approved: count('approved'), revoked: count('revoked') }
}

/** The tab to open on: pending requests need a decision, so they come first when there are any. */
export function defaultStaffTab(users: StaffUser[]): StaffTab {
  const counts = staffCounts(users)
  if (counts.pending > 0) return 'pending'
  return counts.approved > 0 ? 'approved' : 'pending'
}

/** Users on one tab matching the search, newest request first. */
export function visibleStaff(users: StaffUser[], tab: StaffTab, query: string): StaffUser[] {
  const term = query.trim().toLowerCase()
  return users
    .filter((u) => u.approval_status === tab && (!term || u.email.toLowerCase().includes(term)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

export type Credits = { remaining: number; used: number; total: number; pct: number }

/** Credits left, never negative, and how much of the allowance is spent (for the meter). */
export function creditSummary(user: Pick<StaffUser, 'lead_credits' | 'leads_used'>): Credits {
  const total = Math.max(0, Number(user.lead_credits) || 0)
  const used = Math.max(0, Number(user.leads_used) || 0)
  return {
    remaining: Math.max(0, total - used),
    used,
    total,
    pct: total === 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / total) * 100)),
  }
}

/** A whole number of credits of at least 1, or null. */
export function parseCreditAmount(raw: string | undefined): number | null {
  const amount = Number(raw)
  return Number.isSafeInteger(amount) && amount >= 1 ? amount : null
}
