import { t as translate, translateCount, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Pencil, Plus, Search } from 'lucide-react'
import CountryCodesModal from '../components/CountryCodesModal'
import DealerModal from '../components/DealerModal'
import Button from '../components/ui/Button'
import FilterPills from '../components/ui/FilterPills'
import StatusBadge from '../components/ui/StatusBadge'
import { TableSkeleton } from '../components/ui/Skeleton'
import Banner from '../components/ui/Banner'
import EmptyState from '../components/ui/EmptyState'
import OverflowMenu from '../components/ui/OverflowMenu'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useSearch } from '../hooks/useSearch'
import { useConfirm } from '../hooks/useConfirm'
import {
  deleteDealer,
  fetchDealerCountryCodes,
  fetchDealerRequests,
  fetchDealers,
  fetchUnmatchedDealerMessages,
  resolveUnmatchedDealerMessage,
  type Dealer,
  type DealerCountryCode,
  type DealerRequest,
  type UnmatchedDealerMessage,
} from '../lib/dealers'
import { formatPhone, formatWhen } from '../lib/leads'
import { dealerInitials, dealerStats, destinationOptions, filterDealers, GROUPS_ONLY, serviceLabel } from '../lib/dealerView'

function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-xl border border-shop-border bg-white px-4 py-3">
      <span className="text-xs font-semibold text-shop-muted">{label}</span>
      <span className="text-2xl font-extrabold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-shop-muted">{hint}</span>}
    </li>
  )
}

function DealerName({ dealer }: { dealer: Dealer }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-dealer-bg text-xs font-bold text-dealer-fg">
        {dealerInitials(dealer.name)}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <strong dir="auto" className="truncate text-start">{dealer.name}</strong>
        {dealer.company && <span dir="auto" className="truncate text-start text-xs text-shop-muted">{dealer.company}</span>}
      </div>
    </div>
  )
}

function ChannelBadges({ dealer }: { dealer: Dealer }) {
  useI18n()
  return (
    <div className="flex gap-1">
      <StatusBadge label={translate("Direct")} tone="success" />
      {dealer.whatsapp_group_id && <StatusBadge label={translate("Group")} tone="info" />}
    </div>
  )
}

function Places({ dealer }: { dealer: Dealer }) {
  const places = dealer.destinations ?? []
  if (!places.length) return <span className="text-shop-muted">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {places.map((place) => (
        <span key={place} dir="auto" className="inline-flex h-6 items-center rounded-full border border-shop-border bg-[#f8fafb] px-2.5 text-xs font-semibold text-neutral-fg">
          {place}
        </span>
      ))}
    </div>
  )
}

/** How a dealer answers: a reply-rate bar (green good, amber middling, red poor), requests and the last one. */
function Activity({ stats }: { stats: ReturnType<typeof dealerStats> }) {
  useI18n()
  if (!stats.rfqs) return <span className="text-shop-muted">{translate("No RFQs yet")}</span>
  const rate = stats.replyRate ?? 0
  const tone = rate >= 60 ? 'bg-emerald-500' : rate >= 30 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex min-w-[170px] flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-bg" role="meter" aria-label={translate("Reply rate")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate}>
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(rate, 4)}%` }} />
        </div>
        <span className="text-xs font-bold tabular-nums">{rate}%</span>
      </div>
      <span className="text-xs text-shop-muted tabular-nums">
        {translate('{count} RFQ{suffix}', { count: stats.rfqs, suffix: stats.rfqs === 1 ? '' : 's' })}
        {stats.lastAt ? <> · {translate("last {value0}", { value0: formatWhen(stats.lastAt) })}</> : null}
      </span>
    </div>
  )
}

function DealerActions({ dealer, onEdit, onInbox, onDelete }: { dealer: Dealer; onEdit: () => void; onInbox: () => void; onDelete: () => void }) {
  useI18n()
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button variant="ghost" size="sm" iconOnly aria-label={translate("Edit {value0}", { value0: translate(String(dealer.name)) })} icon={<Pencil />} onClick={onEdit} />
      <OverflowMenu
        label={translate("More actions for {value0}", { value0: translate(String(dealer.name)) })}
        items={[
          { id: 'inbox', label: translate("Open Inbox"), onClick: onInbox },
          { id: 'delete', label: translate("Delete dealer…"), tone: 'danger', onClick: onDelete },
        ]}
      />
    </div>
  )
}

export default function DealersPage() {
  useI18n()
  const { admin } = useAuth()
  const { query, setPlaceholder } = useSearch()
  const { confirm, dialog } = useConfirm()
  const navigate = useNavigate()
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [requests, setRequests] = useState<DealerRequest[]>([])
  const [destination, setDestination] = useState('all')
  const [countryCodes, setCountryCodes] = useState<DealerCountryCode[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedDealerMessage[]>([])
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dealerEditor, setDealerEditor] = useState<Dealer | null | undefined>(undefined)
  const [countryCodesOpen, setCountryCodesOpen] = useState(false)

  useEffect(() => {
    setPlaceholder('Search dealers')
  }, [setPlaceholder])

  const load = async () => {
    setLoading(true)
    try {
      const [d, u, codes, reqs] = await Promise.all([
        fetchDealers(),
        fetchUnmatchedDealerMessages(false),
        fetchDealerCountryCodes(),
        fetchDealerRequests().catch(() => [] as DealerRequest[]),
      ])
      setDealers(d)
      setRequests(reqs)
      setUnmatched(u)
      setCountryCodes(codes)
      setError(null)
      setActionError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dealers')
    } finally {
      setLoading(false)
    }
  }

  const loadCountryCodes = async () => {
    const codes = await fetchDealerCountryCodes()
    setCountryCodes(codes)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchDealers(),
      fetchUnmatchedDealerMessages(false),
      fetchDealerCountryCodes(),
      fetchDealerRequests().catch(() => [] as DealerRequest[]),
    ])
      .then(([d, u, codes, reqs]) => {
        if (cancelled) return
        setDealers(d)
        setRequests(reqs)
        setUnmatched(u)
        setCountryCodes(codes)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load dealers')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => filterDealers(dealers, { query, destination }), [dealers, query, destination])
  const destinations = useMemo(() => destinationOptions(dealers), [dealers])
  const groupCount = useMemo(() => dealers.filter((d) => d.whatsapp_group_id).length, [dealers])

  const totals = useMemo(() => {
    const direct = requests.filter((r) => r.dealer_id)
    const replied = direct.filter((r) => r.status === 'replied').length
    return { rfqs: requests.length, replied, rate: direct.length ? Math.round((replied / direct.length) * 100) : null }
  }, [requests])
  const showList = !loading && !error && filtered.length > 0

  const removeDealer = async (dealer: Dealer) => {
    const ok = await confirm({
      title: translate("Delete {value0}?", { value0: translate(String(dealer.name)) }),
      description: translate("The dealer is removed from the list. RFQs already sent to them stay on their leads."),
      confirmLabel: translate("Delete dealer"),
      tone: 'danger',
    })
    if (!ok) return
    setActionError(null)
    try {
      await deleteDealer(dealer.id)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : translate("Failed to delete dealer"))
    }
  }

  const pills = [
    { id: 'all', label: 'All' },
    ...destinations.map((d) => ({ id: d, label: d })),
    ...(groupCount > 0 ? [{ id: GROUPS_ONLY, label: 'Groups only' }] : []),
  ]
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate("Dealers")}
        subtitle={
          <>
            {translateCount('{count} supplier{suffix}', dealers.length, { suffix: dealers.length === 1 ? '' : 's' })} ·{' '}
            {translateCount('{count} WhatsApp group{suffix}', groupCount, { suffix: groupCount === 1 ? '' : 's' })}{' '}{translate("· used for RFQs from any lead")}</>
        }
        actions={
          <>
            {admin?.role === 'admin' && (
              <Button onClick={() => setCountryCodesOpen(true)}>{translate("Manage country codes")}</Button>
            )}
            <Button variant="primary" icon={<Plus />} onClick={() => setDealerEditor(null)}>
              {translate("Add dealer")}</Button>
          </>
        }
      />

      {unmatched.length > 0 && (
        <Banner
          tone="warning"
          title={translate("{value0} unmatched dealer message{value1}", { value0: translate(String(unmatched.length)), value1: translate(String(unmatched.length === 1 ? '' : 's')) })}
          action={
            <button type="button" onClick={() => setUnmatchedOpen((open) => !open)} aria-expanded={unmatchedOpen}>
              {unmatchedOpen ? translate('Hide') : translate('Review')}
            </button>
          }
        >
          {translate("These replies did not carry a REQ code, so they could not be matched to a lead.")}</Banner>
      )}

      {actionError && (
        <Banner
          tone="danger"
          title={translate("That did not work")}
          action={<button type="button" onClick={() => setActionError(null)}>{translate("Dismiss")}</button>}
        >
          {actionError}
        </Banner>
      )}

      {unmatchedOpen && unmatched.length > 0 && (
        <section className="rounded-[10px] border border-[#FCD34D] bg-white p-3">
          <div className="space-y-2">
            {unmatched.slice(0, 5).map((msg: UnmatchedDealerMessage) => (
              <div key={msg.id} className="rounded-lg bg-shop-bg px-3 py-2 text-sm">
                <div className="text-xs text-shop-muted">
                  {msg.from_number || msg.group_id} · <bdi dir="ltr">{formatWhen(msg.created_at || '')}</bdi>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{msg.body}</p>
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-shop-accent hover:underline"
                  onClick={() => void resolveUnmatchedDealerMessage(msg.id).then(() => void load())}
                >
                  {translate("Mark resolved")}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && dealers.length > 0 && (
        <ul className="grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          <StatTile label={translate("Dealers")} value={dealers.length} />
          <StatTile label={translate("WhatsApp groups")} value={groupCount} />
          <StatTile label={translate("Quote requests sent")} value={totals.rfqs} />
          <StatTile
            label={translate("Replied")}
            value={totals.rate == null ? '—' : `${totals.rate}%`}
            hint={totals.rfqs ? translate("{value0} of {value1} requests", { value0: totals.replied, value1: totals.rfqs }) : translate("No requests yet")}
          />
        </ul>
      )}

      {!loading && !error && dealers.length > 0 && pills.length > 1 && (
        <FilterPills ariaLabel="Destination" value={destination} onChange={setDestination} items={pills} />
      )}

      <section className={showList ? '' : 'overflow-hidden rounded-xl border border-shop-border bg-white'}>
        {loading && <TableSkeleton rows={5} label={translate("Loading dealers")} />}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title={translate("Dealers could not be loaded")}
            description={translate(error)}
            action={<Button variant="primary" onClick={() => void load()}>{translate("Retry")}</Button>}
          />
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            tone={dealers.length ? 'neutral' : 'default'}
            icon={dealers.length ? <Search /> : undefined}
            title={dealers.length ? translate("No dealers match") : translate("No dealers yet")}
            description={dealers.length ? translate("Try a different name, phone number or destination, or clear the filter.") : translate("Add a dealer so you can send RFQs from a lead.")}
            action={
              dealers.length ? (
                <Button onClick={() => setDestination('all')}>{translate("Clear filters")}</Button>
              ) : (
                <Button variant="primary" onClick={() => setDealerEditor(null)}>
                  {translate("Add dealer")}</Button>
              )
            }
          />
        )}
        {showList && (
          <>
            {/* Desktop: a table. */}
            <div className="overflow-x-auto rounded-xl border border-shop-border bg-white shadow-[var(--shadow-card)] max-md:hidden">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-shop-border bg-[#f8fafc] text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase [&>th]:text-start">
                    <th className="px-4 py-2.5">{translate("Dealer")}</th>
                    <th className="px-3 py-2.5">WhatsApp</th>
                    <th className="px-3 py-2.5">{translate("Destinations")}</th>
                    <th className="px-3 py-2.5">{translate("Services")}</th>
                    <th className="px-3 py-2.5">{translate("Activity")}</th>
                    <th className="w-24 px-4 py-2.5"><span className="sr-only">{translate("Actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((dealer) => {
                    const stats = dealerStats(dealer.id, requests)
                    return (
                      <tr key={dealer.id} className="border-b border-[#eef1f5] transition-colors last:border-0 hover:bg-[#f7fafb]">
                        <td className="px-4 py-3.5">
                          <DealerName dealer={dealer} />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-col items-start gap-1">
                            <span className="tabular-nums text-slate-700"><bdi dir="ltr">{formatPhone(dealer.phone)}</bdi></span>
                            <ChannelBadges dealer={dealer} />
                          </div>
                        </td>
                        <td className="px-3 py-3.5"><Places dealer={dealer} /></td>
                        <td className="px-3 py-3.5 text-slate-700">
                          {(dealer.services ?? []).length ? dealer.services!.map(serviceLabel).join(', ') : <span className="text-shop-muted">—</span>}
                        </td>
                        <td className="px-3 py-3.5"><Activity stats={stats} /></td>
                        <td className="px-4 py-3.5">
                          <DealerActions dealer={dealer} onEdit={() => setDealerEditor(dealer)} onInbox={() => navigate('/inbox')} onDelete={() => void removeDealer(dealer)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Phones: one card per dealer. */}
            <ul className="m-0 grid list-none gap-3 p-0 md:hidden">
              {filtered.map((dealer) => {
                const stats = dealerStats(dealer.id, requests)
                return (
                  <li key={dealer.id} className="flex flex-col gap-3 rounded-xl border border-shop-border bg-white p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1"><DealerName dealer={dealer} /></div>
                      <DealerActions dealer={dealer} onEdit={() => setDealerEditor(dealer)} onInbox={() => navigate('/inbox')} onDelete={() => void removeDealer(dealer)} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="tabular-nums text-slate-700"><bdi dir="ltr">{formatPhone(dealer.phone)}</bdi></span>
                      <ChannelBadges dealer={dealer} />
                    </div>
                    {(dealer.destinations ?? []).length > 0 && <Places dealer={dealer} />}
                    <Activity stats={stats} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      <DealerModal
        open={dealerEditor !== undefined}
        dealer={dealerEditor}
        countryCodes={countryCodes}
        stats={dealerEditor ? dealerStats(dealerEditor.id, requests) : null}
        onClose={() => setDealerEditor(undefined)}
        onSaved={() => {
          setDealerEditor(undefined)
          void load()
        }}
      />
      {admin?.role === 'admin' && (
        <CountryCodesModal
          open={countryCodesOpen}
          countryCodes={countryCodes}
          onClose={() => setCountryCodesOpen(false)}
          onChanged={loadCountryCodes}
        />
      )}
      {dialog}
    </div>
  )
}
