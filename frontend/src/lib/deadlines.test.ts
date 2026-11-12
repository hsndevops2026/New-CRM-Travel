import { describe, expect, it } from 'vitest'
import { addDays, boardDays } from './deadlines'

describe('boardDays', () => {
  it('puts departures, returns, people away and deadlines on the right day', () => {
    const days = boardDays({
      from: '2026-12-01', to: '2026-12-03',
      trips: [{ id: 'a', destination: 'Rome', travel_date: '2026-12-01', return_date: '2026-12-03', adults_count: 2, children_count: 0, customer: 'Sara' }],
      deadlines: [{ id: 'x', lead_id: 'a', kind: 'supplier_payment', label: 'Pay hotel', supplier: null, due_at: new Date(2026, 11, 2, 10).toISOString(), status: 'open', source: 'manual' }],
    })
    expect(days.map((d) => d.day)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
    expect(days[0].departures).toHaveLength(1)
    expect(days[1].away).toHaveLength(1)
    expect(days[1].deadlines).toHaveLength(1)
    expect(days[2].returns).toHaveLength(1)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
