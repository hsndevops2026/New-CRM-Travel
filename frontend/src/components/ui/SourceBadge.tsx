import { t as translate, useI18n } from '../../lib/i18n'
import { Hotel, Package, Plane, Sparkles, Store } from 'lucide-react'
import StatusBadge from './StatusBadge'

const ICON = { strokeWidth: 1.8 }

/** Where a quote option came from. */
export type OptionSource = 'dealer' | 'flight_api' | 'hotel_api' | 'package' | 'market'

const SOURCES: Record<OptionSource, Parameters<typeof StatusBadge>[0]> = {
  dealer: { label: 'Dealer', tone: 'dealer', icon: <Store {...ICON} /> },
  flight_api: { label: 'Flight API', tone: 'info', icon: <Plane {...ICON} /> },
  hotel_api: { label: 'Hotel API', tone: 'info', icon: <Hotel {...ICON} /> },
  package: { label: 'Package', tone: 'success', icon: <Package {...ICON} /> },
  market: { label: 'Market ref.', tone: 'neutral' },
}

export function SourceBadge({ source }: { source: OptionSource }) {
  useI18n()
  return <StatusBadge {...SOURCES[source]} />
}

/** Signals an option can carry in the comparison: cheapest, best value, or an AI recommendation. */
export function HighlightBadge({
  kind,
  rank,
}: {
  kind: 'lowest' | 'best_value' | 'ai_pick'
  rank?: number
}) {
  useI18n()
  if (kind === 'lowest') return <StatusBadge label={translate("Lowest{value0}", { value0: translate(String(rank ? ` #${rank}` : '')) })} tone="ink" />
  if (kind === 'best_value') return <StatusBadge label={translate("Best value")} tone="outlineSuccess" />
  return <StatusBadge label={translate("AI pick")} tone="outlineDealer" icon={<Sparkles {...ICON} />} />
}
