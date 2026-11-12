import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LeadDetailPage from './LeadDetailPage'
import { SearchProvider } from '../context/SearchProvider'
import * as leadsLib from '../lib/leads'
import * as draftsLib from '../lib/quoteDrafts'
import * as dealersLib from '../lib/dealers'
import * as versionsLib from '../lib/quoteVersions'
import * as inboxLib from '../lib/inbox'

vi.mock('../lib/leads', async () => {
  const actual = await vi.importActual<typeof leadsLib>('../lib/leads')
  return { ...actual, fetchLeadById: vi.fn(), fetchLeadAudit: vi.fn(), transitionLifecycle: vi.fn(), deleteLead: vi.fn(), retryFlightQuotes: vi.fn(), retryHotelQuotes: vi.fn(), retryPackageQuotes: vi.fn() }
})
vi.mock('../lib/quoteDrafts', async () => {
  const actual = await vi.importActual<typeof draftsLib>('../lib/quoteDrafts')
  return { ...actual, fetchQuoteDraft: vi.fn(), upsertQuoteDraft: vi.fn(), fetchComparison: vi.fn() }
})
vi.mock('../lib/dealers', async () => {
  const actual = await vi.importActual<typeof dealersLib>('../lib/dealers')
  return { ...actual, fetchDealerRequests: vi.fn(), fetchDealerResponses: vi.fn() }
})
vi.mock('../lib/quoteVersions', async () => {
  const actual = await vi.importActual<typeof versionsLib>('../lib/quoteVersions')
  return { ...actual, fetchVersions: vi.fn() }
})
vi.mock('../lib/inbox', async () => {
  const actual = await vi.importActual<typeof inboxLib>('../lib/inbox')
  return { ...actual, fetchThreadMessages: vi.fn(), sendThreadMessage: vi.fn() }
})
// The panels have their own tests; here they only prove which one is on screen.
vi.mock('../components/SourceOptions', () => ({ default: () => <div>source-panel</div> }))
vi.mock('../components/ComparisonPanel', () => ({ default: () => <div>comparison-panel</div> }))
vi.mock('../components/PricingPanel', () => ({ default: () => <div>pricing-panel</div> }))
vi.mock('../components/QuoteSendPanel', () => ({ default: () => <div>send-panel</div> }))
vi.mock('../components/LeadDealerRfqPanel', () => ({ default: () => <div>rfq-panel</div> }))
vi.mock('../components/LeadDealerResponsesPanel', () => ({ default: () => <div>responses-panel</div> }))
vi.mock('../components/MarketReferencesPanel', () => ({ default: () => <div>market-panel</div> }))
vi.mock('../components/PackageOfferBanner', () => ({ default: () => null }))
vi.mock('../components/tasks/LeadTasksButton', () => ({ default: () => null }))

const m = {
  fetchLeadById: vi.mocked(leadsLib.fetchLeadById),
  fetchLeadAudit: vi.mocked(leadsLib.fetchLeadAudit),
  transitionLifecycle: vi.mocked(leadsLib.transitionLifecycle),
  deleteLead: vi.mocked(leadsLib.deleteLead),
  retryPackageQuotes: vi.mocked(leadsLib.retryPackageQuotes),
  fetchQuoteDraft: vi.mocked(draftsLib.fetchQuoteDraft),
  fetchComparison: vi.mocked(draftsLib.fetchComparison),
  fetchDealerRequests: vi.mocked(dealersLib.fetchDealerRequests),
  fetchDealerResponses: vi.mocked(dealersLib.fetchDealerResponses),
  fetchVersions: vi.mocked(versionsLib.fetchVersions),
  fetchThreadMessages: vi.mocked(inboxLib.fetchThreadMessages),
}

const baseLead = (over: Partial<leadsLib.Lead> = {}): leadsLib.Lead => ({
  id: 'aff20913-1ea8-4e49-b3ab-f12bd983c413', phone: '971501234567', booking_type: 'package', origin: 'Dubai', destination: 'Istanbul',
  travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1, children_ages: [8], budget: null,
  hotel_name: null, notes: null, summary: null, contact_name: 'Sarah Ahmed', lifecycle_status: 'comparing', quote_status: 'completed',
  lifecycle_allowed: ['sourcing', 'drafting', 'archived', 'lost'], created_at: '2026-10-01T00:00:00Z', ...over,
})

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function renderPage(path = '/leads/aff20913-1ea8-4e49-b3ab-f12bd983c413') {
  return render(
    <SearchProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/leads/:segment" element={<><LeadDetailPage /><Where /></>} />
          <Route path="/inbox/:threadId" element={<div>inbox page</div>} />
        </Routes>
      </MemoryRouter>
    </SearchProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  m.fetchLeadById.mockResolvedValue(baseLead())
  m.fetchLeadAudit.mockResolvedValue([])
  m.fetchQuoteDraft.mockResolvedValue({ id: 'd1', items: [], pricing: {} } as never)
  m.fetchComparison.mockResolvedValue({ count: 14, items: [], source_errors: [] })
  m.fetchDealerRequests.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] as never)
  m.fetchDealerResponses.mockResolvedValue([{ dealer_request_id: 'r1' }] as never)
  m.fetchVersions.mockResolvedValue([])
  m.fetchThreadMessages.mockResolvedValue({ thread: { id: 'customer:l', kind: 'customer', title: 'Sarah', subtitle: '', last_message: '', last_at: null }, messages: [] })
})

describe('LeadDetailPage — header', () => {
  it('shows who, where, when and with whom, with the stage and type as badges', async () => {
    renderPage()
    const title = await screen.findByRole('heading', { name: 'Sarah Ahmed', level: 1 })
    const header = title.closest('header') as HTMLElement
    expect(within(header).getAllByText('Comparing').length).toBeGreaterThan(0)
    expect(within(header).getByText('Flight + Hotel package')).toBeTruthy()
    expect(within(header).getByText('Dubai → Istanbul')).toBeTruthy()
    expect(within(header).getByText('12–18 Dec 2026 · 6 nights')).toBeTruthy()
    expect(within(header).getByText('2 adults, 1 child (8)')).toBeTruthy()
    expect(within(header).getByRole('link', { name: '+971501234567' }).getAttribute('href')).toBe('tel:+971501234567')
  })

  it('has a breadcrumb back through the lead type to the list', async () => {
    renderPage()
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Leads' }).getAttribute('href')).toBe('/leads/hotel')
    expect(within(crumbs).getByRole('link', { name: 'Package' }).getAttribute('href')).toBe('/leads/package')
    expect(within(crumbs).getByText('L-AFF209')).toBeTruthy()
  })

  it('says what comes next beside the stage path', async () => {
    renderPage()
    const path = await screen.findByRole('list', { name: 'Lead stage' })
    expect(within(path).getByText('Next: Build quote')).toBeTruthy()
    expect(within(path).getByText('Comparing').closest('li')).toBeTruthy()
  })

  it('has no "next" hint for a lead that is lost', async () => {
    m.fetchLeadById.mockResolvedValue(baseLead({ lifecycle_status: 'lost', lifecycle_allowed: ['intake'] }))
    renderPage()
    await screen.findByRole('heading', { name: 'Sarah Ahmed', level: 1 })
    expect(screen.queryByText(/^Next:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
  })

  it('falls back to the phone number when the customer has no name', async () => {
    m.fetchLeadById.mockResolvedValue(baseLead({ contact_name: null }))
    renderPage()
    expect(await screen.findByRole('heading', { name: '+971501234567', level: 1 })).toBeTruthy()
  })
})

describe('LeadDetailPage — steps', () => {
  it('opens on the step the lead is at, and numbers the tabs with what is waiting', async () => {
    renderPage()
    const tabs = await screen.findByRole('navigation', { name: 'Lead workspace steps' })
    expect(await screen.findByText('comparison-panel')).toBeTruthy()
    expect(within(tabs).getByRole('button', { name: /Build/ }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /Source.*14/ })).toBeTruthy())
    expect(within(tabs).getByRole('button', { name: /Dealers.*1\/3 replied/ })).toBeTruthy()
  })

  it('moves between steps, keeping the choice in the address', async () => {
    renderPage()
    const tabs = await screen.findByRole('navigation', { name: 'Lead workspace steps' })
    fireEvent.click(within(tabs).getByRole('button', { name: /Dealers/ }))
    expect(await screen.findByText('rfq-panel')).toBeTruthy()
    expect(screen.getByText('responses-panel')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toContain('step=dealers')
    fireEvent.click(within(tabs).getByRole('button', { name: /Send/ }))
    expect(await screen.findByText('send-panel')).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('button', { name: /Market/ }))
    expect(await screen.findByText('market-panel')).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('button', { name: /Source/ }))
    expect(await screen.findByText('source-panel')).toBeTruthy()
  })

  it('honours a step in the address', async () => {
    renderPage('/leads/aff20913-1ea8-4e49-b3ab-f12bd983c413?step=send')
    expect(await screen.findByText('send-panel')).toBeTruthy()
  })

  it('labels the primary action for the stage and goes to that step', async () => {
    m.fetchLeadById.mockResolvedValue(baseLead({ lifecycle_status: 'awaiting_dealers' }))
    renderPage('/leads/aff20913-1ea8-4e49-b3ab-f12bd983c413?step=source')
    const cta = (await screen.findAllByRole('button', { name: /Request dealers/ }))[0]
    fireEvent.click(cta)
    expect(await screen.findByText('rfq-panel')).toBeTruthy()
  })

  it('retries sourcing from the action when the lead needs it', async () => {
    m.fetchLeadById.mockResolvedValue(baseLead({ lifecycle_status: 'sourcing', quote_status: 'error' }))
    m.retryPackageQuotes.mockResolvedValue(undefined as never)
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: /Retry sourcing/ }))[0])
    await waitFor(() => expect(m.retryPackageQuotes).toHaveBeenCalledWith('aff20913-1ea8-4e49-b3ab-f12bd983c413'))
  })
})

describe('LeadDetailPage — stage changes and chat', () => {
  it('moves the lead only to stages the server allows', async () => {
    m.transitionLifecycle.mockResolvedValue(baseLead({ lifecycle_status: 'drafting' }))
    renderPage()
    const path = await screen.findByRole('list', { name: 'Lead stage' })
    expect(within(path).queryByRole('button', { name: 'Booked' })).toBeNull()
    fireEvent.click(within(path).getByRole('button', { name: 'Drafting' }))
    await waitFor(() => expect(m.transitionLifecycle).toHaveBeenCalledWith('aff20913-1ea8-4e49-b3ab-f12bd983c413', 'drafting'))
  })

  it('shows the WhatsApp chat on demand and says what the button will do', async () => {
    renderPage()
    const show = (await screen.findAllByRole('button', { name: 'Show chat' }))[0]
    expect(show.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(show)
    expect(await screen.findByRole('complementary', { name: 'WhatsApp chat with Sarah Ahmed' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Hide chat' })[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }))
    expect(screen.queryByRole('complementary', { name: /WhatsApp chat/ })).toBeNull()
  })

  it('opens on the chat when asked to', async () => {
    renderPage('/leads/aff20913-1ea8-4e49-b3ab-f12bd983c413?tab=chat')
    expect(await screen.findByRole('complementary', { name: /WhatsApp chat/ })).toBeTruthy()
  })
})

describe('LeadDetailPage — deleting', () => {
  const openMenuAndDelete = async () => {
    const menu = (await screen.findAllByRole('button', { name: 'More lead actions' }))[0]
    fireEvent.click(menu)
    fireEvent.click(screen.getAllByRole('menuitem', { name: 'Delete lead' })[0])
  }

  it('asks first, by name, and keeps the lead on cancel', async () => {
    renderPage()
    await openMenuAndDelete()
    const dialog = await screen.findByRole('dialog', { name: 'Delete Sarah Ahmed?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.deleteLead).not.toHaveBeenCalled()
  })

  it('deletes after confirmation and returns to the list', async () => {
    m.deleteLead.mockResolvedValue(undefined)
    renderPage()
    await openMenuAndDelete()
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete lead' }))
    await waitFor(() => expect(m.deleteLead).toHaveBeenCalledWith('aff20913-1ea8-4e49-b3ab-f12bd983c413'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/leads/package'))
  })
})

describe('LeadDetailPage — loading and failure', () => {
  it('shows a loading placeholder, not a blank page', () => {
    m.fetchLeadById.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading lead' }).getAttribute('aria-busy')).toBe('true')
  })

  it('says the lead could not be loaded, and offers the way back', async () => {
    m.fetchLeadById.mockRejectedValue(new Error('Lead not found'))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'This lead could not be loaded' })).toBeTruthy()
    expect(screen.getByText('Lead not found')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to leads' })).toBeTruthy()
  })
})
