import { describe, expect, it } from 'vitest'
import { seatsPercent } from './groupsVisas'

describe('seatsPercent', () => {
  it('caps at 100 and handles groups without a seat limit', () => {
    expect(seatsPercent({ seats_total: 40, seats_used: 10 })).toBe(25)
    expect(seatsPercent({ seats_total: 10, seats_used: 12 })).toBe(100)
    expect(seatsPercent({ seats_total: 0, seats_used: 3 })).toBe(0)
  })
})
