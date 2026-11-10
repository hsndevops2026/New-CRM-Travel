import { describe, expect, it } from 'vitest'
import { cancellationTerms, firstName, itemKind, linkProblem, travellersText, whatsappLink } from './publicQuoteView'

describe('itemKind', () => {
  it('tells flights from hotels from everything else', () => {
    expect(itemKind({ airline: 'Turkish Airlines' })).toBe('flight')
    expect(itemKind({ hotel_name: 'Bosphorus Grand' })).toBe('hotel')
    expect(itemKind({ room_type: 'Family room' })).toBe('hotel')
    expect(itemKind({ includes: 'Visa support' })).toBe('other')
    expect(itemKind(null)).toBe('other')
  })
  it('prefers flight when both appear (a package line)', () => {
    expect(itemKind({ airline: 'TK', hotel_name: 'X' })).toBe('flight')
  })
})

describe('cancellationTerms', () => {
  it('collects the terms each item states, from either field, skipping blanks', () => {
    const terms = cancellationTerms([
      { label: 'Hotel', meta: { cancellation_policy: 'Free cancellation until 5 Dec' } },
      { label: 'Dealer package', meta: { cancellation_terms: '  Non-refundable after 1 Dec ' } },
      { label: 'Flight', meta: { cancellation_policy: '   ' } },
      { label: 'Visa' },
    ])
    expect(terms).toEqual([
      { label: 'Hotel', text: 'Free cancellation until 5 Dec' },
      { label: 'Dealer package', text: 'Non-refundable after 1 Dec' },
    ])
  })
})

describe('travellersText', () => {
  it('pluralises and omits zero', () => {
    expect(travellersText(2, 1)).toBe('2 adults, 1 child')
    expect(travellersText(1, 0)).toBe('1 adult')
    expect(travellersText(2, 3)).toBe('2 adults, 3 children')
    expect(travellersText(0, 0)).toBeNull()
    expect(travellersText(undefined, null)).toBeNull()
  })
})

describe('whatsappLink', () => {
  it('builds a wa.me link from any phone format', () => {
    expect(whatsappLink('+971 4 555 0188')).toBe('https://wa.me/97145550188')
  })
  it('adds an encoded message', () => {
    expect(whatsappLink('+971501234567', 'Hi, a question')).toBe('https://wa.me/971501234567?text=Hi%2C%20a%20question')
  })
  it('is null when there is no usable number', () => {
    expect(whatsappLink(null)).toBeNull()
    expect(whatsappLink('n/a')).toBeNull()
  })
})

describe('firstName / linkProblem', () => {
  it('takes the first word', () => {
    expect(firstName('Sarah Ahmed')).toBe('Sarah')
    expect(firstName('  ')).toBe('')
    expect(firstName(null)).toBe('')
  })
  it('names the likely causes and the one thing that helps, without guessing which applies', () => {
    const { title, body } = linkProblem()
    expect(title).toContain('isn’t available')
    for (const cause of ['expired', 'mistyped', 'replaced']) expect(body).toContain(cause)
    expect(body).toContain('Ask your agent')
  })
})
