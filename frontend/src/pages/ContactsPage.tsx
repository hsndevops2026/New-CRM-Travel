import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, MessageSquare, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import AddLeadModal from '../components/AddLeadModal'
import ContactModal from '../components/ContactModal'
import ReminderModal from '../components/ReminderModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import FilterPills from '../components/ui/FilterPills'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import OverflowMenu from '../components/ui/OverflowMenu'
import PageHeader from '../components/ui/PageHeader'
import { TableSkeleton } from '../components/ui/Skeleton'
import { useSearch } from '../hooks/useSearch'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../hooks/useToast'
import { deleteContact, fetchContacts, type Contact } from '../lib/contacts'
import { contactThread, matchesContact, relatedLead } from '../lib/contactView'
import { fetchThreads, formatThreadTime, type Thread } from '../lib/inbox'
import { fetchLeads, formatPhone, leadTitle, type Lead } from '../lib/leads'
import { threadInitials, threadPreview } from '../lib/inboxView'

const AVATAR_TONES = [
  'bg-teal-100 text-teal-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-emerald-100 text-emerald-800',
]

/** The same name always gets the same colour. */
function ContactAvatar({ name }: { name: string }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${AVATAR_TONES[hash % AVATAR_TONES.length]}`}>
      {threadInitials(name)}
    </span>
  )
}

function RowActions({ contact, threadId, deleting, busy, onMessage, onEdit, onDelete, onReminder, compact = false }: {
  /** Phones: everything in the "…" menu, so the name keeps its room. */
  compact?: boolean
  contact: Contact
  threadId?: string
  deleting: boolean
  busy: boolean
  onMessage: (threadId: string) => void
  onEdit: () => void
  onDelete: () => void
  onReminder: () => void
}) {
  useI18n()
  if (compact) {
    return (
      <OverflowMenu
        label={translate("More actions for {value0}", { value0: contact.name })}
        items={[
          ...(threadId ? [{ id: 'message', label: translate("Message"), onClick: () => onMessage(threadId) }] : []),
          { id: 'edit', label: translate("Edit"), onClick: onEdit },
          { id: 'reminder', label: translate("Add reminder…"), onClick: onReminder },
          { id: 'delete', label: translate("Delete contact…"), tone: 'danger' as const, disabled: busy, onClick: onDelete },
        ]}
      />
    )
  }
  return (
    <div className="flex items-center justify-end gap-0.5">
      {threadId && (
        <Button size="sm" variant="ghost" iconOnly aria-label={translate("Message {value0}", { value0: contact.name })} icon={<MessageSquare />} onClick={() => onMessage(threadId)} />
      )}
      <Button size="sm" variant="ghost" iconOnly aria-label={translate("Edit {value0}", { value0: contact.name })} icon={<Pencil />} onClick={onEdit} />
      <Button size="sm" variant="ghost" iconOnly aria-label={translate("Delete {value0}", { value0: contact.name })} icon={<Trash2 />} loading={deleting} disabled={busy && !deleting} onClick={onDelete} />
      <OverflowMenu
        label={translate("More actions for {value0}", { value0: contact.name })}
        items={[{ id: 'reminder', label: translate("Add reminder…"), onClick: onReminder }]}
      />
    </div>
  )
}

export default function ContactsPage() {
  useI18n()
  const navigate = useNavigate()
  const { query, setPlaceholder } = useSearch()
  const { confirm, dialog } = useConfirm()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contactEditor, setContactEditor] = useState<Contact | null | undefined>(undefined)
  const [leadFor, setLeadFor] = useState<Contact | null>(null)
  const [reminderFor, setReminderFor] = useState<Contact | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'lead' | 'nolead'>('all')
  const toast = useToast()

  useEffect(() => {
    setPlaceholder('Search name or phone, e.g. 050 123')
  }, [setPlaceholder])

  // Leads and conversations only add context; the page works without them.
  const loadContext = () =>
    Promise.all([fetchLeads().catch(() => [] as Lead[]), fetchThreads('customer').catch(() => [] as Thread[])]).then(
      ([nextLeads, nextThreads]) => {
        setLeads(nextLeads)
        setThreads(nextThreads)
      },
    )

  const load = async () => {
    setLoading(true)
    try {
      const [next] = await Promise.all([fetchContacts(), loadContext()])
      setContacts(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchContacts(),
      fetchLeads().catch(() => [] as Lead[]),
      fetchThreads('customer').catch(() => [] as Thread[]),
    ])
      .then(([next, nextLeads, nextThreads]) => {
        if (cancelled) return
        setContacts(next)
        setLeads(nextLeads)
        setThreads(nextThreads)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load contacts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const matching = useMemo(() => contacts.filter((c) => matchesContact(c, query)), [contacts, query])
  const withLead = useMemo(() => new Set(matching.filter((c) => relatedLead(c, leads)).map((c) => c.id)), [matching, leads])
  const filtered = useMemo(
    () => matching.filter((c) => show === 'all' || (show === 'lead') === withLead.has(c.id)),
    [matching, show, withLead],
  )


  const removeContact = async (contact: Contact) => {
    const ok = await confirm({
      title: translate("Delete {value0}?", { value0: contact.name }),
      description: translate("The contact is removed. Leads keep the phone number they were created with."),
      confirmLabel: translate("Delete contact"),
      tone: 'danger',
    })
    if (!ok) return
    setDeletingId(contact.id)
    try {
      await deleteContact(contact.id)
      setContacts((list) => list.filter((c) => c.id !== contact.id))
      toast.show({ tone: 'success', message: translate("Contact deleted.") })
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to delete contact' })
    } finally {
      setDeletingId(null)
    }
  }
  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate("Contacts")}
        subtitle={translate("{value0} contact{value1} · Customer phone book for WhatsApp quoting.", { value0: translate(String(contacts.length)), value1: translate(String(contacts.length === 1 ? '' : 's')) })}
        actions={
          <>
          <Button onClick={() => navigate('/past-customers')}>
            {translate('Past customers')}
          </Button>
          <Button variant="primary" icon={<Plus />} onClick={() => setContactEditor(null)}>
            {translate("Add contact")}</Button>
          </>
        }
      />

      {!loading && !error && contacts.length > 0 && (
        <div className="mb-3">
          <FilterPills
            ariaLabel={translate("Show contacts")}
            value={show}
            onChange={(id) => setShow(id as typeof show)}
            items={[
              { id: 'all', label: 'All', count: matching.length },
              { id: 'lead', label: 'With a lead', count: withLead.size },
              { id: 'nolead', label: 'No lead yet', count: matching.length - withLead.size },
            ]}
          />
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-shop-border bg-white">
        {loading && <TableSkeleton rows={5} label={translate("Loading contacts")} />}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title={translate("Contacts could not be loaded")}
            description={translate(error)}
            action={<Button variant="primary" onClick={() => void load()}>{translate("Retry")}</Button>}
          />
        )}
        {!loading && !error && filtered.length === 0 && matching.length > 0 && (
          <EmptyState
            tone="neutral"
            title={translate(show === 'lead' ? "No contact has a lead yet" : "Every contact has a lead")}
            action={<Button onClick={() => setShow('all')}>{translate("Show all contacts")}</Button>}
          />
        )}
        {!loading && !error && matching.length === 0 && (
          <EmptyState
            tone={query.trim() ? 'neutral' : 'default'}
            icon={query.trim() ? <Search /> : undefined}
            title={query.trim() ? translate("No contact matches “{value0}”", { value0: translate(String(query.trim())) }) : translate("No contacts yet")}
            description={
              query.trim()
                ? translate("Check the number format, or add them as a new contact.")
                : translate("Save a name and WhatsApp number to reuse on future leads.")
            }
            action={
              <Button variant={query.trim() ? 'secondary' : 'primary'} onClick={() => setContactEditor(null)}>
                {query.trim() ? translate("Add “{value0}” as contact", { value0: translate(String(query.trim())) }) : translate("Add contact")}
              </Button>
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <>
            {/* Desktop: a table; a whole row opens the contact. */}
            <div className="overflow-x-auto max-md:hidden">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-shop-border bg-[#f8fafc] text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase">
                    <th className="px-4 py-2.5 text-start">{translate("Name")}</th>
                    <th className="px-3 py-2.5 text-start">{translate("WhatsApp / phone")}</th>
                    <th className="px-3 py-2.5 text-start">{translate("Last interaction")}</th>
                    <th className="px-3 py-2.5 text-start">{translate("Related lead")}</th>
                    <th className="sticky end-0 bg-[#f8fafc] px-4 py-2.5">
                      <span className="sr-only">{translate("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((contact) => {
                    const lead = relatedLead(contact, leads)
                    const thread = contactThread(contact, threads)
                    return (
                      <tr
                        key={contact.id}
                        onClick={(event) => { if (!(event.target as HTMLElement).closest('a, button, input')) navigate(`/contacts/${contact.id}`) }}
                        className="group cursor-pointer border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <ContactAvatar name={contact.name} />
                            <div className="flex min-w-0 flex-col leading-tight">
                              <Link to={`/contacts/${contact.id}`} dir="auto" className="truncate text-start font-semibold text-shop-ink hover:underline">
                                {contact.name}
                              </Link>
                              {contact.email && <span className="truncate text-xs text-shop-muted" dir="ltr">{contact.email}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-700"><bdi dir="ltr">{formatPhone(contact.phone)}</bdi></td>
                        <td className="px-3 py-3">
                          {thread ? (
                            <div className="flex max-w-[260px] flex-col leading-tight">
                              <span dir="auto" className="truncate text-start text-slate-700">{threadPreview(thread)}</span>
                              <span className="mt-0.5 text-xs text-shop-muted tabular-nums">{formatThreadTime(thread.last_at)}</span>
                            </div>
                          ) : (
                            <span className="text-shop-muted">{translate("No messages yet")}</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {lead ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/leads/${lead.id}`)}
                              className="-my-1 inline-flex max-w-[260px] items-center gap-2 rounded-lg px-1.5 py-1 text-start hover:bg-tint"
                            >
                              <span className="truncate font-semibold">{leadTitle(lead)}</span>
                              <LifecycleBadge status={lead.lifecycle_status} />
                            </button>
                          ) : (
                            <Button size="sm" icon={<Plus />} onClick={() => setLeadFor(contact)}>
                              {translate("Create lead")}</Button>
                          )}
                        </td>
                        <td className="sticky end-0 bg-white px-3 py-3 transition-colors group-hover:bg-[#f7fafb]">
                          <RowActions
                            contact={contact}
                            threadId={thread?.id}
                            deleting={deletingId === contact.id}
                            busy={deletingId !== null}
                            onMessage={(id) => navigate(`/inbox/${encodeURIComponent(id)}`)}
                            onEdit={() => setContactEditor(contact)}
                            onDelete={() => void removeContact(contact)}
                            onReminder={() => setReminderFor(contact)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per contact instead of a sideways-scrolling table. */}
            <ul className="m-0 list-none divide-y divide-[#eef1f5] p-0 md:hidden">
              {filtered.map((contact) => {
                const lead = relatedLead(contact, leads)
                const thread = contactThread(contact, threads)
                return (
                  <li key={contact.id} className="flex flex-col gap-2.5 px-3 py-3">
                    <div className="flex items-center gap-3">
                      <ContactAvatar name={contact.name} />
                      <Link to={`/contacts/${contact.id}`} className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span dir="auto" className="truncate text-start font-semibold">{contact.name}</span>
                        <bdi dir="ltr" className="text-start text-[13px] text-shop-muted tabular-nums">{formatPhone(contact.phone)}</bdi>
                      </Link>
                      <RowActions
                        compact
                        contact={contact}
                        threadId={thread?.id}
                        deleting={deletingId === contact.id}
                        busy={deletingId !== null}
                        onMessage={(id) => navigate(`/inbox/${encodeURIComponent(id)}`)}
                        onEdit={() => setContactEditor(contact)}
                        onDelete={() => void removeContact(contact)}
                        onReminder={() => setReminderFor(contact)}
                      />
                    </div>
                    {thread && (
                      <p className="m-0 flex items-baseline gap-2 text-[13px] text-slate-600">
                        <span dir="auto" className="min-w-0 flex-1 truncate text-start">{threadPreview(thread)}</span>
                        <span className="shrink-0 text-xs text-shop-muted tabular-nums">{formatThreadTime(thread.last_at)}</span>
                      </p>
                    )}
                    <div>
                      {lead ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/leads/${lead.id}`)}
                          className="inline-flex max-w-full items-center gap-2 rounded-full border border-shop-border bg-[#f8fafb] px-3 py-1.5 text-start text-[13px]"
                        >
                          <span className="truncate font-semibold">{leadTitle(lead)}</span>
                          <LifecycleBadge status={lead.lifecycle_status} />
                        </button>
                      ) : (
                        <Button size="sm" icon={<Plus />} onClick={() => setLeadFor(contact)}>
                          {translate("Create lead")}</Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <ContactModal
        open={contactEditor !== undefined}
        contact={contactEditor}
        onClose={() => setContactEditor(undefined)}
        onSaved={() => {
          setContactEditor(undefined)
          void load()
        }}
      />
      <AddLeadModal
        open={leadFor !== null}
        initialPhone={leadFor?.phone}
        onClose={() => setLeadFor(null)}
        onCreated={(lead) => {
          setLeadFor(null)
          navigate(`/leads/${lead.id}`)
        }}
      />
      <ReminderModal
        open={reminderFor !== null}
        contact={reminderFor}
        onClose={() => setReminderFor(null)}
        onSaved={() => {
          setReminderFor(null)
          window.dispatchEvent(new Event('reminders:changed'))
        }}
      />
      {dialog}
    </div>
  )
}
