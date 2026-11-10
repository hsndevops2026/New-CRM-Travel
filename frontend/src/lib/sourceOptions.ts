import type { ComparisonItem, QuoteItem } from './quoteDrafts'

/** Option groups on the lead's Source step. */
export type OptionGroups = {
  packages: ComparisonItem[]
  flights: ComparisonItem[]
  hotels: ComparisonItem[]
  dealers: ComparisonItem[]
}

export function groupOptions(items: ComparisonItem[]): OptionGroups {
  return {
    packages: items.filter((i) => i.source_type === 'predefined'),
    flights: items.filter((i) => i.source_type === 'flight_api'),
    hotels: items.filter((i) => i.source_type === 'hotel_api'),
    dealers: items.filter((i) => i.source_type === 'dealer'),
  }
}

export const optionKey = (item: { source_type: string; source_id: string }) =>
  `${item.source_type}:${item.source_id}`

type DraftItemInput = Omit<QuoteItem, 'id' | 'quote_draft_id' | 'created_at' | 'item_order'>

const fromComparison = (item: ComparisonItem): DraftItemInput => ({
  source_type: item.source_type,
  source_id: item.source_id,
  label: item.label,
  description: item.description,
  net_cost: item.net_cost,
  currency: item.currency,
  meta: item.meta,
  quantity: 1,
})

const fromDraft = (item: QuoteItem): DraftItemInput => ({
  source_type: item.source_type,
  source_id: item.source_id,
  label: item.label,
  description: item.description,
  net_cost: item.net_cost,
  currency: item.currency,
  meta: item.meta,
  quantity: item.quantity,
})

/**
 * The draft's item list after ticking or unticking one option. Everything else already in the
 * draft keeps its quantity — adding a hotel must not reset the flight the agent already priced.
 */
export function draftItemsAfterToggle(
  draftItems: QuoteItem[],
  item: ComparisonItem,
  selected: boolean,
): DraftItemInput[] {
  const key = optionKey(item)
  const kept = draftItems.filter((d) => optionKey(d) !== key).map(fromDraft)
  return selected ? [...kept, fromComparison(item)] : kept
}

/** "2 flights · 2 hotels · + 1 dealer offer" — what the compare bar says is in the quote. */
export function selectionSummary(items: Array<Pick<QuoteItem, 'source_type'>>): string {
  const count = (type: string) => items.filter((i) => i.source_type === type).length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const parts: string[] = []
  if (count('flight_api')) parts.push(plural(count('flight_api'), 'flight'))
  if (count('hotel_api')) parts.push(plural(count('hotel_api'), 'hotel'))
  if (count('predefined')) parts.push(plural(count('predefined'), 'package'))
  const dealers = count('dealer')
  if (dealers) parts.push(`${parts.length ? '+ ' : ''}${plural(dealers, 'dealer offer')}`)
  return parts.join(' · ')
}

/** Id of the cheapest priced option, only when there is more than one to compare. */
export function lowestPricedId(items: ComparisonItem[]): string | null {
  const priced = items.filter((i) => i.net_cost != null)
  if (priced.length < 2) return null
  return priced.reduce((best, i) => ((i.net_cost as number) < (best.net_cost as number) ? i : best)).id
}

/**
 * A package already bundles flights and a hotel, so ticking one alongside separate flights or
 * hotels double counts them. Dealer offers can be bundles too, but their contents aren't known
 * here, so only library packages are checked.
 */
export function hasPackageConflict(items: Array<Pick<ComparisonItem, 'source_type'>>): boolean {
  const hasPackage = items.some((i) => i.source_type === 'predefined')
  const hasSeparate = items.some((i) => i.source_type === 'flight_api' || i.source_type === 'hotel_api')
  return hasPackage && hasSeparate
}

/** Dealer rows are labelled "Best · …" / "AI pick · …" server-side; the badge now says that. */
export function plainOptionLabel(label: string): string {
  return label.replace(/^(Best|AI pick) · /, '')
}
