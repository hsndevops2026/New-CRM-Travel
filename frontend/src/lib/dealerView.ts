import type { Dealer, DealerRequest } from './dealers'

export const SERVICE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'packages', label: 'Packages' },
  { id: 'flights', label: 'Flights' },
  { id: 'hotels', label: 'Hotels only' },
  { id: 'transfers', label: 'Transfers & tours' },
]

/** A stored service id as words; an id we don't know (typed in by hand elsewhere) shows as-is. */
export function serviceLabel(id: string): string {
  return SERVICE_OPTIONS.find((s) => s.id === id)?.label ?? id
}

export type DealerStats = { rfqs: number; replied: number; replyRate: number | null; lastAt: string | null }

/** How a dealer has performed across every lead: RFQs sent, how many were answered, and when. */
export function dealerStats(dealerId: string, requests: DealerRequest[]): DealerStats {
  const mine = requests.filter((r) => r.dealer_id === dealerId)
  const replied = mine.filter((r) => r.status === 'replied').length
  const last = mine
    .map((r) => r.sent_at || r.created_at)
    .filter(Boolean)
    .sort()
    .pop()
  return {
    rfqs: mine.length,
    replied,
    replyRate: mine.length ? Math.round((replied / mine.length) * 100) : null,
    lastAt: last ?? null,
  }
}

/** The most-used destinations across dealers, for the filter pills. */
export function destinationOptions(dealers: Dealer[], max = 4): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const dealer of dealers) {
    for (const raw of dealer.destinations ?? []) {
      const label = String(raw).trim()
      if (!label) continue
      const key = label.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.n += 1
      else counts.set(key, { label, n: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, max)
    .map((e) => e.label)
}

export const GROUPS_ONLY = '__groups__'

export function filterDealers(dealers: Dealer[], opts: { query: string; destination: string }): Dealer[] {
  const term = opts.query.trim().toLowerCase()
  return dealers.filter((d) => {
    if (opts.destination === GROUPS_ONLY && !d.whatsapp_group_id) return false
    if (
      opts.destination !== 'all' &&
      opts.destination !== GROUPS_ONLY &&
      !(d.destinations ?? []).some((x) => x.toLowerCase() === opts.destination.toLowerCase())
    ) {
      return false
    }
    if (!term) return true
    return [d.name, d.phone, d.company ?? '', ...(d.destinations ?? [])].join(' ').toLowerCase().includes(term)
  })
}

export function dealerInitials(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
