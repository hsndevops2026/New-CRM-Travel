import { t as translate, translateCount, useI18n } from '../lib/i18n'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AddLeadModal from '../components/AddLeadModal'
import ImportCsvModal from '../components/ImportCsvModal'
import BookLeadsModal from '../components/BookLeadsModal'
import LeadsTable, { ViewToggle } from '../components/leads/LeadsTable'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import LifecycleBadge from '../components/ui/LifecycleBadge'
import SegmentedControl from '../components/ui/SegmentedControl'
import OverflowMenu from '../components/ui/OverflowMenu'
import { TableSkeleton } from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import { useSearch } from '../hooks/useSearch'
import { useConfirm } from '../hooks/useConfirm'
import {
  fetchLeads,
  formatDate,
  formatWhen,
  leadPerson,
  leadTitle,
  updateLeadStatus,
  deleteLead,
  deleteLeadsBulk,
  type Lead,
} from '../lib/leads'
import { customerThreadId } from '../lib/inbox'
import { BOARD_STAGES, lifecycleLabel, nextActionFor } from '../lib/lifecycle'

type LeadType = 'hotel' | 'flight' | 'package'

export default function LeadsPage() {
  useI18n()
  const { segment = 'hotel' } = useParams<{ segment: string }>()
  const leadType: LeadType =
    segment === 'flight' ? 'flight' : segment === 'package' ? 'package' : 'hotel'
  const navigate = useNavigate()
  const { query, setPlaceholder } = useSearch()
  const { confirm, dialog } = useConfirm()

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>({ scope: '', ids: new Set() })
  const selectionScope = `${leadType}:${query}`
  const selected = useMemo(() => selection.scope === selectionScope ? selection.ids : new Set<string>(), [selection, selectionScope])
  const setSelected = (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
    setSelection((previous) => ({
      scope: selectionScope,
      ids: typeof next === 'function'
        ? next(previous.scope === selectionScope ? previous.ids : new Set<string>())
        : next,
    }))
  }
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [view, setView] = useState<'table' | 'board'>('table')
  const firstLoad = useRef(true)

  useEffect(() => {
    setPlaceholder('Search leads')
  }, [setPlaceholder])

  const load = async () => {
    try {
      const next = await fetchLeads()
      setLeads(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
      firstLoad.current = false
    }
  }

  useEffect(() => {
    let cancelled = false
    const run = () => {
      fetchLeads()
        .then((next) => {
          if (cancelled) return
          setLeads(next)
          setError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : 'Failed to load leads')
        })
        .finally(() => {
          if (cancelled) return
          setLoading(false)
          firstLoad.current = false
        })
    }
    run()
    const timer = window.setInterval(run, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      if (lead.booking_type !== leadType) return false
      if (!query.trim()) return true
      const haystack = [lead.phone, lead.contact_name, lead.destination, lead.origin, lead.hotel_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query.trim().toLowerCase())
    })
  }, [leads, leadType, query])

  const selectedLeads = useMemo(() => leads.filter((l) => selected.has(l.id)), [leads, selected])

  const typeCounts = useMemo(() => {
    const counts: Record<LeadType, number> = { hotel: 0, flight: 0, package: 0 }
    for (const lead of leads) {
      if (lead.booking_type in counts) counts[lead.booking_type as LeadType] += 1
    }
    return counts
  }, [leads])

  const todayCount = useMemo(
    () =>
      leads.filter((l) => l.booking_type === leadType && new Date(l.created_at).toDateString() === new Date().toDateString()).length,
    [leads, leadType],
  )

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filtered.map((l) => l.id)) : new Set())
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const markSelected = async (status: string) => {
    if (status === 'booked') {
      setBookOpen(true)
      return
    }
    try {
      await Promise.all([...selected].map((id) => updateLeadStatus(id, status)))
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update selected leads')
    }
  }

  const exportCsv = () => {
    const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
    const blob = new Blob(
      [
        [
          'phone,booking_type,origin,destination,travel_date,return_date,adults_count,children_count,status,source',
          ...filtered.map((l) =>
            [
              l.phone,
              l.booking_type,
              l.origin || '',
              l.destination,
              String(l.travel_date).slice(0, 10),
              String(l.return_date).slice(0, 10),
              l.adults_count,
              l.children_count,
              l.status || 'new',
              l.source || '',
            ].map(cell).join(','),
          ),
        ].join('\n'),
      ],
      { type: 'text/csv' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${leadType}-leads-export.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openLead = (id: string) => navigate(`/leads/${id}`)
  const openChat = (id: string) => navigate(`/inbox/${encodeURIComponent(customerThreadId(id))}`)

  return (
    <div className="p-3 pb-24 sm:p-4 lg:p-5">
      <PageHeader
        title={translate("Leads")}
        subtitle={
          <>
            {translateCount('{count} {type} lead{suffix}', filtered.length, {
              type: translate(leadType),
              suffix: filtered.length === 1 ? '' : 's',
            })}
            {todayCount > 0 && (
              <>
                {' · '}
                <strong className="!text-shop-accent">{todayCount}{' '}{translate("created today")}</strong>
              </>
            )}
          </>
        }
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            <OverflowMenu
              items={[
                { id: 'import', label: translate("Import CSV"), onClick: () => setImportOpen(true) },
                { id: 'export', label: translate("Export CSV"), onClick: exportCsv },
              ]}
            />
            <Button variant="primary" icon={<Plus strokeWidth={1.8} />} onClick={() => setAddOpen(true)}>
              {translate("New lead")}</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel="Lead type"
          value={leadType}
          onChange={(id) => navigate(`/leads/${id}`)}
          items={[
            { id: 'hotel', label: translate("Hotel"), count: typeCounts.hotel },
            { id: 'flight', label: translate("Flight"), count: typeCounts.flight },
            { id: 'package', label: translate('Package'), count: typeCounts.package },
          ]}
        />
        {filtered.length > 0 && view === 'table' && (
          <label className="flex items-center gap-2 text-xs font-medium text-shop-muted">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((lead) => selected.has(lead.id))}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            {translate("Select all")}</label>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-shop-border bg-white px-4 py-3 text-sm">
          <span className="font-medium">{selected.size}{' '}{translate("selected")}</span>
          <Button size="sm" onClick={() => void markSelected('contacted')}>
            {translate("Contacted")}</Button>
          <Button size="sm" onClick={() => void markSelected('booked')}>
            {translate("Booked")}</Button>
          <Button size="sm" onClick={() => void markSelected('archived')}>
            {translate("Archive")}</Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              void confirm({
                title: translate("Delete {value0} lead{value1}?", { value0: translate(String(selected.size)), value1: translate(String(selected.size === 1 ? '' : 's')) }),
                description: translate("They are removed for everyone, with their quote drafts and versions. This can’t be undone."),
                confirmLabel: translate("Delete {value0} lead{value1}", { value0: translate(String(selected.size)), value1: translate(String(selected.size === 1 ? '' : 's')) }),
              }).then((ok) => {
                if (!ok) return
                void deleteLeadsBulk([...selected]).then(() => {
                  setSelected(new Set())
                  void load()
                })
              })
            }}
          >
            {translate("Delete")}</Button>
        </div>
      )}

      {!loading && error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{translate(error)}</div>}

      <section className="overflow-hidden rounded-xl border border-shop-border bg-white">
        {loading && <TableSkeleton rows={6} label={translate("Loading leads")} />}
        {!loading && error && filtered.length === 0 && <EmptyState title={translate("Could not load leads")} description={translate("Try loading this list again.")} action={<Button onClick={() => void load()}>{translate("Retry")}</Button>} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            title={query.trim() ? translate("No matching leads") : translate("No {value0} leads yet", { value0: translate(String(leadType)) })}
            description={query.trim() ? translate("Try a different name, phone number, or destination.") : translate("Add a lead or wait for WhatsApp intake to start quoting.")}
            action={
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                {translate("Add lead")}</Button>
            }
          />
        )}

        {!loading && filtered.length > 0 && view === 'table' && (
          <LeadsTable
            leads={filtered}
            selected={selected}
            onToggleOne={toggleOne}
            onOpen={openLead}
            onChat={openChat}
            onDelete={(id) => {
              void confirm({
                title: translate("Delete this lead?"),
                description: translate("It is removed for everyone, with its quote draft and versions. This can’t be undone."),
                confirmLabel: translate("Delete lead"),
              }).then((ok) => {
                if (ok) void deleteLead(id).then(load)
              })
            }}
          />
        )}

        {!loading && filtered.length > 0 && view === 'board' && (
          <div className="overflow-x-auto p-3" role="region" aria-label={translate("Leads by stage")} tabIndex={0}>
            <div className="flex min-w-max items-start gap-3">
              {BOARD_STAGES.map((stage) => {
                // Exact stage: a lost or archived lead is not "intake", so it is not on the board.
                const column = filtered.filter((lead) => (lead.lifecycle_status || 'intake') === stage)
                return (
                  <section
                    key={stage}
                    aria-label={translate("{value0} leads", { value0: translate(String(lifecycleLabel(stage).toLowerCase())) })}
                    className="flex w-[248px] flex-none flex-col gap-2 rounded-xl bg-neutral-bg p-2.5"
                  >
                    <div className="flex items-center justify-between px-1 pb-1 pt-0.5">
                      <LifecycleBadge status={stage} />
                      <span className="font-bold tabular-nums text-shop-muted">{column.length}</span>
                    </div>
                    {column.map((lead) => {
                      const next = nextActionFor(lead.lifecycle_status, lead.quote_status)
                      return (
                        <Link
                          key={lead.id}
                          to={`/leads/${lead.id}`}
                          className="flex flex-col gap-2 rounded-[10px] border border-shop-border bg-white p-3 text-shop-ink no-underline hover:border-slate-400"
                        >
                          <div className="flex justify-between gap-2">
                            <strong className="min-w-0 truncate">{leadPerson(lead)}</strong>
                            <span className="shrink-0 text-xs tabular-nums text-shop-muted">
                              <bdi dir="ltr">{formatWhen(lead.created_at)}</bdi>
                            </span>
                          </div>
                          <span className="truncate font-semibold">{leadTitle(lead)}</span>
                          <span className="text-xs tabular-nums text-shop-muted">
                            <bdi dir="ltr">{formatDate(lead.travel_date)}</bdi> → <bdi dir="ltr">{formatDate(lead.return_date)}</bdi> · {lead.adults_count}A
                            {lead.children_count ? ` · ${lead.children_count}C` : ''}
                          </span>
                          <div className="h-px bg-neutral-bg" />
                          <span
                            className={`text-[13px] font-semibold ${next.blocker ? 'text-danger' : 'text-neutral-fg'}`}
                          >
                            {next.text}
                          </span>
                        </Link>
                      )
                    })}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void load()} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void load()} />
      <BookLeadsModal
        open={bookOpen}
        leads={selectedLeads}
        onClose={() => setBookOpen(false)}
        onConfirm={async (drafts) => {
          await Promise.all(drafts.map((d) => updateLeadStatus(d.id, 'booked', d.name, d.email)))
          setSelected(new Set())
          await load()
        }}
      />
      {dialog}
    </div>
  )
}
