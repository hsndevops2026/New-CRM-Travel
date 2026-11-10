import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionsPage from './PermissionsPage'
import * as apiLib from '../lib/api'

const auth = vi.hoisted(() => ({ value: { admin: { id: 'a', email: 'admin@h.ae', role: 'admin' } as unknown, loading: false } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof apiLib>('../lib/api')
  return { ...actual, apiJson: vi.fn() }
})

const apiJson = vi.mocked(apiLib.apiJson)

type U = { id: string; email: string; approval_status: string; lead_credits: number; leads_used: number; created_at: string }
const users = (): U[] => [
  { id: 'p1', email: 'omar.haddad@h.ae', approval_status: 'pending', lead_credits: 3, leads_used: 0, created_at: '2026-10-22T09:14:00Z' },
  { id: 'p2', email: 'nadia.farouk@h.ae', approval_status: 'pending', lead_credits: 3, leads_used: 0, created_at: '2026-10-21T09:14:00Z' },
  { id: 'a1', email: 'karim.saleh@h.ae', approval_status: 'approved', lead_credits: 100, leads_used: 41, created_at: '2026-06-01T00:00:00Z' },
  { id: 'r1', email: 'temp@outlook.com', approval_status: 'revoked', lead_credits: 3, leads_used: 0, created_at: '2026-08-01T00:00:00Z' },
]

let list: U[]
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/permissions']}>
      <Routes>
        <Route path="/permissions" element={<PermissionsPage />} />
        <Route path="/leads/hotel" element={<div>leads home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  list = users()
  auth.value = { admin: { id: 'a', email: 'admin@h.ae', role: 'admin' }, loading: false }
  apiJson.mockReset()
  apiJson.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/permissions/users' && !init) return { users: list } as never
    if (/\/approval$/.test(path)) {
      const id = path.split('/')[4]
      const { status } = JSON.parse(String(init?.body))
      list = list.map((u) => (u.id === id ? { ...u, approval_status: status } : u))
      return {} as never
    }
    if (/\/credits$/.test(path)) return {} as never
    throw new Error(`unexpected ${path}`)
  })
})

describe('PermissionsPage', () => {
  it('keeps staff out unless they are admins', () => {
    auth.value = { admin: { id: 'g', email: 'g@h.ae', role: 'agent' }, loading: false }
    renderPage()
    expect(screen.getByText('leads home')).toBeTruthy()
  })

  it('opens on Pending when there are requests, with a count on each tab', async () => {
    renderPage()
    const tabs = await screen.findByRole('tablist', { name: 'Account status' })
    expect(within(tabs).getByRole('tab', { name: /Pending\s*2/ }).getAttribute('aria-selected')).toBe('true')
    expect(within(tabs).getByRole('tab', { name: /Approved\s*1/ })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: /Blocked \/ rejected\s*1/ })).toBeTruthy()
    expect(screen.getByText('omar.haddad@h.ae')).toBeTruthy()
    expect(screen.queryByText('karim.saleh@h.ae')).toBeNull()
  })

  it('shows the newest request first', async () => {
    renderPage()
    await screen.findByText('omar.haddad@h.ae')
    const emails = screen.getAllByText(/@h\.ae$/).map((el) => el.textContent)
    expect(emails.indexOf('omar.haddad@h.ae')).toBeLessThan(emails.indexOf('nadia.farouk@h.ae'))
  })

  it('approves a request straight away and moves them to Approved', async () => {
    renderPage()
    const row = (await screen.findByText('omar.haddad@h.ae')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(screen.queryByText('omar.haddad@h.ae')).toBeNull())
    expect(apiJson).toHaveBeenCalledWith('/api/permissions/users/p1/approval', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }))
    expect(screen.getByRole('tab', { name: /Approved\s*2/ })).toBeTruthy()
  })

  it('asks before rejecting, and does nothing if the admin keeps them', async () => {
    renderPage()
    const row = (await screen.findByText('omar.haddad@h.ae')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject omar.haddad@h.ae?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiJson).not.toHaveBeenCalledWith(expect.stringContaining('/approval'), expect.anything())
    expect(screen.getByText('omar.haddad@h.ae')).toBeTruthy()
  })

  it('rejects once confirmed', async () => {
    renderPage()
    const row = (await screen.findByText('omar.haddad@h.ae')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(screen.queryByText('omar.haddad@h.ae')).toBeNull())
    expect(apiJson).toHaveBeenCalledWith('/api/permissions/users/p1/approval', expect.objectContaining({ body: JSON.stringify({ status: 'revoked' }) }))
  })

  it('blocks approved staff only after confirming, and can restore them without asking', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Approved/ }))
    const row = (await screen.findByText('karim.saleh@h.ae')).closest('tr') as HTMLElement
    expect(within(row).getByText('Active')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Block' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Block karim.saleh@h.ae?' })).getByRole('button', { name: 'Block access' }))
    await waitFor(() => expect(screen.queryByText('karim.saleh@h.ae')).toBeNull())

    fireEvent.click(screen.getByRole('tab', { name: /Blocked/ }))
    const blocked = (await screen.findByText('temp@outlook.com')).closest('tr') as HTMLElement
    expect(within(blocked).getByText('Blocked')).toBeTruthy()
    fireEvent.click(within(blocked).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(screen.queryByText('temp@outlook.com')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows credits left and used, and only lets approved staff be topped up', async () => {
    renderPage()
    expect((await screen.findByText('omar.haddad@h.ae')).closest('tr')?.textContent).not.toMatch(/Add$/)
    fireEvent.click(screen.getByRole('tab', { name: /Approved/ }))
    const row = (await screen.findByText('karim.saleh@h.ae')).closest('tr') as HTMLElement
    expect(row.textContent).toContain('59 left')
    expect(row.textContent).toContain('41 of 100 used')
    const meter = within(row).getByRole('progressbar')
    expect(meter.getAttribute('aria-valuenow')).toBe('41')
  })

  it('adds credits, clears the box, and refuses a bad amount', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Approved/ }))
    const row = (await screen.findByText('karim.saleh@h.ae')).closest('tr') as HTMLElement
    const amount = within(row).getByLabelText('Credits to add for karim.saleh@h.ae') as HTMLInputElement
    const add = within(row).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(amount, { target: { value: '2.5' } })
    fireEvent.click(add)
    expect((await screen.findByRole('alert')).textContent).toContain('positive whole number')
    expect(apiJson).not.toHaveBeenCalledWith(expect.stringContaining('/credits'), expect.anything())
    fireEvent.change(amount, { target: { value: '50' } })
    fireEvent.click(add)
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/permissions/users/a1/credits', expect.objectContaining({ body: JSON.stringify({ amount: 50 }) })))
    await waitFor(() => expect(amount.value).toBe(''))
  })

  it('filters by email within the tab and explains an empty result', async () => {
    renderPage()
    await screen.findByText('omar.haddad@h.ae')
    fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'nadia' } })
    expect(screen.queryByText('omar.haddad@h.ae')).toBeNull()
    expect(screen.getByText('nadia.farouk@h.ae')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'zzz' } })
    expect(screen.getByText('No account matches “zzz”')).toBeTruthy()
  })

  it('says what an empty tab means', async () => {
    list = list.filter((u) => u.approval_status !== 'pending')
    renderPage()
    await screen.findByText('karim.saleh@h.ae')
    fireEvent.click(screen.getByRole('tab', { name: /Pending/ }))
    expect(screen.getByText('No pending requests')).toBeTruthy()
    expect(screen.getByText('New sign-ups will appear here for approval.')).toBeTruthy()
  })

  it('shows the server’s message when an update fails, and leaves the list as it was', async () => {
    renderPage()
    const row = (await screen.findByText('omar.haddad@h.ae')).closest('tr') as HTMLElement
    apiJson.mockRejectedValueOnce(new Error('You cannot approve this account'))
    fireEvent.click(within(row).getByRole('button', { name: /Approve/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('You cannot approve this account')
    expect(screen.getByText('omar.haddad@h.ae')).toBeTruthy()
  })
})
