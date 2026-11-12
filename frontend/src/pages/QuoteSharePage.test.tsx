import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuoteSharePage from './QuoteSharePage'
import * as versionsLib from '../lib/quoteVersions'

vi.mock('../lib/quoteVersions', async () => {
  const actual = await vi.importActual<typeof versionsLib>('../lib/quoteVersions')
  return { ...actual, fetchPublicQuote: vi.fn(), acceptPublicQuote: vi.fn(), publicPdfUrl: (t: string) => `/api/q/${t}/pdf` }
})

const fetchPublicQuote = vi.mocked(versionsLib.fetchPublicQuote)
const acceptPublicQuote = vi.mocked(versionsLib.acceptPublicQuote)

function view(over: Partial<versionsLib.ShareTokenView> = {}): versionsLib.ShareTokenView {
  return {
    token: 'tok', expires_at: '2026-12-01T00:00:00Z', views: 2, version_status: 'sent', selling_price: 2298, currency: 'USD', accepted_at: null,
    snapshot: {
      title: 'Istanbul family winter break', version_number: 2, currency: 'USD', notes: 'Breakfast daily.', valid_until: '2026-11-25T00:00:00Z',
      lead: { destination: 'Istanbul', origin: 'Dubai', travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1, customer_name: 'Sarah Ahmed' },
      items: [
        { label: 'Turkish Airlines return', description: 'Direct · 30 kg', quantity: 1, meta: { airline: 'Turkish Airlines' } },
        { label: 'Bosphorus Grand Hotel', description: '4-star · Beşiktaş', quantity: 1, meta: { hotel_name: 'Bosphorus Grand', room_type: 'Family room', board_name: 'Breakfast', cancellation_policy: 'Free cancellation until 5 Dec' } },
      ],
      pricing: { selling_price: 2298 },
    },
    agency: { agency_name: 'Horizon Travel', logo_url: null, primary_color: '#0f766e', quotation_template: 'classic', phone: '+971 4 555 0188', email: 'hello@horizon.ae', website: null, address: 'Business Bay, Dubai', quotation_footer: null },
    ...over,
  } as versionsLib.ShareTokenView
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quote/tok']}>
      <Routes>
        <Route path="/quote/:token" element={<QuoteSharePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchPublicQuote.mockResolvedValue(view())
})

describe('QuoteSharePage — the quote', () => {
  it('shows the trip, what is included, terms and the total — never costs or markup', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Istanbul family winter break', level: 1 })).toBeTruthy()
    expect(screen.getByText('Quote for Sarah Ahmed · v2')).toBeTruthy()
    expect(screen.getByText('Dubai → Istanbul')).toBeTruthy()
    expect(screen.getByText('12–18 Dec 2026')).toBeTruthy()
    expect(screen.getByText('6 nights')).toBeTruthy()
    expect(screen.getByText('2 adults, 1 child')).toBeTruthy()
    const included = screen.getByRole('region', { name: 'What’s included' })
    expect(within(included).getByText('Turkish Airlines return')).toBeTruthy()
    expect(within(included).getByText('Family room')).toBeTruthy()
    expect(screen.getByText('Bosphorus Grand Hotel: Free cancellation until 5 Dec')).toBeTruthy()
    const price = screen.getByRole('region', { name: 'Total price' })
    expect(price.textContent).toContain('2,298')
    expect(price.textContent).toContain('For 2 adults, 1 child')
    expect(document.body.textContent).not.toMatch(/net cost|markup|margin/i)
  })

  it('lets the customer call, message and download without signing in', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('link', { name: /Call us/ }).getAttribute('href')).toBe('tel:+97145550188')
    expect(screen.getByRole('link', { name: 'Reply on WhatsApp' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/97145550188\?text=/)
    expect(screen.getByRole('link', { name: /Download PDF/ }).getAttribute('href')).toBe('/api/q/tok/pdf')
  })

  it('shows the agency note and omits sections that have nothing to say', async () => {
    fetchPublicQuote.mockResolvedValue(view({ snapshot: { ...view().snapshot, notes: null, items: [{ label: 'Visa support', description: null, quantity: 1, meta: {} }] } }))
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('region', { name: /A note from/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Terms & cancellation' })).toBeNull()
  })

  it('applies the agency brand colour', async () => {
    fetchPublicQuote.mockResolvedValue(view({ agency: { ...view().agency, primary_color: '#1d4ed8' } }))
    renderPage()
    const button = await screen.findByRole('button', { name: 'Accept this quote' })
    expect(button.style.background).toMatch(/rgb\(29, 78, 216\)|#1d4ed8/i)
  })
})

describe('QuoteSharePage — accepting', () => {
  it('needs a name, and says so next to the field without calling the server', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this quote' }))
    const field = screen.getByLabelText(/Your full name/)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Please enter your name so we know who accepted.')).toBeTruthy()
    expect(acceptPublicQuote).not.toHaveBeenCalled()
  })

  it('sends the name and optional email, then thanks the customer by first name', async () => {
    acceptPublicQuote.mockResolvedValue(undefined as never)
    renderPage()
    fireEvent.change(await screen.findByLabelText(/Your full name/), { target: { value: '  Sarah Ahmed ' } })
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'sarah@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept this quote' }))
    await screen.findByRole('heading', { name: 'Thanks, Sarah — we’ve got it' })
    expect(acceptPublicQuote).toHaveBeenCalledWith('tok', { customer_name: 'Sarah Ahmed', customer_email: 'sarah@example.com' })
    expect(screen.getByText(/Nothing has been charged or reserved yet/)).toBeTruthy()
    const summary = screen.getByRole('region', { name: 'Your accepted quote' })
    expect(within(summary).getByText('Sarah Ahmed')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'What happens next' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept this quote' })).toBeNull()
  })

  it('keeps the form and explains when the server refuses', async () => {
    acceptPublicQuote.mockRejectedValue(new Error('This quote has been replaced'))
    renderPage()
    fireEvent.change(await screen.findByLabelText(/Your full name/), { target: { value: 'Sarah' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept this quote' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This quote has been replaced')
    expect(screen.getByRole('button', { name: 'Accept this quote' })).toBeTruthy()
  })

  it('opens straight on the confirmation for a quote that was already accepted', async () => {
    fetchPublicQuote.mockResolvedValue(view({ version_status: 'accepted', accepted_at: '2026-10-21T14:12:00Z' }))
    renderPage()
    await screen.findByRole('heading', { name: /we’ve got it/ })
    expect(screen.queryByRole('form')).toBeNull()
  })
})

describe('QuoteSharePage — a link that does not open', () => {
  it('explains the likely causes and what to do, without alarming', async () => {
    fetchPublicQuote.mockRejectedValue(new Error('Quote link is invalid, expired, or revoked'))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'This quote link isn’t available' })).toBeTruthy()
    expect(screen.getByText(/Ask your agent to send the latest link/)).toBeTruthy()
  })

  it('shows a loading state first', () => {
    fetchPublicQuote.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status').textContent).toMatch(/Loading your quote/)
  })
})

describe('QuoteSharePage — accessibility', () => {
  it('labels every field and keeps the accept form findable by name', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('form', { name: 'Happy with this quote?' })).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText(/Your full name/)).toBeTruthy())
    expect(screen.getByLabelText(/Email/)).toBeTruthy()
  })
})

describe('QuoteSharePage — Arabic for customers', () => {
  it('shows the quote in Arabic, right to left', async () => {
    const { setLanguage } = await import('../lib/i18n')
    setLanguage('ar')
    try {
      renderPage()
      const ar = (await import('../locales/ar.json')).default as Record<string, string>
      expect(await screen.findByRole('button', { name: ar['Accept this quote'] })).toBeTruthy()
      expect(screen.getByText(ar['Total price'])).toBeTruthy()
      expect(screen.getByText(ar['Happy with this quote?'])).toBeTruthy()
      expect(screen.queryByText('Accept this quote')).toBeNull()
      expect(document.documentElement.dir).toBe('rtl')
    } finally {
      setLanguage('en')
    }
  })
})

describe('QuoteSharePage — replaced or expired quotes', () => {
  it('hides the accept form when a newer version replaced this one', async () => {
    fetchPublicQuote.mockResolvedValue(view({ superseded: true }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'This quote has been updated' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept this quote' })).toBeNull()
  })

  it('hides the accept form when the quote is past its valid-until date', async () => {
    fetchPublicQuote.mockResolvedValue(view({ expired: true }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'This quote has expired' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept this quote' })).toBeNull()
  })
})
