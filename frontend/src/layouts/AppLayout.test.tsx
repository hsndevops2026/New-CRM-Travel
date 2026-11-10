import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppLayout from './AppLayout'
import * as navCountsHook from '../hooks/useNavCounts'
import * as agencyLib from '../lib/agencySettings'

const auth = vi.hoisted(() => ({
  value: { admin: null as unknown, loading: false, logout: vi.fn(() => Promise.resolve()) },
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../hooks/useNavCounts', () => ({ useNavCounts: vi.fn() }))
vi.mock('../lib/agencySettings', async () => {
  const actual = await vi.importActual<typeof agencyLib>('../lib/agencySettings')
  return { ...actual, fetchAgencySettings: vi.fn() }
})

const useNavCounts = vi.mocked(navCountsHook.useNavCounts)
const fetchAgencySettings = vi.mocked(agencyLib.fetchAgencySettings)

const admin = { id: 'a1', email: 'layla.mansour@horizon.ae', role: 'admin', created_at: '' }
const agent = { id: 'g1', email: 'karim.saleh@horizon.ae', role: 'agent', lead_credits: 184, leads_used: 116, created_at: '' }

function renderAt(path = '/inbox') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/inbox" element={<div>inbox page</div>} />
          <Route path="/leads/:segment" element={<div>leads page</div>} />
          <Route path="/settings" element={<div>settings page</div>} />
        </Route>
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const mainNav = () => screen.getAllByRole('navigation', { name: 'Main navigation' })[0]

beforeEach(() => {
  auth.value = { admin, loading: false, logout: vi.fn(() => Promise.resolve()) }
  useNavCounts.mockReturnValue({ leads_open: 38, inbox_awaiting: 12, approvals_pending: 3, reminders_open: 0 })
  fetchAgencySettings.mockResolvedValue({
    agency_name: 'Horizon Travel', logo_url: null, primary_color: '#0f766e', quotation_template: 'classic',
    phone: null, email: null, website: null, address: null, quotation_footer: null,
  })
})

describe('AppLayout — navigation', () => {
  it('lists the work areas in design order, then the admin areas after a divider', () => {
    renderAt()
    const nav = mainNav()
    const labels = within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/\d+$/, '').trim())
    expect(labels).toEqual(['Inbox', 'Leads', 'Quotes', 'Dealers', 'Contacts', 'Reminders', 'Settings', 'Permissions'])
    expect(within(nav).getByRole('separator')).toBeTruthy()
  })

  it('hides Settings and Permissions from agents, and the divider with them', () => {
    auth.value = { ...auth.value, admin: agent }
    renderAt()
    const nav = mainNav()
    expect(within(nav).queryByRole('link', { name: /Settings/ })).toBeNull()
    expect(within(nav).queryByRole('link', { name: /Permissions/ })).toBeNull()
    expect(within(nav).queryByRole('separator')).toBeNull()
  })

  it('marks the current area for assistive tech — and Leads stays current on a lead page', () => {
    renderAt('/leads/package')
    expect(within(mainNav()).getByRole('link', { name: /Leads/ }).getAttribute('aria-current')).toBe('page')
    expect(within(mainNav()).getByRole('link', { name: /Inbox/ }).getAttribute('aria-current')).toBeNull()
  })

  it('shows what is waiting: inbox and leads for everyone, approvals only for admins', () => {
    renderAt()
    const nav = mainNav()
    expect(within(nav).getByRole('link', { name: /Inbox\s*12/ })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /Leads\s*38/ })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /Permissions\s*3/ })).toBeTruthy()
  })

  it('shows no badge for nothing waiting, and no numbers at all while they have not loaded', () => {
    useNavCounts.mockReturnValue({ leads_open: 0, inbox_awaiting: 0, approvals_pending: 0, reminders_open: 0 })
    const { unmount } = renderAt()
    expect(within(mainNav()).getByRole('link', { name: 'Inbox' })).toBeTruthy()
    expect(within(mainNav()).getByRole('link', { name: 'Permissions' })).toBeTruthy()
    unmount()
    useNavCounts.mockReturnValue(null)
    renderAt()
    expect(within(mainNav()).getByRole('link', { name: 'Leads' })).toBeTruthy()
  })

  it('only polls the counts once someone is signed in', () => {
    renderAt()
    expect(useNavCounts).toHaveBeenCalledWith(true)
    auth.value = { ...auth.value, admin: null }
    renderAt()
    expect(useNavCounts).toHaveBeenLastCalledWith(false)
  })
})

describe('AppLayout — brand and credits', () => {
  it('shows the agency name once settings load', async () => {
    fetchAgencySettings.mockResolvedValue({
      agency_name: 'Blue Crescent Travel', logo_url: null, primary_color: '#0f766e', quotation_template: 'classic',
      phone: null, email: null, website: null, address: null, quotation_footer: null,
    })
    renderAt()
    expect((await screen.findAllByText('Blue Crescent Travel')).length).toBeGreaterThan(0)
  })

  it('falls back to a default name when settings cannot be loaded', async () => {
    fetchAgencySettings.mockRejectedValue(new Error('offline'))
    renderAt()
    await waitFor(() => expect(fetchAgencySettings).toHaveBeenCalled())
    expect(screen.getAllByText('Horizon Travel').length).toBeGreaterThan(0)
  })

  it('shows an agent their credit meter, and admins none', () => {
    auth.value = { ...auth.value, admin: agent }
    const { unmount } = renderAt()
    const meter = screen.getByRole('meter', { name: 'Lead credits remaining' })
    expect(meter.getAttribute('aria-valuenow')).toBe('184')
    expect(meter.getAttribute('aria-valuemax')).toBe('300')
    expect(screen.getByText('116 used · 184 left')).toBeTruthy()
    unmount()
    auth.value = { ...auth.value, admin }
    renderAt()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})

describe('AppLayout — account menu', () => {
  it('opens with the person, role and a Sign out that signs out and goes to the login page', async () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('layla.mansour@horizon.ae')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    await screen.findByText('login page')
    expect(auth.value.logout).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and on a click outside', () => {
    renderAt()
    const button = screen.getByRole('button', { name: 'Account menu' })
    fireEvent.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(button)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('AppLayout — phone drawer', () => {
  it('opens from the menu button as a modal dialog, and closes on Escape', () => {
    renderAt()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Main menu' })
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(within(drawer).getByRole('link', { name: /Quotes/ })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when a destination is chosen', async () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Settings/ }))
    await screen.findByText('settings page')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not leave the page unscrollable after closing', () => {
    renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close menu' })[0])
    expect(document.body.style.overflow).toBe('')
  })
})
