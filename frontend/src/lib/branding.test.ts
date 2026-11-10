import { describe, expect, it } from 'vitest'
import type { AgencySettings } from './agencySettings'
import { changedFieldCount, contrastVerdict, whiteContrast } from './branding'

const base: AgencySettings = {
  agency_name: 'Horizon', logo_url: null, primary_color: '#0f766e', quotation_template: 'classic',
  phone: null, email: null, website: null, address: null, quotation_footer: 'Prices are indicative.',
}

describe('whiteContrast', () => {
  it('is the full 21:1 for black and 1:1 for white', () => {
    expect(whiteContrast('#000000')).toBeCloseTo(21, 0)
    expect(whiteContrast('#ffffff')).toBeCloseTo(1, 1)
  })
  it('is null for anything that is not #rrggbb', () => {
    expect(whiteContrast('teal')).toBeNull()
    expect(whiteContrast('#fff')).toBeNull()
    expect(whiteContrast('')).toBeNull()
  })
  it('accepts a missing # and upper case', () => {
    expect(whiteContrast('0F766E')).toBeCloseTo(whiteContrast('#0f766e') as number, 5)
  })
})

describe('contrastVerdict', () => {
  it('passes the design teal and a deep navy, grades them', () => {
    expect(contrastVerdict('#0F766E')).toEqual({ ok: true, label: 'AA on white text' })
    expect(contrastVerdict('#0f172a').label).toBe('AAA on white text')
  })
  it('flags colours white text cannot be read on', () => {
    expect(contrastVerdict('#facc15')).toEqual({ ok: false, label: 'Too light for white text' })
    expect(contrastVerdict('#ffffff').ok).toBe(false)
  })
  it('asks for a valid colour when it is not one', () => {
    expect(contrastVerdict('nope')).toEqual({ ok: false, label: 'Use a #rrggbb colour' })
  })
})

describe('changedFieldCount', () => {
  it('is zero when nothing changed', () => {
    expect(changedFieldCount(base, { ...base })).toBe(0)
  })
  it('counts each changed field once', () => {
    expect(changedFieldCount({ ...base, agency_name: 'Horizon Travel', phone: '+971' }, base)).toBe(2)
  })
  it('treats null and empty text as the same blank', () => {
    expect(changedFieldCount({ ...base, phone: '' }, base)).toBe(0)
    expect(changedFieldCount({ ...base, phone: null }, { ...base, phone: '' })).toBe(0)
  })
})
