import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  CircleAlert,
  ExternalLink,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import ContactModal from '../components/ContactModal'
import ReminderModal from '../components/ReminderModal'
import UploadDocumentButton from '../components/UploadDocumentButton'
import MessageBubble from '../components/chat/MessageBubble'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import {
  deleteLeadDocument,
  type BookingDocument,
} from '../lib/bookingDocuments'
import {
  fetchContactProfile,
  type Contact,
  type ContactBooking,
  type ContactProfile,
} from '../lib/contacts'
import {
  fetchThreadMessages,
  formatThreadTime,
  type ChatMessage,
  type Thread,
} from '../lib/inbox'
import { bubbleDelivery, threadInitials, threadPreview } from '../lib/inboxView'
import { formatDate, formatPhone, formatWhen, leadTitle } from '../lib/leads'
import {
  deleteReminder,
  formatReminderTime,
  isReminderOverdue,
  updateReminder,
  type ContactReminder,
} from '../lib/reminders'

type TabId = 'bookings' | 'chats' | 'documents' | 'reminders'

const TABS: { id: TabId; label: string }[] = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'chats', label: 'Chats' },
  { id: 'documents', label: 'Documents' },
  { id: 'reminders', label: 'Reminders' },
]

const TAB_IDS = new Set<string>(TABS.map((t) => t.id))

function parseTab(value: string | null): TabId {
  return value && TAB_IDS.has(value) ? (value as TabId) : 'bookings'
}

function documentLabel(document: BookingDocument) {
  return document.title || document.file_name || 'Document'
}

function DocumentRow({
  document,
  isAdmin,
  onDeleted,
}: {
  document: BookingDocument
  isAdmin: boolean
  onDeleted: (id: string) => void
}) {
  const { confirm, dialog } = useConfirm()
  const label = documentLabel(document)
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <a
          href={document.file_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
        >
          <FileText className="size-3.5 shrink-0 text-shop-muted" aria-hidden="true" />
          <span className="truncate">{label}</span>
          <ExternalLink className="size-3 shrink-0 text-shop-muted" aria-hidden="true" />
        </a>
        <p className="text-xs text-shop-muted">
          {[document.file_name, formatWhen(document.created_at)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {isAdmin && (
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label={`Delete ${label}`}
          icon={<Trash2 />}
          onClick={() => {
            void confirm({
              title: 'Delete document?',
              description: label,
              confirmLabel: 'Delete',
            }).then((ok) => {
              if (!ok) return
              void deleteLeadDocument(document.lead_id, document.id).then(() => onDeleted(document.id))
            })
          }}
        />
      )}
      {dialog}
    </li>
  )
}

export default function ContactProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { admin } = useAuth()
  const { confirm, dialog } = useConfirm()
  const isAdmin = admin?.role === 'admin'
  const tab = parseTab(searchParams.get('tab'))
  const setTab = (next: TabId) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'bookings') params.delete('tab')
        else params.set('tab', next)
        return params
      },
      { replace: true },
    )
  }

  const [profile, setProfile] = useState<ContactProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [reminderEditor, setReminderEditor] = useState<ContactReminder | null | undefined>(undefined)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [loadedId, setLoadedId] = useState(id)
  if (id !== loadedId) {
    setLoadedId(id)
    setLoading(true)
    setError(null)
    setProfile(null)
    setActiveThreadId(null)
    setMessages([])
  }

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const next = await fetchContactProfile(id)
      setProfile(next)
      setError(null)
      setActiveThreadId((prev) => prev || next.threads[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetchContactProfile(id)
      .then((next) => {
        if (cancelled) return
        setProfile(next)
        setError(null)
        setActiveThreadId((prev) => prev || next.threads[0]?.id || null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load profile')
        setProfile(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!activeThreadId) return
    let cancelled = false
    fetchThreadMessages(activeThreadId)
      .then((data) => {
        if (!cancelled) {
          setMessages(data.messages)
          setMessagesLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
          setMessagesLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId])

  const allDocuments = useMemo(() => {
    if (!profile) return [] as { booking: ContactBooking; document: BookingDocument }[]
    return profile.bookings.flatMap((booking) =>
      (booking.documents || []).map((document) => ({ booking, document })),
    )
  }, [profile])

  const patchBookingDocs = (leadId: string, updater: (docs: BookingDocument[]) => BookingDocument[]) => {
    setProfile((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        bookings: prev.bookings.map((b) =>
          b.id === leadId ? { ...b, documents: updater(b.documents || []) } : b,
        ),
      }
    })
  }

  const messageThread = (threads: Thread[]) => {
    const preferred = threads.find((t) => t.lead_id) || threads[0]
    if (preferred) navigate(`/inbox/${encodeURIComponent(preferred.id)}`)
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
        <p className="text-sm text-shop-muted">Loading contact…</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
        <EmptyState
          tone="danger"
          icon={<CircleAlert />}
          title="Contact could not be loaded"
          description={error || 'Not found'}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate('/contacts')}>
                Back to contacts
              </Button>
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const { contact, bookings, threads, reminders } = profile

  return (
    <div className="mx-auto w-full max-w-[1100px] p-4 pb-24 sm:p-6">
      <button
        type="button"
        onClick={() => navigate('/contacts')}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-shop-muted hover:text-shop-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Contacts
      </button>

      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-full bg-neutral-bg text-sm font-bold text-neutral-fg"
            >
              {threadInitials(contact.name)}
            </span>
            {contact.name}
          </span>
        }
        subtitle={formatPhone(contact.phone)}
        actions={
          <div className="flex flex-wrap gap-2">
            {threads.length > 0 && (
              <Button variant="secondary" icon={<MessageSquare />} onClick={() => messageThread(threads)}>
                Message
              </Button>
            )}
            <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="primary"
              icon={<Plus />}
              onClick={() => setReminderEditor(null)}
            >
              Add reminder
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-shop-border">
        {TABS.map((item) => {
          const count =
            item.id === 'bookings'
              ? bookings.length
              : item.id === 'chats'
                ? threads.length
                : item.id === 'documents'
                  ? allDocuments.length
                  : reminders.length
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap ${
                tab === item.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-shop-muted hover:text-shop-ink'
              }`}
            >
              {item.label}
              <span className="ml-1.5 text-xs font-normal tabular-nums text-shop-muted">{count}</span>
            </button>
          )
        })}
      </div>

      {tab === 'bookings' && (
        <section className="grid gap-3">
          {bookings.length === 0 && (
            <EmptyState
              title="No bookings yet"
              description="Leads for this phone number will show up here."
            />
          )}
          {bookings.map((booking) => (
            <article key={booking.id} className="rounded-[10px] border border-shop-border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/leads/${booking.id}`} className="text-base font-semibold hover:underline">
                      {leadTitle(booking)}
                    </Link>
                    <LifecycleBadge status={booking.lifecycle_status} />
                    <span className="rounded bg-shop-bg px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-shop-muted uppercase">
                      {booking.booking_type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-shop-muted">
                    {formatDate(booking.travel_date)} – {formatDate(booking.return_date)}
                    {booking.nights != null ? ` · ${booking.nights} night${booking.nights === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/leads/${booking.id}`)}>
                  Open lead
                </Button>
              </div>

              <div className="mt-4 border-t border-shop-border pt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold tracking-wide text-shop-muted uppercase">Documents</h3>
                  {isAdmin && (
                    <UploadDocumentButton
                      leadId={booking.id}
                      onUploaded={(doc) => patchBookingDocs(booking.id, (docs) => [doc, ...docs])}
                    />
                  )}
                </div>
                {(booking.documents || []).length === 0 ? (
                  <p className="py-2 text-sm text-shop-muted">No documents uploaded.</p>
                ) : (
                  <ul className="divide-y divide-neutral-bg">
                    {(booking.documents || []).map((document) => (
                      <DocumentRow
                        key={document.id}
                        document={document}
                        isAdmin={isAdmin}
                        onDeleted={(docId) =>
                          patchBookingDocs(booking.id, (docs) => docs.filter((d) => d.id !== docId))
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === 'chats' && (
        <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white md:grid md:min-h-[420px] md:grid-cols-[260px_1fr]">
          {threads.length === 0 ? (
            <div className="p-4 md:col-span-2">
              <EmptyState title="No chats yet" description="WhatsApp threads for this contact will appear here." />
            </div>
          ) : (
            <>
              <ul className="border-b border-shop-border md:border-r md:border-b-0">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveThreadId(thread.id)
                        setMessages([])
                        setMessagesLoading(true)
                      }}
                      className={`flex w-full flex-col gap-0.5 px-3.5 py-3 text-left hover:bg-shop-bg ${
                        activeThreadId === thread.id ? 'bg-shop-bg' : ''
                      }`}
                    >
                      <span className="truncate text-sm font-semibold">{thread.title}</span>
                      <span className="truncate text-xs text-shop-muted">{threadPreview(thread)}</span>
                      <span className="text-[11px] text-shop-muted tabular-nums">
                        {formatThreadTime(thread.last_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col bg-shop-bg">
                <div className="flex items-center justify-between border-b border-shop-border bg-white px-3.5 py-2">
                  <span className="text-sm font-semibold">Conversation</span>
                  {activeThreadId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/inbox/${encodeURIComponent(activeThreadId)}`)}
                    >
                      Open in Inbox
                    </Button>
                  )}
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3.5">
                  {messagesLoading && <p className="text-sm text-shop-muted">Loading messages…</p>}
                  {!messagesLoading && messages.length === 0 && (
                    <p className="text-sm text-shop-muted">No messages in this thread.</p>
                  )}
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      direction={msg.direction}
                      body={msg.body || ''}
                      time={new Date(msg.created_at).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      delivery={bubbleDelivery(msg)}
                      voice={Boolean(msg.meta && (msg.meta as { voice?: boolean }).voice)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'documents' && (
        <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
          {allDocuments.length === 0 ? (
            <EmptyState
              title="No documents"
              description={
                isAdmin
                  ? 'Upload files from a booking card on the Bookings tab.'
                  : 'Documents uploaded by an admin will appear here.'
              }
            />
          ) : (
            <ul className="divide-y divide-neutral-bg">
              {allDocuments.map(({ booking, document }) => (
                <li key={document.id} className="px-3.5 py-3">
                  <p className="mb-1 text-xs font-semibold text-shop-muted">
                    {leadTitle(booking)} · {formatDate(booking.travel_date)}
                  </p>
                  <DocumentRow
                    document={document}
                    isAdmin={isAdmin}
                    onDeleted={(docId) =>
                      patchBookingDocs(booking.id, (docs) => docs.filter((d) => d.id !== docId))
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'reminders' && (
        <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
          <div className="flex items-center justify-between border-b border-shop-border px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-shop-muted" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Reminders</h2>
            </div>
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setReminderEditor(null)}>
              Add
            </Button>
          </div>
          {reminders.length === 0 ? (
            <p className="px-3.5 py-4 text-sm text-shop-muted">No reminders for this contact.</p>
          ) : (
            <ul className="divide-y divide-neutral-bg">
              {reminders.map((reminder) => {
                const overdue = isReminderOverdue(reminder)
                const done = Boolean(reminder.done_at)
                return (
                  <li
                    key={reminder.id}
                    className={`flex items-start gap-3 px-3.5 py-3 ${
                      overdue ? 'bg-amber-50/70' : done ? 'opacity-70' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      aria-label={done ? 'Mark not done' : 'Mark done'}
                      className="mt-1"
                      onChange={() => {
                        void updateReminder(reminder.id, { done: !done }).then((saved) => {
                          setProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  reminders: prev.reminders.map((r) => (r.id === saved.id ? saved : r)),
                                }
                              : prev,
                          )
                        })
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold tabular-nums text-shop-muted">
                          {formatDate(reminder.remind_at)} · {formatReminderTime(reminder.remind_at)}
                        </span>
                        {overdue && (
                          <span className="text-[11px] font-bold tracking-wide text-amber-800 uppercase">
                            Overdue
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${done ? 'line-through text-shop-muted' : ''}`}>{reminder.text}</p>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        aria-label="Edit reminder"
                        icon={<Pencil />}
                        onClick={() => setReminderEditor(reminder)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        aria-label="Delete reminder"
                        icon={<Trash2 />}
                        onClick={() => {
                          void confirm({
                            title: 'Delete reminder?',
                            description: reminder.text,
                            confirmLabel: 'Delete',
                          }).then((ok) => {
                            if (!ok) return
                            void deleteReminder(reminder.id).then(() => {
                              setProfile((prev) =>
                                prev
                                  ? { ...prev, reminders: prev.reminders.filter((r) => r.id !== reminder.id) }
                                  : prev,
                              )
                            })
                          })
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <ContactModal
        open={editing}
        contact={contact}
        onClose={() => setEditing(false)}
        onSaved={(saved: Contact) => {
          setEditing(false)
          setProfile((prev) => (prev ? { ...prev, contact: saved } : prev))
        }}
      />
      <ReminderModal
        open={reminderEditor !== undefined}
        contact={contact}
        reminder={reminderEditor}
        onClose={() => setReminderEditor(undefined)}
        onSaved={(saved) => {
          setReminderEditor(undefined)
          setProfile((prev) => {
            if (!prev) return prev
            const exists = prev.reminders.some((r) => r.id === saved.id)
            return {
              ...prev,
              reminders: exists
                ? prev.reminders.map((r) => (r.id === saved.id ? saved : r))
                : [saved, ...prev.reminders],
            }
          })
        }}
      />
      {dialog}
    </div>
  )
}
