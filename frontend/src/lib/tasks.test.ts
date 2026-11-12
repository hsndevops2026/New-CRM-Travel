import { describe, expect, it } from 'vitest'
import { isoToLocalInput, localInputToIso, taskGroup } from './tasks'

describe('taskGroup', () => {
  const now = new Date(2026, 10, 12, 10, 0)
  it('sorts open tasks by deadline', () => {
    expect(taskGroup({ status: 'open', due_at: new Date(2026, 10, 12, 9, 0).toISOString() }, now)).toBe('overdue')
    expect(taskGroup({ status: 'open', due_at: new Date(2026, 10, 12, 18, 0).toISOString() }, now)).toBe('today')
    expect(taskGroup({ status: 'open', due_at: new Date(2026, 10, 13, 9, 0).toISOString() }, now)).toBe('upcoming')
    expect(taskGroup({ status: 'open', due_at: null }, now)).toBe('no_date')
    expect(taskGroup({ status: 'done', due_at: new Date(2026, 10, 1).toISOString() }, now)).toBe('done')
  })

  it('round-trips the datetime input value', () => {
    const iso = localInputToIso('2026-12-01T09:30')!
    expect(isoToLocalInput(iso)).toBe('2026-12-01T09:30')
    expect(localInputToIso('')).toBeNull()
  })
})
