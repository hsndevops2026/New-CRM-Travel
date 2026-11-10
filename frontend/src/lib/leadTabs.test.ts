import { describe, expect, it } from 'vitest'
import { buildTabBadges } from './leadTabs'

const none = { optionCount: null, requestIds: null, respondedRequestIds: null, versions: null }

describe('buildTabBadges', () => {
  it('shows nothing until there is something to say', () => {
    expect(buildTabBadges(none)).toEqual({})
    expect(buildTabBadges({ ...none, optionCount: 0, requestIds: [], versions: [] })).toEqual({})
  })

  it('counts the options on Source', () => {
    expect(buildTabBadges({ ...none, optionCount: 14 }).source).toEqual({ label: '14', tone: 'neutral' })
  })

  it('shows how many asked dealers have replied, amber until all have', () => {
    const partial = buildTabBadges({ ...none, requestIds: ['a', 'b', 'c'], respondedRequestIds: ['a', 'a'] })
    expect(partial.dealers).toEqual({ label: '1/3 replied', tone: 'warning' })
    const done = buildTabBadges({ ...none, requestIds: ['a', 'b'], respondedRequestIds: ['a', 'b'] })
    expect(done.dealers).toEqual({ label: '2/2 replied', tone: 'success' })
  })

  it('ignores replies to requests that belong to nobody on this lead', () => {
    const badges = buildTabBadges({ ...none, requestIds: ['a'], respondedRequestIds: ['zzz'] })
    expect(badges.dealers?.label).toBe('0/1 replied')
  })

  it('names the latest version with its state (a locked one is "locked", not "sent")', () => {
    const sent = buildTabBadges({ ...none, versions: [{ version_number: 2, status: 'sent' }, { version_number: 1, status: 'revoked' }] })
    expect(sent.send).toEqual({ label: 'v2 locked', tone: 'neutral' })
    expect(buildTabBadges({ ...none, versions: [{ version_number: 1, status: 'accepted' }] }).send?.tone).toBe('success')
    expect(buildTabBadges({ ...none, versions: [{ version_number: 3, status: 'revoked' }] }).send?.tone).toBe('warning')
  })
})
