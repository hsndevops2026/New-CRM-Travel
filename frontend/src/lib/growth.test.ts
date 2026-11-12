import { describe, expect, it } from 'vitest'
import { offerTemplate } from './growth'

describe('offerTemplate', () => {
  it('greets by first name and mentions the last trip and the offers link', () => {
    const ar = offerTemplate({ name: 'Nour Saleh', last_destination: 'أنطاليا' }, 'https://x/offers', 'ar')
    expect(ar).toMatch(/^مرحباً Nour!/)
    expect(ar).toContain('أنطاليا')
    expect(ar).toContain('https://x/offers')
    expect(offerTemplate({ name: null, last_destination: null }, 'u', 'en')).toMatch(/^Hi! We have new offers/)
  })
})
