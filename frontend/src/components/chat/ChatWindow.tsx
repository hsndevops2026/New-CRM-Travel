import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import ChatComposer from './ChatComposer'
import type { ChatMessage, ThreadDetail } from '../../lib/inbox'
import { reviewResponse } from '../../lib/dealers'
import EmptyState from '../ui/EmptyState'
import Button from '../ui/Button'
import { Briefcase, PanelRight } from 'lucide-react'
import { bubbleDelivery, threadInitials } from '../../lib/inboxView'
import { lifecycleLabel } from '../../lib/lifecycle'

type Props = {
  thread: ThreadDetail | null
  messages: ChatMessage[]
  loading?: boolean
  sending?: boolean
  error?: string | null
  onSend: (text: string) => Promise<void>
  onRefresh?: () => void
  onOpenLead?: (leadId: string) => void
  /** Rail inside a lead workspace: no header, the page already says who this is. */
  compact?: boolean
  /** Inbox only: show/hide the linked-lead panel. */
  leadPanelOpen?: boolean
  onToggleLeadPanel?: () => void
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function dateLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function ChatWindow({
  thread,
  messages,
  loading,
  sending,
  error,
  onSend,
  onRefresh,
  onOpenLead,
  compact,
  leadPanelOpen,
  onToggleLeadPanel,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const previousThreadId = useRef<string | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const threadChanged = previousThreadId.current !== (thread?.id || null)
    previousThreadId.current = thread?.id || null
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    if (threadChanged || distance < 160) bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages, thread?.id])

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-shop-bg p-8">
        <EmptyState
          title="Select a conversation"
          description="Customer chats, dealer RFQs, and WhatsApp groups appear here. Open a group to message everyone in it."
        />
      </div>
    )
  }

  const pending = thread.pending_response
  let lastDate = ''

  const customer = thread.kind === 'customer'
  const kindLabel = thread.kind === 'dealer' ? 'Dealer' : thread.kind === 'group' ? 'Group' : 'Customer'
  const avatarTone =
    thread.kind === 'dealer' ? 'bg-dealer-bg text-dealer-fg' : thread.kind === 'group' ? 'bg-neutral-bg text-neutral-fg' : 'bg-warn-bg text-[#78350F]'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#EFF3F6]">
      {!compact && (
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-shop-border bg-white px-4">
          <div
            aria-hidden="true"
            className={`grid size-[38px] shrink-0 place-items-center text-[13px] font-bold ${thread.kind === 'customer' ? 'rounded-full' : 'rounded-[10px]'} ${avatarTone}`}
          >
            {threadInitials(thread.title)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <h2 className="truncate font-bold">{thread.title}</h2>
            <p className="truncate text-xs text-shop-muted tabular-nums">
              {[thread.phone || thread.subtitle, kindLabel].filter(Boolean).join(' · ')}
            </p>
          </div>
          {thread.lead_id && onOpenLead && (
            <Button icon={<Briefcase />} onClick={() => onOpenLead(thread.lead_id!)}>
              Lead
              {thread.lifecycle_status ? ` · ${lifecycleLabel(thread.lifecycle_status)}` : ''}
            </Button>
          )}
          {onToggleLeadPanel && (
            <Button
              variant="ghost"
              iconOnly
              className="max-xl:hidden"
              aria-label={leadPanelOpen ? 'Hide lead panel' : 'Show lead panel'}
              aria-pressed={leadPanelOpen}
              icon={<PanelRight />}
              onClick={onToggleLeadPanel}
            />
          )}
        </header>
      )}

      {pending && (
        <div className="shrink-0 border-b border-[#FCD34D] bg-warn-bg px-4 py-3">
          <p className="text-[11px] font-bold tracking-[0.06em] text-warn-fg uppercase">Pending quote review</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[#78350F]">{pending.raw_text}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void reviewResponse(pending.id, true).then(() => onRefresh?.())}>
              Approve
            </Button>
            <Button size="sm" onClick={() => void reviewResponse(pending.id, false).then(() => onRefresh?.())}>
              Reject
            </Button>
          </div>
        </div>
      )}

      <div ref={scrollRef} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        {loading && <p role="status" className="py-8 text-center text-sm text-shop-muted">Loading messages…</p>}
        {!loading && error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {error}
          </div>
        )}
        {!loading && !error && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-shop-muted">No messages yet. Send the first reply.</p>
        )}
        {!loading &&
          messages.map((msg) => {
            const day = dateLabel(msg.created_at)
            const showDay = day !== lastDate
            if (showDay) lastDate = day
            return (
              <div key={msg.id}>
                {showDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-white px-2.5 py-[3px] text-xs font-semibold text-slate-600">
                      {day}
                    </span>
                  </div>
                )}
                <div className="mb-2">
                  <MessageBubble
                    direction={msg.direction}
                    body={msg.body}
                    time={formatTime(msg.created_at)}
                    delivery={bubbleDelivery(msg)}
                    onRetry={bubbleDelivery(msg) === 'failed' ? () => void onSend(msg.body).catch(() => {}) : undefined}
                    voice={msg.meta?.transcribed === true}
                    poll={msg.meta?.poll_vote ? 'vote' : msg.meta?.poll ? 'sent' : undefined}
                    sender={
                      thread.kind === 'group' && msg.direction === 'inbound'
                        ? String(msg.meta?.sender || msg.meta?.from_number || '')
                        : null
                    }
                  />
                </div>
              </div>
            )
          })}
        <div ref={bottomRef} />
      </div>

      <ChatComposer
        sending={sending}
        onSend={onSend}
        quickReplies={customer && !compact}
        label={`Message ${thread.title}`}
        placeholder={thread.kind === 'group' ? 'Message this group…' : `Message ${thread.title}… (Enter to send)`}
      />
    </div>
  )
}
