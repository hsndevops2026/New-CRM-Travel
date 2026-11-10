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

export default function DealersPage() {
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

  const pills = [
    { id: 'all', label: 'All' },
    ...destinations.map((d) => ({ id: d, label: d })),
    ...(groupCount > 0 ? [{ id: GROUPS_ONLY, label: 'Groups only' }] : []),
  ]
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 pb-24 sm:p-6">
      <PageHeader
        title="Dealers"
        subtitle={
          <>
            <strong>{dealers.length}</strong> supplier{dealers.length === 1 ? '' : 's'} ·{' '}
            <strong>{groupCount}</strong> WhatsApp group{groupCount === 1 ? '' : 's'} · used for RFQs from any lead
          </>
        }
        actions={
          <>
            {admin?.role === 'admin' && (
              <Button onClick={() => setCountryCodesOpen(true)}>Manage country codes</Button>
            )}
            <Button variant="primary" icon={<Plus />} onClick={() => setDealerEditor(null)}>
              Add dealer
            </Button>
          </>
        }
      />

      {unmatched.length > 0 && (
        <Banner
          tone="warning"
          title={`${unmatched.length} unmatched dealer message${unmatched.length === 1 ? '' : 's'}`}
          action={
            <button type="button" onClick={() => setUnmatchedOpen((open) => !open)} aria-expanded={unmatchedOpen}>
              {unmatchedOpen ? 'Hide' : 'Review'}
            </button>
          }
        >
          These replies did not carry a REQ code, so they could not be matched to a lead.
        </Banner>
      )}

      {actionError && (
        <Banner
          tone="danger"
          title="That did not work"
          action={<button type="button" onClick={() => setActionError(null)}>Dismiss</button>}
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
                  {msg.from_number || msg.group_id} · {formatWhen(msg.created_at || '')}
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{msg.body}</p>
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-shop-accent hover:underline"
                  onClick={() => void resolveUnmatchedDealerMessage(msg.id).then(() => void load())}
                >
                  Mark resolved
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && dealers.length > 0 && pills.length > 1 && (
        <FilterPills ariaLabel="Destination" value={destination} onChange={setDestination} items={pills} />
      )}

      <section className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
        {loading && <TableSkeleton rows={5} label="Loading dealers" />}
        {!loading && error && (
          <EmptyState
            tone="danger"
            icon={<CircleAlert />}
            title="Dealers could not be loaded"
            description={error}
            action={<Button variant="primary" onClick={() => void load()}>Retry</Button>}
          />
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            tone={dealers.length ? 'neutral' : 'default'}
            icon={dealers.length ? <Search /> : undefined}
            title={dealers.length ? 'No dealers match' : 'No dealers yet'}
            description={dealers.length ? 'Try a different name, phone number or destination, or clear the filter.' : 'Add a dealer so you can send RFQs from a lead.'}
            action={
              dealers.length ? (
                <Button onClick={() => setDestination('all')}>Clear filters</Button>
              ) : (
                <Button variant="primary" onClick={() => setDealerEditor(null)}>
                  Add dealer
                </Button>
              )
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5">Dealer</th>
                  <th className="px-3 py-2.5">WhatsApp</th>
                  <th className="px-3 py-2.5">Destinations</th>
                  <th className="px-3 py-2.5">Services</th>
                  <th className="px-3 py-2.5">Activity</th>
                  <th className="relative w-24 px-3.5 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dealer) => {
                  const stats = dealerStats(dealer.id, requests)
                  return (
                    <tr key={dealer.id} className="border-b border-neutral-bg last:border-0 hover:bg-shop-bg">
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="grid size-8 shrink-0 place-items-center rounded-lg bg-dealer-bg text-xs font-bold text-dealer-fg"
                          >
                            {dealerInitials(dealer.name)}
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <strong>{dealer.name}</strong>
                            {dealer.company && <span className="text-xs text-shop-muted">{dealer.company}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="tabular-nums">{formatPhone(dealer.phone)}</span>
                          <div className="flex gap-1">
                            <StatusBadge label="Direct" tone="success" />
                            {dealer.whatsapp_group_id && <StatusBadge label="Group" tone="info" />}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(dealer.destinations ?? []).length ? (
                            dealer.destinations!.map((place) => (
                              <span key={place} className="inline-flex h-[22px] items-center rounded-md bg-neutral-bg px-2 text-xs font-semibold text-neutral-fg">
                                {place}
                              </span>
                            ))
                          ) : (
                            <span className="text-shop-muted">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {(dealer.services ?? []).length ? dealer.services!.map(serviceLabel).join(', ') : <span className="text-shop-muted">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {stats.rfqs ? (
                          <div className="flex flex-col tabular-nums">
                            <span>{stats.lastAt ? `Last RFQ ${formatWhen(stats.lastAt)}` : `${stats.rfqs} RFQs`}</span>
                            <span className="text-xs text-shop-muted">
                              {stats.rfqs} RFQ{stats.rfqs === 1 ? '' : 's'} · {stats.replyRate}% reply
                            </span>
                          </div>
                        ) : (
                          <span className="text-shop-muted">No RFQs yet</span>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label={`Edit ${dealer.name}`}
                            icon={<Pencil />}
                            onClick={() => setDealerEditor(dealer)}
                          />
                          <OverflowMenu
                            label={`More actions for ${dealer.name}`}
                            items={[
                              { id: 'inbox', label: 'Open Inbox', onClick: () => navigate('/inbox') },
                              {
                                id: 'delete',
                                label: 'Delete dealer…',
                                tone: 'danger',
                                onClick: async () => {
                                  const ok = await confirm({
                                    title: `Delete ${dealer.name}?`,
                                    description: 'The dealer is removed from the list. RFQs already sent to them stay on their leads.',
                                    confirmLabel: 'Delete dealer',
                                  })
                                  if (!ok) return
                                  setActionError(null)
                                  try {
                                    await deleteDealer(dealer.id)
                                    await load()
                                  } catch (err) {
                                    setActionError(err instanceof Error ? err.message : 'Failed to delete dealer')
                                  }
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
