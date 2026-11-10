import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SourceOptions from './SourceOptions'
import * as draftsLib from '../lib/quoteDrafts'
import * as leadsLib from '../lib/leads'
import * as dealersLib from '../lib/dealers'

vi.mock('../lib/quoteDrafts', async () => {
  const actual = await vi.importActual<typeof draftsLib>('../lib/quoteDrafts')
  return { ...actual, fetchComparison: vi.fn(), setDraftItems: vi.fn() }
})
vi.mock('../lib/leads', async () => {
  const actual = await vi.importActual<typeof leadsLib>('../lib/leads')
  return { ...actual, fetchFlightQuotes: vi.fn(), fetchHotelSources: vi.fn() }
})
vi.mock('../lib/dealers', async () => {
  const actual = await vi.importActual<typeof dealersLib>('../lib/dealers')
  return { ...actual, fetchDealerResponses: vi.fn() }
})

const fetchComparison = vi.mocked(draftsLib.fetchComparison)
const setDraftItems = vi.mocked(draftsLib.setDraftItems)
const fetchFlightQuotes = vi.mocked(leadsLib.fetchFlightQuotes)
const fetchHotelSources = vi.mocked(leadsLib.fetchHotelSources)
const fetchDealerResponses = vi.mocked(dealersLib.fetchDealerResponses)

const lead = (over: Partial<leadsLib.Lead> = {}): leadsLib.Lead => ({
  id: 'lead-1', phone: '971501234567', booking_type: 'package', origin: 'Dubai', destination: 'Istanbul',
  travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1, children_ages: [8],
  budget: null, hotel_name: null, notes: null, summary: null, quote_status: 'completed', created_at: '', ...over,
})

const option = (source_type: draftsLib.ComparisonItem['source_type'], n: number, net_cost: number | null, label = `${source_type} ${n}`): draftsLib.ComparisonItem => ({
  id: `${source_type}:${n}`, source_type, source_id: String(n), label, description: null, net_cost, currency: 'USD', sort_price: net_cost, meta: {},
})

const draft = (items: Array<Pick<draftsLib.ComparisonItem, 'source_type' | 'source_id' | 'label'>> = []): draftsLib.QuoteDraft =>
  ({
    id: 'd1', lead_id: 'lead-1', currency: 'USD', markup_type: 'percent', markup_value: 0, extras_amount: 0, extras_label: null,
    rounding_mode: 'none', status: 'draft', notes: null, valid_until: null, created_at: '', updated_at: '',
    items: items.map((i, idx) => ({ id: `i${idx}`, quote_draft_id: 'd1', description: null, net_cost: 100, currency: 'USD', quantity: 1, item_order: idx, meta: {}, ...i })),
    pricing: { net_total: 0, markup_amount: 0, extras_amount: 0, subtotal: 0, selling_price: 0, gross_margin: 0, gross_margin_pct: null },
  }) as draftsLib.QuoteDraft

function renderOptions(props: Partial<React.ComponentProps<typeof SourceOptions>> = {}) {
  const onDraftChange = vi.fn()
  const onCompare = vi.fn()
  const view = render(
    <MemoryRouter>
      <SourceOptions lead={lead()} draft={draft()} onDraftChange={onDraftChange} onCompare={onCompare} onRetry={() => {}} retrying={false} {...props} />
    </MemoryRouter>,
  )
  return { onDraftChange, onCompare, ...view }
}

const flights = [option('flight_api', 1, 1260, 'Turkish Airlines'), option('flight_api', 2, 1540, 'Emirates'), option('flight_api', 3, 1310, 'flydubai'), option('flight_api', 4, 1700, 'Pegasus'), option('flight_api', 5, 1800, 'AJet')]

beforeEach(() => {
  vi.clearAllMocks()
  fetchComparison.mockResolvedValue({ count: 0, items: [], source_errors: [] })
  fetchFlightQuotes.mockResolvedValue({ count: 5, quote_error: null, from: { code: 'DXB' }, to: { code: 'IST' } } as never)
  fetchHotelSources.mockRejectedValue(new Error('Lead is not a hotel booking'))
  fetchDealerResponses.mockResolvedValue([])
})

describe('SourceOptions', () => {
  it('lists flights and hotels with how many there are, cheapest flagged', async () => {
    fetchComparison.mockResolvedValue({ count: 7, items: [...flights.slice(0, 3), option('hotel_api', 1, 720, 'Bosphorus Grand'), option('hotel_api', 2, 590, 'Sultanahmet Suites'), option('predefined', 1, 1940, 'Istanbul Winter Family')], source_errors: [] })
    renderOptions()
    expect(await screen.findByRole('heading', { name: /Flights\s*· 3/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Hotels\s*· 2/ })).toBeTruthy()
    const turkish = screen.getByRole('checkbox', { name: 'Compare Turkish Airlines' }).closest('label') as HTMLElement
    expect(within(turkish).getByText('Lowest')).toBeTruthy()
    const emirates = screen.getByRole('checkbox', { name: 'Compare Emirates' }).closest('label') as HTMLElement
    expect(within(emirates).queryByText('Lowest')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Reusable package matches' })).toBeTruthy()
  })

  it('shows three at a time and expands on request, keeping ticked ones visible', async () => {
    fetchComparison.mockResolvedValue({ count: 5, items: flights, source_errors: [] })
    renderOptions({ draft: draft([{ source_type: 'flight_api', source_id: '5', label: 'AJet' }]) })
    await screen.findByRole('checkbox', { name: 'Compare Turkish Airlines' })
    expect(screen.queryByRole('checkbox', { name: 'Compare Pegasus' })).toBeNull()
    // The ticked fifth stays visible even though it is past the first three.
    expect(screen.getByRole('checkbox', { name: 'Compare AJet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(screen.getByRole('checkbox', { name: 'Compare Pegasus' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByRole('checkbox', { name: 'Compare Pegasus' })).toBeNull()
  })

  it('adds an option to the quote when ticked, keeping what was already there', async () => {
    fetchComparison.mockResolvedValue({ count: 2, items: [flights[0], option('hotel_api', 1, 720, 'Bosphorus Grand')], source_errors: [] })
    const saved = draft([{ source_type: 'flight_api', source_id: '1', label: 'Turkish Airlines' }, { source_type: 'hotel_api', source_id: '1', label: 'Bosphorus Grand' }])
    setDraftItems.mockResolvedValue(saved)
    const { onDraftChange } = renderOptions({ draft: draft([{ source_type: 'flight_api', source_id: '1', label: 'Turkish Airlines' }]) })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Compare Bosphorus Grand' }))
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith(saved))
    const sent = setDraftItems.mock.calls[0][1]
    expect(sent.map((i) => `${i.source_type}:${i.source_id}`)).toEqual(['flight_api:1', 'hotel_api:1'])
  })

  it('takes an option out when unticked', async () => {
    fetchComparison.mockResolvedValue({ count: 1, items: [flights[0]], source_errors: [] })
    setDraftItems.mockResolvedValue(draft())
    renderOptions({ draft: draft([{ source_type: 'flight_api', source_id: '1', label: 'Turkish Airlines' }]) })
    const box = (await screen.findByRole('checkbox', { name: 'Compare Turkish Airlines' })) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    await waitFor(() => expect(setDraftItems).toHaveBeenCalled())
    expect(setDraftItems.mock.calls[0][1]).toEqual([])
  })

  it('says so, and keeps the draft, when saving fails', async () => {
    fetchComparison.mockResolvedValue({ count: 1, items: [flights[0]], source_errors: [] })
    setDraftItems.mockRejectedValue(new Error('Quote is locked'))
    const { onDraftChange } = renderOptions()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Compare Turkish Airlines' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Quote is locked')
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it('shows the compare bar only once something is added, and it moves on to pricing', async () => {
    fetchComparison.mockResolvedValue({ count: 3, items: [flights[0], option('hotel_api', 1, 720, 'Bosphorus Grand'), option('dealer', 1, 1860, 'Atlas offer')], source_errors: [] })
    const none = renderOptions()
    await screen.findByRole('checkbox', { name: 'Compare Turkish Airlines' })
    expect(screen.queryByText(/added to compare/)).toBeNull()
    none.unmount()

    const { onCompare } = renderOptions({
      draft: draft([
        { source_type: 'flight_api', source_id: '1', label: 'a' },
        { source_type: 'hotel_api', source_id: '1', label: 'b' },
        { source_type: 'dealer', source_id: '1', label: 'c' },
      ]),
    })
    await screen.findAllByRole('checkbox', { name: 'Compare Turkish Airlines' })
    const bar = screen.getAllByRole('status').find((el) => /added to compare/.test(el.textContent || '')) as HTMLElement
    expect(bar.textContent).toContain('3 options added to compare')
    expect(bar.textContent).toContain('1 flight · 1 hotel · + 1 dealer offer')
    fireEvent.click(within(bar).getByRole('button', { name: 'Compare & price' }))
    expect(onCompare).toHaveBeenCalledTimes(1)
  })

  it('does not offer flights on a hotel-only lead', async () => {
    fetchComparison.mockResolvedValue({ count: 1, items: [option('hotel_api', 1, 100, 'Hotel A')], source_errors: [] })
    renderOptions({ lead: lead({ booking_type: 'hotel' }) })
    await screen.findByRole('checkbox', { name: 'Compare Hotel A' })
    expect(screen.queryByRole('heading', { name: /Flights/ })).toBeNull()
  })

  it('does not tick anything until the quote draft has loaded', async () => {
    fetchComparison.mockResolvedValue({ count: 1, items: [flights[0]], source_errors: [] })
    renderOptions({ draft: null })
    const box = (await screen.findByRole('checkbox', { name: 'Compare Turkish Airlines' })) as HTMLInputElement
    expect(box.disabled).toBe(true)
  })

  it('shows what went wrong loading options', async () => {
    fetchComparison.mockRejectedValue(new Error('Comparison unavailable'))
    renderOptions()
    expect((await screen.findByRole('alert')).textContent).toContain('Comparison unavailable')
  })
})

describe('Source status cards (package lead)', () => {
  it('summarises hotels from the comparison instead of calling the hotel-only breakdown', async () => {
    fetchComparison.mockResolvedValue({ count: 3, items: [option('hotel_api', 1, 1), option('hotel_api', 2, 2), option('hotel_api', 3, 3)], source_errors: [] })
    renderOptions()
    const card = (await screen.findByText('Hotel API')).closest('div')?.parentElement as HTMLElement
    await waitFor(() => expect(within(card).getByText('3 results')).toBeTruthy())
    expect(within(card).getByText('Done')).toBeTruthy()
    expect(fetchHotelSources).not.toHaveBeenCalled()
  })

  it('warns, rather than failing, when no hotels came back', async () => {
    fetchComparison.mockResolvedValue({ count: 0, items: [], source_errors: [] })
    renderOptions()
    const card = (await screen.findByText('Hotel API')).closest('div')?.parentElement as HTMLElement
    await waitFor(() => expect(within(card).getByText('No results')).toBeTruthy())
  })

  it('offers Retry sourcing', async () => {
    const onRetry = vi.fn()
    renderOptions({ onRetry })
    fireEvent.click(await screen.findByRole('button', { name: 'Retry sourcing' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
