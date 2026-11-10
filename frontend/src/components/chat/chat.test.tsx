import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Thread } from '../../lib/inbox'
import ChatComposer from './ChatComposer'
import ChatThreadList from './ChatThreadList'
import MessageBubble from './MessageBubble'

const thread = (over: Partial<Thread>): Thread => ({
  id: 't1', kind: 'customer', title: 'Sarah Ahmed', subtitle: '', last_message: 'Can we keep breakfast included?',
  last_at: null, last_direction: 'inbound', lead_id: 'l1', lifecycle_status: 'comparing', ...over,
})

describe('MessageBubble', () => {
  it('shows the message and its time', () => {
    render(<MessageBubble direction="inbound" body="Hello there" time="10:42" />)
    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.getByText('10:42')).toBeTruthy()
  })

  it('tells us how far an outgoing message got, and says nothing about incoming ones', () => {
    const { rerender } = render(<MessageBubble direction="outbound" body="x" delivery="sent" />)
    expect(screen.getByRole('img', { name: 'Sent' })).toBeTruthy()
    rerender(<MessageBubble direction="outbound" body="x" delivery="delivered" />)
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeTruthy()
    rerender(<MessageBubble direction="inbound" body="x" delivery="none" />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says a message was not delivered, in words, with a way to retry', () => {
    const onRetry = vi.fn()
    render(<MessageBubble direction="outbound" body="Quote v1" delivery="failed" onRetry={onRetry} />)
    expect(screen.getByText(/Not delivered/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers no retry when it cannot be retried', () => {
    render(<MessageBubble direction="outbound" body="x" delivery="failed" />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('names the sender in a group and labels voice transcripts', () => {
    render(<MessageBubble direction="inbound" body="rates attached" sender="Hassan" voice />)
    expect(screen.getByText('Hassan')).toBeTruthy()
    expect(screen.getByText(/Voice message/)).toBeTruthy()
  })

  it('labels a poll the bot sent and the customer’s vote', () => {
    render(
      <>
        <MessageBubble direction="outbound" body={'📊 Hotel X — choose one option:\n○ 7 nights · USD 700'} poll="sent" />
        <MessageBubble direction="inbound" body="7 nights · USD 700" poll="vote" />
      </>,
    )
    expect(screen.getByText('WhatsApp poll')).toBeTruthy()
    expect(screen.getByText('Poll vote')).toBeTruthy()
  })
})

describe('ChatThreadList', () => {
  it('shows each conversation with its type, lead stage and a "You:" preview for ours', () => {
    render(
      <ChatThreadList
        activeId={null}
        onSelect={() => {}}
        threads={[
          thread({}),
          thread({ id: 't2', kind: 'dealer', title: 'Atlas Holidays', last_message: 'USD 1,860 net', lifecycle_status: undefined, lead_id: undefined }),
          thread({ id: 't3', title: 'Daniel', last_message: 'Quote v1.pdf', last_direction: 'outbound' }),
        ]}
      />,
    )
    const rows = screen.getAllByRole('button')
    expect(within(rows[0]).getByText('Customer')).toBeTruthy()
    expect(within(rows[0]).getByText('Comparing')).toBeTruthy()
    expect(within(rows[1]).getByText('Dealer')).toBeTruthy()
    expect(within(rows[2]).getByText('You: Quote v1.pdf')).toBeTruthy()
  })

  it('flags a customer number that has no lead yet', () => {
    render(
      <ChatThreadList
        activeId={null}
        onSelect={() => {}}
        threads={[thread({ title: '+971 55 908 2231', lead_id: undefined, lifecycle_status: 'intake' })]}
      />,
    )
    expect(screen.getByText('No lead')).toBeTruthy()
    expect(screen.queryByText('Intake')).toBeNull()
  })

  it('marks the open conversation and reports a click', () => {
    const onSelect = vi.fn()
    const target = thread({ id: 'open' })
    render(<ChatThreadList activeId="open" onSelect={onSelect} threads={[target, thread({ id: 'other', title: 'Other' })]} />)
    const rows = screen.getAllByRole('button')
    expect(rows[0].getAttribute('aria-current')).toBe('true')
    expect(rows[1].getAttribute('aria-current')).toBeNull()
    fireEvent.click(rows[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' }))
  })

  it('shows review-pending dealer replies', () => {
    render(<ChatThreadList activeId={null} onSelect={() => {}} threads={[thread({ kind: 'dealer', pending_response_id: 'r1' })]} />)
    expect(screen.getByText('Review pending')).toBeTruthy()
  })

  it('has a loading state and an empty state that says what to do', () => {
    const { rerender } = render(<ChatThreadList activeId={null} onSelect={() => {}} threads={[]} loading />)
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
    rerender(<ChatThreadList activeId={null} onSelect={() => {}} threads={[]} emptyMessage="No dealer conversations in this filter. Try All." />)
    expect(screen.getByText('No dealer conversations in this filter. Try All.')).toBeTruthy()
  })
})

describe('ChatComposer', () => {
  it('sends on Enter, keeps Shift+Enter for a new line, and clears after sending', async () => {
    const onSend = vi.fn(() => Promise.resolve())
    render(<ChatComposer onSend={onSend} label="Message Sarah" />)
    const box = screen.getByRole('textbox', { name: 'Message Sarah' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello'))
    await vi.waitFor(() => expect(box.value).toBe(''))
  })

  it('keeps what you typed and says why when sending fails', async () => {
    render(<ChatComposer onSend={() => Promise.reject(new Error('WhatsApp is disconnected'))} />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toContain('WhatsApp is disconnected')
    expect(box.value).toBe('Hi')
  })

  it('will not send an empty message', () => {
    const onSend = vi.fn(() => Promise.resolve())
    render(<ChatComposer onSend={onSend} />)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('drops a canned reply into the box for editing, without sending it', () => {
    const onSend = vi.fn(() => Promise.resolve())
    render(<ChatComposer onSend={onSend} quickReplies />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dates' }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/confirm your travel dates/)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('appends a second canned reply rather than replacing the first', () => {
    render(<ChatComposer onSend={() => Promise.resolve()} quickReplies />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask for passport names' }))
    const text = (screen.getByRole('textbox') as HTMLTextAreaElement).value
    expect(text).toMatch(/travel dates/)
    expect(text).toMatch(/passports/)
  })

  it('offers canned replies only where asked', () => {
    render(<ChatComposer onSend={() => Promise.resolve()} />)
    expect(screen.queryByRole('button', { name: 'Confirm dates' })).toBeNull()
  })
})
