/** One-line facts about a lead, as the workspace header shows them. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

/** "12–18 Dec 2026", "28 Dec – 3 Jan 2027", "28 Dec 2026 – 3 Jan 2027"; "—" when there is no start. */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = parts(start)
  const b = parts(end)
  if (!a) return '—'
  const one = (p: { y: number; m: number; d: number }) => `${p.d} ${MONTHS[p.m]} ${p.y}`
  if (!b || (a.y === b.y && a.m === b.m && a.d === b.d)) return one(a)
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m]} ${a.y}`
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]} ${b.y}`
  return `${one(a)} – ${one(b)}`
}

export function nightsLabel(nights: number | null | undefined): string | null {
  const n = Number(nights)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${n} night${n === 1 ? '' : 's'}`
}

/** "2 adults, 1 child (8)" · "1 adult" · "2 adults, 2 children (8, 5)". */
export function travelersLabel(adults: number, children: number, childAges?: number[] | null): string {
  const a = Math.max(0, Number(adults) || 0)
  const c = Math.max(0, Number(children) || 0)
  const bits: string[] = []
  if (a > 0 || c === 0) bits.push(`${a} adult${a === 1 ? '' : 's'}`)
  if (c > 0) {
    const ages = (childAges || []).filter((age) => Number.isFinite(age))
    bits.push(`${c} ${c === 1 ? 'child' : 'children'}${ages.length ? ` (${ages.join(', ')})` : ''}`)
  }
  return bits.join(', ')
}

/** The lead type as a customer-facing noun: "Flight + Hotel package", "Hotel", "Flight". */
export function leadTypeLabel(type: string | null | undefined): string {
  if (type === 'package') return 'Flight + Hotel package'
  if (type === 'flight') return 'Flight'
  if (type === 'hotel') return 'Hotel'
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Lead'
}

/** Breadcrumb tail: a short, stable reference for the lead. */
export function leadRef(id: string): string {
  return `L-${String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase()}`
}
