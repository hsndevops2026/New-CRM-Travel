import { describe, expect, it } from 'vitest'
import { emptyTraveller, filledTravellers, padTravellers } from './travellers'

describe('travellers', () => {
  it('pads the rows to the number of adults and children on the lead', () => {
    const rows = padTravellers([{ ...emptyTraveller(), full_name: 'Omar' }], { adults: 2, children: 1 })
    expect(rows.map((r) => r.is_child)).toEqual([false, false, true])
    expect(padTravellers([], { adults: 0, children: 0 })).toHaveLength(1)
  })

  it('sends only rows with a name, keeping the id but not internal fields', () => {
    const out = filledTravellers([
      { ...emptyTraveller(), full_name: 'Lina', issues: ['expired'], id: 'x' },
      emptyTraveller(true),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).not.toHaveProperty('issues')
    expect(out[0].id).toBe('x')
  })
})
