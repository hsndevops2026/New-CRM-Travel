import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ContactsPage from './ContactsPage'
import { setLanguage } from '../lib/i18n'

vi.mock('../hooks/useSearch', () => ({ useSearch: () => ({ query: '', setPlaceholder: () => {} }) }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../lib/leads', async (orig) => ({ ...(await orig<typeof import('../lib/leads')>()), fetchLeads: async () => [] }))
vi.mock('../lib/inbox', async (orig) => ({ ...(await orig<typeof import('../lib/inbox')>()), fetchThreads: async () => [] }))

const api = vi.hoisted(() => ({ fetchContacts: vi.fn(), deleteContact: vi.fn() }))
vi.mock('../lib/contacts', async (orig) => ({
  ...(await orig<typeof import('../lib/contacts')>()),
  fetchContacts: api.fetchContacts,
  deleteContact: api.deleteContact,
}))

describe('ContactsPage delete', () => {
  beforeAll(() => setLanguage('en'))
  beforeEach(() => {
    vi.clearAllMocks()
    api.fetchContacts.mockResolvedValue([
      { id: 'c1', name: 'Rana Ahmed', phone: '972521234567', created_at: '2026-11-01T10:00:00Z' },
      { id: 'c2', name: 'Omar Saleh', phone: '972529876543', created_at: '2026-11-02T10:00:00Z' },
    ])
    api.deleteContact.mockResolvedValue(undefined)
  })

  it('each row has a delete button that asks first, then removes only that contact', async () => {
    render(<MemoryRouter><ContactsPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Rana Ahmed' }))

    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'))
    expect(api.deleteContact).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete contact' }))

    await waitFor(() => expect(api.deleteContact).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(screen.queryByText('Rana Ahmed')).toBeNull())
    expect(screen.getByText('Omar Saleh')).toBeTruthy()
  })
})
