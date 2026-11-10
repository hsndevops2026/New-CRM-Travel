import { describe, expect, it } from 'vitest'
import {
  composeInternationalPhone,
  digitsOnly,
  splitInternationalPhone,
} from './phone'

describe('international phone helpers', () => {
  it('combines an India calling code with a formatted local number', () => {
    expect(composeInternationalPhone('+91', '098 765 43210')).toBe('919876543210')
  })

  it('splits a stored India number for dealer editing', () => {
    expect(splitInternationalPhone('+91 98765 43210')).toEqual({
      dial: '91',
      local: '9876543210',
    })
  })

  it('prefers the longest matching calling code', () => {
    expect(splitInternationalPhone('971501234567')).toEqual({
      dial: '971',
      local: '501234567',
    })
  })

  it('uses admin-configured calling codes when splitting a dealer number', () => {
    expect(splitInternationalPhone('358401234567', '971', [{ dial: '358' }])).toEqual({
      dial: '358',
      local: '401234567',
    })
  })

  it('removes non-numeric characters', () => {
    expect(digitsOnly('+91 (987) 654-3210')).toBe('919876543210')
  })
})
