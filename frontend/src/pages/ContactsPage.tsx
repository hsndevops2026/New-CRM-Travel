import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, Pencil, Plus, Search } from 'lucide-react'
import AddLeadModal from '../components/AddLeadModal'
import ContactModal from '../components/ContactModal'
import ReminderModal from '../components/ReminderModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import OverflowMenu from '../components/ui/OverflowMenu'
import PageHeader from '../components/ui/PageHeader'
import { TableSkeleton } from '../components/ui/Skeleton'
import { useSearch } from '../hooks/useSearch'
import { useConfirm } from '../hooks/useConfirm'
import { deleteContact, fetchContacts, type Contact } from '../lib/contacts'
import { contactThread, matchesContact, relatedLead } from '../lib/contactView'
import { fetchThreads, formatThreadTime, type Thread } from '../lib/inbox'
import { fetchLeads, formatPhone, leadTitle, type Lead } from '../lib/leads'
import { threadInitials, threadPreview } from '../lib/inboxView'

export default function ContactsPage() {
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

  const filtered = useMemo(() => contacts.filter((c) => matchesContact(c, query)), [contacts, query])

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} contact${contacts.length === 1 ? '' : 's'} · Customer phone book for WhatsApp quoting.`}
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setContactEditor(null)}>
            Add contact
          </Button>
        }
      />

      <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
        {loading && <TableSkeleton rows={5} label="Loading contacts" />}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title="Contacts could not be loaded"
            description={error}
            action={<Button variant="primary" onClick={() => void load()}>Retry</Button>}
          />
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            tone={query.trim() ? 'neutral' : 'default'}
            icon={query.trim() ? <Search /> : undefined}
            title={query.trim() ? `No contact matches “${query.trim()}”` : 'No contacts yet'}
            description={
              query.trim()
                ? 'Check the number format, or add them as a new contact.'
                : 'Save a name and WhatsApp number to reuse on future leads.'
            }
            action={
              <Button variant={query.trim() ? 'secondary' : 'primary'} onClick={() => setContactEditor(null)}>
                {query.trim() ? `Add “${query.trim()}” as contact` : 'Add contact'}
              </Button>
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5">Name</th>
                  <th className="px-3 py-2.5">WhatsApp / phone</th>
                  <th className="px-3 py-2.5">Last interaction</th>
                  <th className="px-3 py-2.5">Related lead</th>
                  <th className="relative px-3.5 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => {
                  const lead = relatedLead(contact, leads)
                  const thread = contactThread(contact, threads)
                  return (
                    <tr key={contact.id} className="border-b border-neutral-bg last:border-0 hover:bg-shop-bg">
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-bg text-xs font-bold text-neutral-fg"
                          >
                            {threadInitials(contact.name)}
                          </span>
                          <Link to={`/contacts/${contact.id}`} className="font-semibold hover:underline">
                            {contact.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">{formatPhone(contact.phone)}</td>
                      <td className="px-3 py-3">
                        {thread ? (
                          <div className="flex max-w-[280px] flex-col">
                            <span className="truncate">{threadPreview(thread)}</span>
                            <span className="text-xs text-shop-muted tabular-nums">{formatThreadTime(thread.last_at)}</span>
                          </div>
                        ) : (
                          <span className="text-shop-muted">No messages yet</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {lead ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/leads/${lead.id}`)}
                            className="-my-2 inline-flex items-center gap-2 py-2 text-left hover:underline"
                          >
                            <span className="font-semibold">{leadTitle(lead)}</span>
                            <LifecycleBadge status={lead.lifecycle_status} />
                          </button>
                        ) : (
                          <Button size="sm" onClick={() => setLeadFor(contact)}>
                            Create lead
                          </Button>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {thread && (
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/inbox/${encodeURIComponent(thread.id)}`)}>
                              Message
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            aria-label={`Edit ${contact.name}`}
                            icon={<Pencil />}
                            onClick={() => setContactEditor(contact)}
                          />
                          <OverflowMenu
                            label={`More actions for ${contact.name}`}
                            items={[
                              {
                                id: 'reminder',
                                label: 'Add reminder…',
                                onClick: () => setReminderFor(contact),
                              },
                              {
                                id: 'delete',
                                label: 'Delete contact…',
                                tone: 'danger',
                                onClick: () => {
                                  void confirm({
                                    title: `Delete ${contact.name}?`,
                                    description: 'The contact is removed. Leads keep the phone number they were created with.',
                                    confirmLabel: 'Delete contact',
                                  }).then((ok) => {
                                    if (ok) void deleteContact(contact.id).then(load)
                                  })
                                },
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
