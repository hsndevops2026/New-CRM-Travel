import type { LifecycleStatus } from './leads'

/** Names from the design system, used on badges and everywhere a stage is spoken of. */
export const LIFECYCLE_LABELS: Record<string, string> = {
  intake: 'Intake',
  sourcing: 'Sourcing',
  awaiting_dealers: 'Awaiting dealers',
  comparing: 'Comparing',
  drafting: 'Drafting',
  ready_to_send: 'Ready to send',
  sent: 'Sent',
  accepted: 'Accepted',
  booked: 'Booked',
  lost: 'Lost',
  archived: 'Archived',
}

/** Shorter names for the stepper, where nine stages share one row. */
export const LIFECYCLE_STEP_LABELS: Record<string, string> = {
  ...LIFECYCLE_LABELS,
  ready_to_send: 'Ready',
}

/** Every stage of a lead's life, in order. Lost and archived sit outside this path. */
export const HAPPY_PATH: LifecycleStatus[] = [
  'intake',
  'sourcing',
  'awaiting_dealers',
  'comparing',
  'drafting',
  'ready_to_send',
  'sent',
  'accepted',
  'booked',
]

/** Board columns: finished deals (booked) leave the board; they stay in the table. */
export const BOARD_STAGES: LifecycleStatus[] = HAPPY_PATH.filter((stage) => stage !== 'booked')

export const CLOSED_STAGES: LifecycleStatus[] = ['lost', 'archived']

export type QuoteStep = 'source' | 'dealers' | 'market' | 'build' | 'send'

const TAB_TO_STEP: Record<string, QuoteStep> = {
  overview: 'source',
  sourcing: 'source',
  chat: 'source',
  dealers: 'dealers',
  compare: 'build',
  market: 'market',
  send: 'send',
  source: 'source',
  build: 'build',
}

export function lifecycleLabel(status: string | null | undefined) {
  if (!status) return LIFECYCLE_LABELS.intake
  return LIFECYCLE_LABELS[status] || status.replace(/_/g, ' ')
}

/** The stage to show on the path. Anything off the path (lost, archived, unknown) is intake. */
export function pathStatus(status: string | null | undefined): LifecycleStatus {
  if (status && HAPPY_PATH.includes(status as LifecycleStatus)) return status as LifecycleStatus
  return 'intake'
}

export function stepFromLifecycle(status: string | null | undefined): QuoteStep {
  switch (status) {
    case 'awaiting_dealers':
      return 'dealers'
    case 'comparing':
    case 'drafting':
      return 'build'
    case 'ready_to_send':
    case 'sent':
    case 'accepted':
    case 'booked':
      return 'send'
    default:
      return 'source'
  }
}

export function primaryCtaForLifecycle(status: string | null | undefined): {
  label: string
  step: QuoteStep
} {
  switch (status) {
    case 'awaiting_dealers':
      return { label: 'Request dealers', step: 'dealers' }
    case 'comparing':
    case 'drafting':
      return { label: 'Compare quotes', step: 'build' }
    case 'ready_to_send':
    case 'sent':
    case 'accepted':
      return { label: 'Send quote', step: 'send' }
    case 'booked':
      return { label: 'View quote', step: 'send' }
    case 'lost':
    case 'archived':
      return { label: 'View quote', step: 'send' }
    default:
      return { label: 'Retry sourcing', step: 'source' }
  }
}

/**
 * What a lead is waiting for, as one line (the board card's "next action").
 * `blocker` is true when something has gone wrong and needs a person — shown in red.
 */
export function nextActionFor(
  status: string | null | undefined,
  quoteStatus?: string | null,
): { text: string; blocker: boolean } {
  if (quoteStatus === 'error') return { text: 'Search failed · retry sourcing', blocker: true }
  switch (status) {
    case 'sourcing':
      return { text: quoteStatus === 'processing' ? 'Fetching options…' : 'Sourcing options', blocker: false }
    case 'awaiting_dealers':
      return { text: 'Awaiting dealer replies', blocker: false }
    case 'comparing':
      return { text: 'Build quote', blocker: false }
    case 'drafting':
      return { text: 'Create version', blocker: false }
    case 'ready_to_send':
      return { text: 'Send quote', blocker: false }
    case 'sent':
      return { text: 'Awaiting customer reply', blocker: false }
    case 'accepted':
      return { text: 'Book offline → mark booked', blocker: false }
    default:
      return { text: 'Review request', blocker: false }
  }
}

export function parseQuoteStep(search: URLSearchParams, lifecycle?: string | null): QuoteStep {
  const raw = search.get('step') || search.get('tab') || ''
  if (raw && TAB_TO_STEP[raw]) return TAB_TO_STEP[raw]
  return stepFromLifecycle(lifecycle)
}

export const QUOTE_STEPS: Array<{ id: QuoteStep; label: string }> = [
  { id: 'source', label: 'Source' },
  { id: 'dealers', label: 'Dealers' },
  { id: 'market', label: 'Market' },
  { id: 'build', label: 'Build' },
  { id: 'send', label: 'Send' },
]
