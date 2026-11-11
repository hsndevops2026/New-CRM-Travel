import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmailPage from './EmailPage'
import ContactEmailsPanel from '../components/email/ContactEmailsPanel'

const api = vi.hoisted(() => ({
  status: vi.fn(), accounts: vi.fn(), list: vi.fn(), get: vi.fn(), send: vi.fn(), contact: vi.fn(), connect: vi.fn(),
}))
vi.mock('../lib/email', async (orig) => ({
  ...(await orig<typeof import('../lib/email')>()),
  fetchEmailStatus: api.status,
  fetchEmailAccounts: api.accounts,
  fetchEmails: api.list,
  fetchEmail: api.get,
  sendEmail: api.send,
  fetchContactEmails: api.contact,
  startGmailConnect: api.connect,
}))

const account = { id: 'acc1', email: 'agent@agency.com', is_default: true, created_at: '' }
const summary = { id: 'm1', threadId: 't1', from: 'Rana <rana@example.com>', to: 'agent@agency.com', subject: 'Booking Istanbul',
  date: '2026-11-01T10:00:00Z', snippet: 'Hello', isUnread: true, isSent: false }

function renderPage(url = '/email') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/email" element={<EmailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('EmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.status.mockResolvedValue({ configured: true })
    api.accounts.mockResolvedValue([account])
    api.list.mockResolvedValue({ messages: [summary], nextPageToken: null })
    api.get.mockResolvedValue({ ...summary, body: { text: null, html: '<p>Hi</p><script>alert(1)</script>' }, attachments: [] })
  })

  it('tells the admin when Google is not configured', async () => {
    api.status.mockResolvedValue({ configured: false })
    renderPage()
    expect(await screen.findByText('Gmail is not set up on the server yet')).toBeTruthy()
  })

  it('lists the inbox and shows HTML mail in a sandbox without scripts', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Booking Istanbul'))
    const frame = await screen.findByTitle('Booking Istanbul')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(api.get).toHaveBeenCalledWith('acc1', 'm1')
  })

  it('replies to the sender', async () => {
    api.send.mockResolvedValue({ id: 's1', threadId: 't1' })
    renderPage()
    fireEvent.click(await screen.findByText('Booking Istanbul'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    expect((screen.getByRole('textbox', { name: 'To' }) as HTMLInputElement).value).toBe('rana@example.com')
    expect((screen.getByRole('textbox', { name: 'Subject' }) as HTMLInputElement).value).toBe('Re: Booking Istanbul')
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Thanks!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(api.send).toHaveBeenCalledWith({ accountId: 'acc1', to: 'rana@example.com', subject: 'Re: Booking Istanbul', body: 'Thanks!' }))
    expect(await screen.findByText('Email sent.')).toBeTruthy()
  })

  it('shows the result of the Google sign-in', async () => {
    renderPage('/email?error=access_denied')
    expect(await screen.findByText('Google access was not granted.')).toBeTruthy()
  })
})

describe('ContactEmailsPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks to connect Gmail when the employee has none', async () => {
    api.contact.mockResolvedValue({ connected: false, messages: [], nextPageToken: null })
    render(<MemoryRouter><ContactEmailsPanel contactId="c1" contactEmail="rana@example.com" /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Connect Gmail' })).toBeTruthy()
  })

  it('lists emails with the customer', async () => {
    api.contact.mockResolvedValue({ connected: true, account: { id: 'acc1', email: 'agent@agency.com' }, messages: [summary], nextPageToken: null })
    render(<MemoryRouter><ContactEmailsPanel contactId="c1" contactEmail="rana@example.com" /></MemoryRouter>)
    expect(await screen.findByText('Booking Istanbul')).toBeTruthy()
  })
})
