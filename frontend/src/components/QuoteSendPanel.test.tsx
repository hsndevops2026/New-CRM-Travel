import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuoteSendPanel from './QuoteSendPanel'
import * as versionsLib from '../lib/quoteVersions'
import type { QuoteDraft } from '../lib/quoteDrafts'

vi.mock('../lib/quoteVersions', async () => {
  const actual = await vi.importActual<typeof versionsLib>('../lib/quoteVersions')
  return {
    ...actual,
    fetchVersions: vi.fn(),
    lockVersion: vi.fn(),
    sendVersion: vi.fn(),
    fetchDeliveries: vi.fn(),
    retryDelivery: vi.fn(),
    revokeVersion: vi.fn(),
    openVersionPdf: vi.fn(),
    reviewVersion: vi.fn(),
  }
})

const auth = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ admin: { id: 'me', role: auth.role } }) }))

const m = {
  fetchVersions: vi.mocked(versionsLib.fetchVersions),
  lockVersion: vi.mocked(versionsLib.lockVersion),
  sendVersion: vi.mocked(versionsLib.sendVersion),
  fetchDeliveries: vi.mocked(versionsLib.fetchDeliveries),
  retryDelivery: vi.mocked(versionsLib.retryDelivery),
  revokeVersion: vi.mocked(versionsLib.revokeVersion),
  openVersionPdf: vi.mocked(versionsLib.openVersionPdf),
}

const version = (n: number, over: Partial<versionsLib.QuoteVersion> = {}): versionsLib.QuoteVersion => ({
  id: `v${n}`, quote_draft_id: 'd', lead_id: 'l', version_number: n, selling_price: 2298 as never, currency: 'USD', status: 'sent',
  accepted_at: null, accepted_by: null, notes: null, created_by: null, created_at: '2026-10-21T13:58:00Z',
  snapshot: { title: 'Istanbul family winter break', version_number: n, currency: 'USD', notes: null, valid_until: null, lead: { id: 'l' }, items: [{ label: 'Turkish Airlines direct' }, { label: 'Bosphorus Grand Hotel' }] as never, pricing: { gross_margin_pct: 13.82 } as never, markup_type: 'percent', markup_value: 12 },
  ...over,
})

const delivery = (over: Partial<versionsLib.QuoteDelivery>): versionsLib.QuoteDelivery => ({
  id: 'dl1', quote_version_id: 'v2', channel: 'whatsapp', recipient: '+971501234567', status: 'delivered', provider_id: null, error_message: null,
  attempt_count: 1, sent_at: '2026-10-21T14:05:00Z', created_at: '2026-10-21T14:05:00Z', updated_at: '', ...over,
})

const draftWith = (n: number) => ({ currency: 'USD', items: Array.from({ length: n }, (_, i) => ({ id: `i${i}` })), pricing: { selling_price: 2298 } }) as unknown as QuoteDraft

const renderPanel = (props: Partial<React.ComponentProps<typeof QuoteSendPanel>> = {}) =>
  render(<QuoteSendPanel leadId="l" leadPhone="971501234567" draft={draftWith(2)} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  m.fetchVersions.mockResolvedValue([version(2), version(1, { status: 'revoked' })])
  m.fetchDeliveries.mockResolvedValue([])
})

describe('QuoteSendPanel — versions', () => {
  it('shows the newest first, the live one as Current, and a revoked one struck through', async () => {
    renderPanel()
    const current = await screen.findByRole('article', { name: 'Version 2, current' })
    expect(within(current).getByText('Current')).toBeTruthy()
    expect(within(current).getByText('Turkish Airlines direct · Bosphorus Grand Hotel')).toBeTruthy()
    expect(within(current).getByText('Margin 13.82% · internal')).toBeTruthy()
    const revoked = screen.getByRole('article', { name: 'Version 1, revoked' })
    expect(within(revoked).getByText('Revoked').className).toMatch(/line-through/)
    expect(within(revoked).queryByRole('button', { name: /Send v1/ })).toBeNull()
    const titles = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))
    expect(titles).toEqual(['Version 2, current', 'Version 1, revoked'])
  })

  it('formats the price from the string the database returns', async () => {
    renderPanel()
    const current = await screen.findByRole('article', { name: 'Version 2, current' })
    expect(current.textContent).toMatch(/2,298/)
    expect(current.textContent).not.toMatch(/2298\.0/)
  })

  it('calls a locked version "locked", not "sent"', async () => {
    renderPanel()
    const current = await screen.findByRole('article', { name: 'Version 2, current' })
    expect(within(current).getByText('Locked')).toBeTruthy()
    expect(within(current).queryByText('Sent')).toBeNull()
  })

  it('shows acceptance with who and when, instead of "awaiting"', async () => {
    m.fetchVersions.mockResolvedValue([version(2, { status: 'accepted', accepted_at: '2026-10-21T14:12:00Z', accepted_by: 'Sarah Ahmed' })])
    renderPanel()
    expect(await screen.findByText('Accepted v2')).toBeTruthy()
    expect(screen.queryByText('Awaiting response')).toBeNull()
    expect(screen.getAllByText(/Sarah Ahmed/).length).toBeGreaterThan(0)
  })

  it('waits for a response when nothing has been accepted', async () => {
    renderPanel()
    expect(await screen.findByText('Awaiting response')).toBeTruthy()
  })
})

describe('QuoteSendPanel — locking', () => {
  it('locks the draft at its price, with the note, and selects the new version for sending', async () => {
    m.fetchVersions.mockResolvedValueOnce([]).mockResolvedValue([version(1)])
    m.lockVersion.mockResolvedValue(version(1))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Note for this version'), { target: { value: 'Final' } })
    fireEvent.click(screen.getByRole('button', { name: /Lock v1/ }))
    await waitFor(() => expect(m.lockVersion).toHaveBeenCalledWith('l', 'Final'))
    expect(await screen.findByRole('heading', { name: 'Send v1' })).toBeTruthy()
  })

  it('will not lock an empty draft, and says what to do first', async () => {
    renderPanel({ draft: draftWith(0) })
    expect(await screen.findByText(/Select items in Build first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Lock v/ })).toBeNull()
  })

  it('shows why locking failed', async () => {
    m.lockVersion.mockRejectedValue(new Error('Nothing to lock'))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Lock v3/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing to lock')
  })
})

describe('QuoteSendPanel — sending', () => {
  it('sends the current version to the customer’s number and shows the link to copy', async () => {
    m.sendVersion.mockResolvedValue({ delivery_id: 'dl9', token: 't', share_link: 'https://q.example/q/abc', status: 'sent' })
    m.fetchDeliveries.mockResolvedValueOnce([]).mockResolvedValue([delivery({ status: 'sent' })])
    renderPanel()
    const to = (await screen.findByLabelText('To')) as HTMLInputElement
    expect(to.value).toBe('+971501234567')
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }))
    await waitFor(() => expect(m.sendVersion).toHaveBeenCalledWith('v2', { channel: 'whatsapp', recipient: '+971501234567' }))
    expect(((await screen.findByLabelText('Share link')) as HTMLInputElement).value).toBe('https://q.example/q/abc')
    expect(await screen.findByText('WhatsApp sent')).toBeTruthy()
  })

  it('switches to email, with no address until one is typed', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('tab', { name: 'Email' }))
    const to = screen.getByLabelText('To') as HTMLInputElement
    expect(to.value).toBe('')
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/no email on this lead/)).toBeTruthy()
    fireEvent.change(to, { target: { value: 'sarah@example.com' } })
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('tells the agent when sending fails', async () => {
    m.sendVersion.mockRejectedValue(new Error('WhatsApp session is disconnected'))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }))
    expect((await screen.findByRole('alert')).textContent).toContain('WhatsApp session is disconnected')
  })

  it('shows delivery history newest first, ending with the version being created', async () => {
    m.fetchDeliveries.mockResolvedValue([
      delivery({ id: 'a', status: 'sent', sent_at: '2026-10-21T14:05:00Z' }),
      delivery({ id: 'b', channel: 'email', recipient: 'sarah@gmial.com', status: 'failed', error_message: 'mailbox not found', sent_at: '2026-10-21T14:06:00Z' }),
    ])
    renderPanel()
    const history = await screen.findByRole('heading', { name: 'Delivery history' })
    const items = await within(history.closest('section') as HTMLElement).findAllByRole('listitem')
    expect(items[0].textContent).toContain('Email failed')
    expect(items[0].textContent).toContain('mailbox not found')
    expect(items[1].textContent).toContain('WhatsApp sent')
    expect(items[2].textContent).toContain('v2 created')
  })

  it('retries a failed delivery from the history and refreshes it', async () => {
    m.fetchDeliveries.mockResolvedValueOnce([delivery({ id: 'f1', status: 'failed', error_message: 'timeout' })]).mockResolvedValue([delivery({ id: 'f1', status: 'delivered' })])
    m.retryDelivery.mockResolvedValue({ status: 'sent' })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(m.retryDelivery).toHaveBeenCalledWith('f1'))
    expect(await screen.findByText('WhatsApp delivered')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('QuoteSendPanel — revoking', () => {
  it('asks first, naming the version and what happens to the customer’s link', async () => {
    renderPanel()
    const card = await screen.findByRole('article', { name: 'Version 2, current' })
    fireEvent.click(within(card).getByRole('button', { name: 'More actions for v2' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke share links' }))
    const dialog = await screen.findByRole('dialog', { name: 'Revoke quote v2?' })
    expect(dialog.textContent).toContain('This quote has been replaced')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.revokeVersion).not.toHaveBeenCalled()
  })

  it('revokes once confirmed and marks the version revoked', async () => {
    m.revokeVersion.mockResolvedValue(undefined)
    renderPanel()
    const card = await screen.findByRole('article', { name: 'Version 2, current' })
    fireEvent.click(within(card).getByRole('button', { name: 'More actions for v2' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke share links' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke v2' }))
    await waitFor(() => expect(m.revokeVersion).toHaveBeenCalledWith('v2'))
    expect(await screen.findByRole('article', { name: 'Version 2, revoked' })).toBeTruthy()
  })

  it('offers no revoke on an accepted version', async () => {
    m.fetchVersions.mockResolvedValue([version(2, { status: 'accepted', accepted_at: '2026-10-21T14:12:00Z' })])
    renderPanel()
    const card = await screen.findByRole('article', { name: /Version 2/ })
    expect(within(card).queryByRole('button', { name: /More actions/ })).toBeNull()
  })
})

describe('QuoteSendPanel — manager approval', () => {
  beforeEach(() => {
    auth.role = 'admin'
  })

  it('lets a manager approve a pending quote, then it can be sent', async () => {
    m.fetchVersions.mockResolvedValue([version(1, { approval_status: 'pending' })])
    vi.mocked(versionsLib.reviewVersion).mockResolvedValue(version(1, { approval_status: 'approved' }))
    renderPanel()
    expect(await screen.findByText('Waiting for manager approval')).toBeTruthy()
    expect(screen.getByText(/waiting for a manager to approve it/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(versionsLib.reviewVersion).toHaveBeenCalledWith(expect.any(String), 'approved', undefined))
    expect(await screen.findByText('Approved by manager')).toBeTruthy()
    expect(screen.queryByText(/waiting for a manager to approve it/)).toBeNull()
  })

  it('a manager must say what to change before sending it back', async () => {
    m.fetchVersions.mockResolvedValue([version(1, { approval_status: 'pending' })])
    vi.mocked(versionsLib.reviewVersion).mockResolvedValue(version(1, { approval_status: 'rejected', review_note: 'Raise the margin' }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for changes' }))
    const send = screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'What needs changing?' }), { target: { value: 'Raise the margin' } })
    fireEvent.click(send)
    expect(await screen.findByText('Raise the margin')).toBeTruthy()
    expect(screen.getByText(/asked for changes to v1/)).toBeTruthy()
  })

  it('an employee sees the quote is waiting, with no approve button', async () => {
    auth.role = 'agent'
    m.fetchVersions.mockResolvedValue([version(1, { approval_status: 'pending' })])
    renderPanel()
    expect(await screen.findByText('Waiting for manager approval')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Send v1/ })).toBeNull()
  })
})
