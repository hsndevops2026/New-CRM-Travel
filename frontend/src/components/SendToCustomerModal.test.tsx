import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SendToCustomerModal from './SendToCustomerModal'
import * as quotesLib from '../lib/predefinedQuotes'

vi.mock('../lib/predefinedQuotes', async () => {
  const actual = await vi.importActual<typeof quotesLib>('../lib/predefinedQuotes')
  return { ...actual, sendQuoteToCustomer: vi.fn() }
})
const send = vi.mocked(quotesLib.sendQuoteToCustomer)
const quote = { id: 'q1', title: 'Istanbul Winter Family' } as quotesLib.PredefinedQuote

beforeEach(() => vi.clearAllMocks())

describe('SendToCustomerModal', () => {
  it('renders nothing when closed', () => {
    render(<SendToCustomerModal open={false} quote={quote} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cannot send until a number has been typed', () => {
    render(<SendToCustomerModal open quote={quote} onClose={() => {}} />)
    expect((screen.getByRole('button', { name: 'Send on WhatsApp' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '50 123 4567' } })
    expect((screen.getByRole('button', { name: 'Send on WhatsApp' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends to the country code plus number, with the note, and confirms where it went', async () => {
    send.mockResolvedValue({ sent: true, to: '+971501234567', quote_title: 'x' })
    const onSent = vi.fn()
    render(<SendToCustomerModal open quote={quote} onClose={() => {}} onSent={onSent} />)
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '050 123 4567' } })
    fireEvent.change(screen.getByLabelText(/Message before the package/), { target: { value: ' Hi Sarah ' } })
    expect(screen.getByText(/Sends to \+971501234567/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('q1', { phone: '971501234567', note: 'Hi Sarah' }))
    expect((await screen.findByRole('status')).textContent).toContain('+971501234567')
    expect(onSent).toHaveBeenCalledWith('+971501234567')
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).toBeNull()
  })

  it('omits an empty note', async () => {
    send.mockResolvedValue({ sent: true, to: '+971501234567', quote_title: 'x' })
    render(<SendToCustomerModal open quote={quote} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '501234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('q1', { phone: '971501234567', note: undefined }))
  })

  it('shows why sending failed and lets the agent fix the number and retry', async () => {
    send.mockRejectedValueOnce(new Error('WhatsApp session is disconnected'))
    render(<SendToCustomerModal open quote={quote} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '501234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }))
    expect((await screen.findByRole('alert')).textContent).toContain('disconnected')
    expect(screen.getByLabelText('Number')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send on WhatsApp' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
