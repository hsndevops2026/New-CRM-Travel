import type { QuoteStep } from './lifecycle'
import { versionStatusLabel } from './versionView'

/**
 * Small status chips on the lead workspace tabs ("14" options, "1/3 replied", "v1 sent").
 * They answer "is there anything to do in that step?" without opening it.
 */
export type TabBadge = { label: string; tone: 'neutral' | 'warning' | 'success' }
export type TabBadges = Partial<Record<QuoteStep, TabBadge>>

type Inputs = {
  /** Options the comparison endpoint returned (flights, hotels, packages, dealer offers). */
  optionCount: number | null
  /** Dealer RFQs sent for this lead. */
  requestIds: string[] | null
  /** Request ids of the responses that came back. */
  respondedRequestIds: string[] | null
  /** Quote versions locked for this lead, newest first. */
  versions: Array<{ version_number: number; status: string }> | null
}

export function buildTabBadges(input: Inputs): TabBadges {
  const badges: TabBadges = {}

  if (input.optionCount != null && input.optionCount > 0) {
    badges.source = { label: String(input.optionCount), tone: 'neutral' }
  }

  if (input.requestIds && input.requestIds.length > 0) {
    const asked = new Set(input.requestIds)
    const replied = new Set((input.respondedRequestIds || []).filter((id) => asked.has(id)))
    badges.dealers = {
      label: `${replied.size}/${asked.size} replied`,
      tone: replied.size >= asked.size ? 'success' : 'warning',
    }
  }

  const latest = input.versions?.[0]
  if (latest) {
    badges.send = {
      label: `v${latest.version_number} ${versionStatusLabel(latest.status)}`,
      tone: latest.status === 'accepted' ? 'success' : latest.status === 'revoked' ? 'warning' : 'neutral',
    }
  }

  return badges
}
