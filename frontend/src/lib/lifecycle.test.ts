import { describe, expect, it } from 'vitest'
import {
  BOARD_STAGES,
  HAPPY_PATH,
  LIFECYCLE_STEP_LABELS,
  lifecycleLabel,
  nextActionFor,
  parseQuoteStep,
  pathStatus,
  primaryCtaForLifecycle,
  stepFromLifecycle,
} from './lifecycle'

describe('lifecycle helpers', () => {
  it('humanizes snake_case stages', () => {
    expect(lifecycleLabel('awaiting_dealers')).toBe('Awaiting dealers')
    expect(lifecycleLabel('comparing')).toBe('Comparing')
    expect(lifecycleLabel('ready_to_send')).toBe('Ready to send')
    expect(lifecycleLabel(null)).toBe('Intake')
  })

  it('maps lifecycle to quote step', () => {
    expect(stepFromLifecycle('intake')).toBe('source')
    expect(stepFromLifecycle('sourcing')).toBe('source')
    expect(stepFromLifecycle('awaiting_dealers')).toBe('dealers')
    expect(stepFromLifecycle('comparing')).toBe('build')
    expect(stepFromLifecycle('drafting')).toBe('build')
    expect(stepFromLifecycle('ready_to_send')).toBe('send')
    expect(stepFromLifecycle('booked')).toBe('send')
  })

  it('maps primary CTA from lifecycle', () => {
    expect(primaryCtaForLifecycle('intake')).toEqual({ label: 'Retry sourcing', step: 'source' })
    expect(primaryCtaForLifecycle('awaiting_dealers')).toEqual({
      label: 'Request dealers',
      step: 'dealers',
    })
    expect(primaryCtaForLifecycle('comparing')).toEqual({ label: 'Compare quotes', step: 'build' })
    expect(primaryCtaForLifecycle('ready_to_send')).toEqual({ label: 'Send quote', step: 'send' })
    expect(primaryCtaForLifecycle('booked')).toEqual({ label: 'View quote', step: 'send' })
  })

  it('migrates legacy tab query params to steps', () => {
    expect(parseQuoteStep(new URLSearchParams('tab=compare'))).toBe('build')
    expect(parseQuoteStep(new URLSearchParams('tab=dealers'))).toBe('dealers')
    expect(parseQuoteStep(new URLSearchParams('step=send'))).toBe('send')
    expect(parseQuoteStep(new URLSearchParams('step=trip'))).toBe('trip')
    expect(parseQuoteStep(new URLSearchParams(), 'sourcing')).toBe('source')
  })

  it('shows every stage on the path — drafting and accepted are real stages', () => {
    // These used to be folded into "compare" and "sent", hiding where a lead really was.
    expect(pathStatus('drafting')).toBe('drafting')
    expect(pathStatus('accepted')).toBe('accepted')
    expect(pathStatus('booked')).toBe('booked')
  })

  it('puts a lead that left the path (lost / archived / unknown) back at intake', () => {
    expect(pathStatus('lost')).toBe('intake')
    expect(pathStatus('archived')).toBe('intake')
    expect(pathStatus(null)).toBe('intake')
  })

  it('has nine stages on the path and eight board columns', () => {
    expect(HAPPY_PATH).toHaveLength(9)
    expect(BOARD_STAGES).toHaveLength(8)
    expect(BOARD_STAGES).not.toContain('booked')
    expect(LIFECYCLE_STEP_LABELS.ready_to_send).toBe('Ready')
  })
})

describe('nextActionFor', () => {
  it('names what each stage is waiting for', () => {
    expect(nextActionFor('awaiting_dealers').text).toBe('Awaiting dealer replies')
    expect(nextActionFor('comparing').text).toBe('Build quote')
    expect(nextActionFor('drafting').text).toBe('Create version')
    expect(nextActionFor('ready_to_send').text).toBe('Send quote')
    expect(nextActionFor('sent').text).toBe('Awaiting customer reply')
    expect(nextActionFor('accepted').text).toBe('Book offline → mark booked')
    expect(nextActionFor(null).text).toBe('Review request')
  })

  it('flags a failed search as a blocker in any stage', () => {
    for (const status of ['sourcing', 'comparing', 'ready_to_send']) {
      expect(nextActionFor(status, 'error')).toEqual({ text: 'Search failed · retry sourcing', blocker: true })
    }
  })

  it('is not a blocker while options are still being fetched', () => {
    expect(nextActionFor('sourcing', 'processing')).toEqual({ text: 'Fetching options…', blocker: false })
  })
})
