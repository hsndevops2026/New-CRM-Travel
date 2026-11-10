import { t as translate, useI18n } from '../../lib/i18n'
import type { Thread } from '../../lib/inbox'
import { formatThreadTime } from '../../lib/inbox'
import { hasLead, threadInitials, threadPreview } from '../../lib/inboxView'
import StatusBadge from '../ui/StatusBadge'
import LifecycleBadge from '../ui/LifecycleBadge'

type Props = {
  threads: Thread[]
  activeId: string | null
  loading?: boolean
  onSelect: (thread: Thread) => void
  emptyMessage?: string
}

const AVATAR: Record<Thread['kind'], string> = {
  customer: 'rounded-full bg-warn-bg text-[#78350F]',
  dealer: 'rounded-[10px] bg-dealer-bg text-dealer-fg',
  group: 'rounded-[10px] bg-neutral-bg text-neutral-fg',
}

const KIND: Record<Thread['kind'], { label: string; tone: 'neutral' | 'dealer' | 'info' }> = {
  customer: { label: 'Customer', tone: 'neutral' },
  dealer: { label: 'Dealer', tone: 'dealer' },
  group: { label: 'Group', tone: 'info' },
}

export default function ChatThreadList({ threads, activeId, loading, onSelect, emptyMessage }: Props) {
  useI18n()
  if (loading) {
    return (
      <p role="status" className="px-4 py-8 text-center text-sm text-shop-muted">
        {translate("Loading conversations…")}</p>
    )
  }

  if (!threads.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
        <strong>{emptyMessage ? translate("Nothing here") : translate("No conversations yet")}</strong>
        <span className="text-sm text-shop-muted">
          {emptyMessage || 'Customer chats, dealer RFQs, and WhatsApp groups appear here.'}
        </span>
      </div>
    )
  }

  return (
    <ul>
      {threads.map((thread) => {
        const active = thread.id === activeId
        const waiting = thread.last_direction === 'inbound'
        return (
          <li key={thread.id} className="border-b border-neutral-bg">
            <button
              type="button"
              onClick={() => onSelect(thread)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-start gap-3 px-3.5 py-3 text-start transition-colors hover:bg-slate-50 ${
                active ? 'bg-tint shadow-[inset_3px_0_0_var(--color-shop-accent)]' : 'bg-white'
              }`}
            >
              <div
                aria-hidden="true"
                className={`grid size-10 shrink-0 place-items-center text-[13px] font-bold ${AVATAR[thread.kind]}`}
              >
                {threadInitials(thread.title)}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${waiting ? 'font-bold' : 'font-semibold'}`}>{thread.title}</span>
                  <span className={`shrink-0 text-xs font-semibold tabular-nums ${waiting ? 'text-shop-accent' : 'text-shop-muted'}`}>
                    {formatThreadTime(thread.last_at)}
                  </span>
                </div>
                <span className={`truncate text-sm ${waiting ? 'font-semibold text-shop-ink' : 'text-shop-muted'}`}>
                  {threadPreview(thread)}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge label={translate(KIND[thread.kind].label)} tone={KIND[thread.kind].tone} />
                  {thread.kind === 'customer' &&
                    (hasLead(thread) ? (
                      <LifecycleBadge status={thread.lifecycle_status} />
                    ) : (
                      <StatusBadge label={translate("No lead")} tone="outline" className="border-dashed border-[#94A3B8] text-slate-600" />
                    ))}
                  {thread.pending_response_id && <StatusBadge label={translate("Review pending")} tone="warning" />}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
