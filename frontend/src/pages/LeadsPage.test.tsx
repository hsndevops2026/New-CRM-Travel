import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LeadsPage from './LeadsPage'
import { SearchProvider } from '../context/SearchProvider'
import * as leadsLib from '../lib/leads'

vi.mock('../lib/leads', async () => {
  const actual = await vi.importActual<typeof leadsLib>('../lib/leads')
  return { ...actual, fetchLeads: vi.fn() }
})

const fetchLeads = vi.mocked(leadsLib.fetchLeads)

let seq = 0
function lead(overrides: Partial<leadsLib.Lead> = {}): leadsLib.Lead {
  seq += 1
  return {
    id: `lead-${seq}`,
    phone: `97150000${String(seq).padStart(4, '0')}`,
    booking_type: 'hotel',
    origin: null,
    destination: 'Istanbul',
    travel_date: '2027-01-10',
    return_date: '2027-01-14',
    nights: 4,
    adults_count: 2,
    children_count: 0,
    children_ages: [],
    budget: null,
    hotel_name: null,
    notes: null,
    summary: null,
    contact_name: `Customer ${seq}`,
    lifecycle_status: 'comparing',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderPage(segment = 'hotel') {
  return render(
    <SearchProvider>
      <MemoryRouter initialEntries={[`/leads/${segment}`]}>
        <Routes>
          <Route path="/leads/:segment" element={<LeadsPage />} />
          <Route path="/leads/:id/detail" element={<div>detail</div>} />
        </Routes>
      </MemoryRouter>
    </SearchProvider>,
  )
}

beforeEach(() => {
  seq = 0
  Element.prototype.scrollIntoView = vi.fn()
})

describe('LeadsPage — design system header and lead types', () => {
  it('shows a count on every lead type and bolds the totals', async () => {
    fetchLeads.mockResolvedValue([
      lead(), lead(), lead({ booking_type: 'flight', origin: 'Mumbai' }), lead({ booking_type: 'package' }),
    ])
    renderPage('hotel')

    const types = await screen.findByRole('tablist', { name: 'Lead type' })
    expect(within(types).getByRole('tab', { name: /Hotel\s*2/ })).toBeTruthy()
    expect(within(types).getByRole('tab', { name: /Flight\s*1/ })).toBeTruthy()
    expect(within(types).getByRole('tab', { name: /Package\s*1/ })).toBeTruthy()
    expect(within(types).getByRole('tab', { name: /Hotel/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('2', { selector: 'strong' })).toBeTruthy()
  })

  it('says how many were created today', async () => {
    fetchLeads.mockResolvedValue([lead(), lead({ created_at: '2020-01-01T10:00:00Z' })])
    renderPage()
    expect(await screen.findByText('1 created today')).toBeTruthy()
  })

  it('shows each lead’s stage as a lifecycle badge in the table', async () => {
    fetchLeads.mockResolvedValue([lead({ lifecycle_status: 'awaiting_dealers' })])
    renderPage()
    expect(await screen.findByText('Awaiting dealers')).toBeTruthy()
  })
})

describe('LeadsPage — board', () => {
  async function openBoard() {
    fireEvent.click(await screen.findByRole('tab', { name: /Board/ }))
    return screen.findByRole('region', { name: 'Leads by stage' })
  }

  it('has a column for each active stage — eight, with no Booked column', async () => {
    fetchLeads.mockResolvedValue([lead()])
    renderPage()
    const board = await openBoard()

    for (const name of [
      'intake', 'sourcing', 'awaiting dealers', 'comparing', 'drafting', 'ready to send', 'sent', 'accepted',
    ]) {
      expect(within(board).getByRole('region', { name: `${name} leads` })).toBeTruthy()
    }
    expect(within(board).queryByRole('region', { name: /booked leads/ })).toBeNull()
  })

  it('puts a lead in the column of its exact stage, with its next action', async () => {
    fetchLeads.mockResolvedValue([
      lead({ contact_name: 'Sarah Ahmed', lifecycle_status: 'comparing' }),
      lead({ contact_name: 'Priya Nair', lifecycle_status: 'awaiting_dealers' }),
    ])
    renderPage()
    const board = await openBoard()

    const comparing = within(within(board).getByRole('region', { name: 'comparing leads' }))
    expect(comparing.getByText('Sarah Ahmed')).toBeTruthy()
    expect(comparing.getByText('Build quote')).toBeTruthy()
    expect(comparing.queryByText('Priya Nair')).toBeNull()

    const awaiting = within(within(board).getByRole('region', { name: 'awaiting dealers leads' }))
    expect(awaiting.getByText('Priya Nair')).toBeTruthy()
    expect(awaiting.getByText('Awaiting dealer replies')).toBeTruthy()
  })

  it('keeps lost, archived and booked leads off the board', async () => {
    // Regression: every lead outside the path was dumped into the Intake column.
    fetchLeads.mockResolvedValue([
      lead({ contact_name: 'Lost Larry', lifecycle_status: 'lost' }),
      lead({ contact_name: 'Archived Ann', lifecycle_status: 'archived' }),
      lead({ contact_name: 'Booked Bob', lifecycle_status: 'booked' }),
      lead({ contact_name: 'Intake Ian', lifecycle_status: 'intake' }),
    ])
    renderPage()
    const board = await openBoard()

    expect(within(board).getByText('Intake Ian')).toBeTruthy()
    expect(within(board).queryByText('Lost Larry')).toBeNull()
    expect(within(board).queryByText('Archived Ann')).toBeNull()
    expect(within(board).queryByText('Booked Bob')).toBeNull()
  })

  it('treats a lead with no stage as intake', async () => {
    fetchLeads.mockResolvedValue([lead({ contact_name: 'New Nora', lifecycle_status: null })])
    renderPage()
    const board = await openBoard()
    expect(within(within(board).getByRole('region', { name: 'intake leads' })).getByText('New Nora')).toBeTruthy()
  })

  it('shows a failed search in red as something that needs a person', async () => {
    fetchLeads.mockResolvedValue([lead({ lifecycle_status: 'sourcing', quote_status: 'error' })])
    renderPage()
    const board = await openBoard()

    const blocker = within(board).getByText('Search failed · retry sourcing')
    expect(blocker.className).toContain('text-danger')
  })

  it('links each card to its lead', async () => {
    fetchLeads.mockResolvedValue([lead({ contact_name: 'Sarah Ahmed' })])
    renderPage()
    const board = await openBoard()
    const card = within(board).getByText('Sarah Ahmed').closest('a')
    expect(card?.getAttribute('href')).toMatch(/^\/leads\/lead-\d+$/)
  })
})

describe('SegmentedControl keyboard use', () => {
  it('moves between lead types with the arrow keys', async () => {
    fetchLeads.mockResolvedValue([lead()])
    renderPage('hotel')
    const hotel = await screen.findByRole('tab', { name: /Hotel/ })
    hotel.focus()
    fireEvent.keyDown(hotel, { key: 'ArrowRight' })
    // Moving right from Hotel selects Flight (the router then re-renders on /leads/flight).
    expect(await screen.findByRole('tab', { name: /Flight/ })).toBeTruthy()
  })
})
