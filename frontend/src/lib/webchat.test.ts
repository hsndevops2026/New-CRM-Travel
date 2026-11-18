import { describe, expect, it } from 'vitest'
import { embedSnippet, normalizeOrigin, parseOrigins, webSourceParts } from './webchat'

describe('website chat helpers', () => {
  it('builds the line to paste', () => {
    expect(embedSnippet('https://api.agency.com/webchat.js')).toBe('<script src="https://api.agency.com/webchat.js" async></script>')
    expect(embedSnippet('https://api.agency.com/webchat.js', 'wc_abc')).toBe('<script src="https://api.agency.com/webchat.js" data-key="wc_abc" async></script>')
  })

  it('reads one site per line', () => {
    expect(normalizeOrigin('Agency.com/page')).toBe('https://agency.com')
    expect(normalizeOrigin('not a site')).toBeNull()
    expect(normalizeOrigin('agency')).toBeNull()
    expect(normalizeOrigin('http://localhost:8080')).toBe('http://localhost:8080')
    expect(parseOrigins('agency.com\nhttps://booking.agency.com/x, agency.com\n\nnot a site')).toEqual({
      origins: ['https://agency.com', 'https://booking.agency.com'],
      invalid: ['not a site'],
    })
  })

  it('describes where a website lead came from', () => {
    expect(webSourceParts({
      site: 'https://www.agency.com',
      page_url: 'https://www.agency.com/antalya',
      utm: { utm_source: 'instagram', utm_campaign: 'winter' },
    })).toEqual({ site: 'agency.com', via: 'instagram / winter', owner: null, page: 'https://www.agency.com/antalya', pageTitle: null })
    expect(webSourceParts({ site: 'https://agency.com', referrer: 'https://www.google.com/' })?.via).toBe('google.com')
    expect(webSourceParts({ site: 'https://agency.com', utm: { gclid: 'abc' } })?.via).toBe('Google Ads')
    expect(webSourceParts({ site: 'https://agency.com', chat_owner: { id: 'u1', email: 'ahmed.saleh@agency.com' } })?.owner).toBe('Ahmed Saleh')
    expect(webSourceParts(null)).toBeNull()
  })
})
