import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ExternalLink, FileText, MessageCircle, Plane } from 'lucide-react'
import EmptyState from '../components/ui/EmptyState'
import StatusBadge from '../components/ui/StatusBadge'
import { formatPhone, leadTitle, type Lead } from '../lib/leads'
import { formatDateRange, leadTypeLabel, travelersLabel } from '../lib/leadSummary'
import {
  fetchPortalHome,
  type PortalChat,
  type PortalDocument,
  type PortalHome,
} from '../lib/portal'

function sectionFromPath(pathname: string): 'bookings' | 'documents' | 'chats' {
  if (pathname.startsWith('/portal/documents')) return 'documents'
  if (pathname.startsWith('/portal/chats')) return 'chats'
  return 'bookings'
}

function BookingCard({ booking }: { booking: Lead }) {
  return (
    <article className="rounded-xl border border-shop-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{leadTitle(booking)}</h2>
          <p className="mt-1 text-sm text-shop-muted">
            {formatDateRange(booking.travel_date, booking.return_date)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge label={leadTypeLabel(booking.booking_type)} tone="neutral" />
          {booking.lifecycle_status === 'booked' || booking.status === 'booked' ? (
            <StatusBadge label="Booked" tone="success" />
          ) : (
            <StatusBadge label={booking.lifecycle_status || booking.status || 'open'} tone="neutral" />
          )}
        </div>
      </div>
      <dl className="mt-3 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-shop-muted">Travelers</dt>
          <dd>{travelersLabel(booking.adults_count, booking.children_count, booking.children_ages)}</dd>
        </div>
        <div>
          <dt className="text-xs text-shop-muted">WhatsApp</dt>
          <dd>{formatPhone(booking.phone)}</dd>
        </div>
      </dl>
    </article>
  )
}

function DocumentsList({ documents }: { documents: PortalDocument[] }) {
  if (!documents.length) {
    return (
      <EmptyState
        icon={<FileText className="size-6" />}
        title="No documents yet"
        description="When your agency uploads tickets, vouchers, or invoices, they will show up here."
      />
    )
  }
  return (
    <ul className="divide-y divide-shop-border rounded-xl border border-shop-border bg-white">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{doc.title}</p>
            <p className="truncate text-sm text-shop-muted">
              {[doc.destination, doc.file_name].filter(Boolean).join(' · ') || 'Document'}
            </p>
          </div>
          <a
            href={doc.file_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-shop-border px-3 text-sm font-semibold text-shop-accent hover:bg-tint"
          >
            Open
            <ExternalLink className="size-3.5" />
          </a>
        </li>
      ))}
    </ul>
  )
}

function ChatsList({ chats }: { chats: PortalChat[] }) {
  const [openId, setOpenId] = useState<string | null>(chats[0]?.lead_id || null)
  if (!chats.length) {
    return (
      <EmptyState
        icon={<MessageCircle className="size-6" />}
        title="No chat history"
        description="Messages with your travel advisor will appear here after you chat on WhatsApp."
      />
    )
  }
  const active = chats.find((chat) => chat.lead_id === openId) || chats[0]
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <ul className="rounded-xl border border-shop-border bg-white">
        {chats.map((chat) => {
          const selected = chat.lead_id === active?.lead_id
          return (
            <li key={chat.lead_id} className="border-b border-shop-border last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(chat.lead_id)}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-3 text-left text-sm ${
                  selected ? 'bg-tint' : 'hover:bg-neutral-bg'
                }`}
              >
                <span className="font-semibold">{chat.destination}</span>
                <span className="text-xs text-shop-muted">
                  {chat.message_count} message{chat.message_count === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-shop-border bg-white">
        <div className="border-b border-shop-border px-4 py-3">
          <h2 className="font-bold">{active?.destination}</h2>
          <p className="text-sm text-shop-muted">{leadTypeLabel(active?.booking_type)}</p>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {(active?.messages || []).map((message) => {
            const outbound = message.direction === 'outbound'
            return (
              <div
                key={message.id}
                className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    outbound
                      ? 'bg-neutral-bg text-shop-ink'
                      : 'bg-shop-accent text-white'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.body || '—'}</p>
                  <p className={`mt-1 text-[11px] ${outbound ? 'text-shop-muted' : 'text-white/80'}`}>
                    {message.created_at ? new Date(message.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function CustomerPortalPage() {
  const location = useLocation()
  const section = sectionFromPath(location.pathname)
  const [data, setData] = useState<PortalHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPortalHome()
      .then((home) => {
        if (cancelled) return
        setData(home)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load portal')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-shop-muted">Loading your portal…</p>
  }
  if (error || !data) {
    return <p role="alert" className="text-sm text-danger-fg">{error || 'Failed to load portal'}</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.01em]">
          {section === 'bookings' && 'Your bookings'}
          {section === 'documents' && 'Documents'}
          {section === 'chats' && 'Chat history'}
        </h1>
        <p className="mt-1 text-sm text-shop-muted">
          Welcome back, {data.customer.name}.{' '}
          {section === 'bookings' && (
            <>
              Need a file?{' '}
              <Link to="/portal/documents" className="font-semibold text-shop-accent hover:underline">
                Open documents
              </Link>
            </>
          )}
        </p>
      </div>

      {section === 'bookings' && (
        data.bookings.length ? (
          <div className="grid gap-3">
            {data.bookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Plane className="size-6" />}
            title="No bookings yet"
            description="Once your trip is confirmed, it will appear here."
          />
        )
      )}

      {section === 'documents' && <DocumentsList documents={data.documents} />}
      {section === 'chats' && <ChatsList chats={data.chats} />}
    </div>
  )
}
