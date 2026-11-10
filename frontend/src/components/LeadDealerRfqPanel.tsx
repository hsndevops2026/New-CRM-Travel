import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, Send } from 'lucide-react'
import Button from './ui/Button'
import SegmentedControl from './ui/SegmentedControl'
import StatusBadge from './ui/StatusBadge'
import {
  dispatchRfq,
  fetchDealerRequests,
  fetchDealerResponses,
  fetchDealers,
  fetchWhatsAppGroups,
  looksLikeGroupJid,
  type Dealer,
  type DealerRequest,
  type DealerResponse,
  type WhatsAppGroup,
} from '../lib/dealers'
import type { Lead } from '../lib/leads'
import { offerPrice, requestState } from '../lib/dealerStatus'

type Props = {
  lead: Lead
  onUpdated?: () => void
}

type Channel = 'group' | 'dealer'

function dealersForLead(dealers: Dealer[], lead: Lead) {
  const dest = String(lead.destination || '').toLowerCase()
  const matched = dealers.filter((d) =>
    (d.destinations || []).some((place) => dest.includes(place.toLowerCase()) || place.toLowerCase().includes(dest)),
  )
  return matched.length ? matched : dealers
}

export default function LeadDealerRfqPanel({ lead, onUpdated }: Props) {
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [groups, setGroups] = useState<WhatsAppGroup[]>([])
  const [sessionCount, setSessionCount] = useState(0)
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [requests, setRequests] = useState<DealerRequest[]>([])
  const [replies, setReplies] = useState<DealerResponse[]>([])
  // When the lists were fetched — "waiting 3 h" is measured from here, not from each render.
  const [now, setNow] = useState(() => Date.now())
  const [channel, setChannel] = useState<Channel>('group')
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const [selectedGroupJid, setSelectedGroupJid] = useState('')
  const [customGroupJid, setCustomGroupJid] = useState('')
  const [deadlineHours, setDeadlineHours] = useState(24)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [dealerList, requestList, replyList, groupResult] = await Promise.all([
        fetchDealers(),
        fetchDealerRequests({ leadId: lead.id }),
        fetchDealerResponses({ leadId: lead.id }).catch(() => [] as DealerResponse[]),
        fetchWhatsAppGroups().catch(() => ({
          groups: [] as WhatsAppGroup[],
          sessionCount: 0,
          sessionStatus: null,
          sessionName: null,
        })),
      ])
      setDealers(dealerList)
      setRequests(requestList)
      setReplies(replyList)
      setNow(Date.now())
      setGroups(groupResult.groups)
      setSessionCount(groupResult.sessionCount)
      setSessionStatus(groupResult.sessionStatus || null)
      setSessionName(groupResult.sessionName || null)
      const suggested = dealersForLead(dealerList, lead)
      if (!selectedDealerId && suggested[0]) setSelectedDealerId(suggested[0].id)
      if (!selectedGroupJid && groupResult.groups[0]) setSelectedGroupJid(groupResult.groups[0].jid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dealers')
    } finally {
      setLoading(false)
    }
  }

  const [loadedForLeadId, setLoadedForLeadId] = useState(lead.id)
  if (lead.id !== loadedForLeadId) {
    setLoadedForLeadId(lead.id)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchDealers(),
      fetchDealerRequests({ leadId: lead.id }),
      fetchDealerResponses({ leadId: lead.id }).catch(() => [] as DealerResponse[]),
      fetchWhatsAppGroups().catch(() => ({
        groups: [] as WhatsAppGroup[],
        sessionCount: 0,
        sessionStatus: null,
        sessionName: null,
      })),
    ])
      .then(([dealerList, requestList, replyList, groupResult]) => {
        if (cancelled) return
        setDealers(dealerList)
        setRequests(requestList)
        setReplies(replyList)
        setNow(Date.now())
      setNow(Date.now())
        setGroups(groupResult.groups)
        setSessionCount(groupResult.sessionCount)
        setSessionStatus(groupResult.sessionStatus || null)
        setSessionName(groupResult.sessionName || null)
        const suggested = dealersForLead(dealerList, lead)
        setSelectedDealerId((current) => current || suggested[0]?.id || '')
        setSelectedGroupJid((current) => current || groupResult.groups[0]?.jid || '')
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
  }, [lead.id, lead])

  const suggestedDealers = useMemo(() => dealersForLead(dealers, lead), [dealers, lead])
  const dealerGroups = useMemo(() => {
    const seen = new Set<string>()
    const items: WhatsAppGroup[] = []
    for (const dealer of dealers) {
      const raw = String(dealer.whatsapp_group_id || '').trim()
      if (!raw || !looksLikeGroupJid(raw) || seen.has(raw)) continue
      seen.add(raw)
      items.push({ jid: raw, name: `${dealer.name} group`, source: 'dealer' })
    }
    return items
  }, [dealers])
  const groupOptions = useMemo(() => {
    const byJid = new Map<string, WhatsAppGroup>()
    for (const group of dealerGroups) byJid.set(group.jid, group)
    for (const group of groups) byJid.set(group.jid, group)
    return [...byJid.values()]
  }, [groups, dealerGroups])
  const groupJidToSend = customGroupJid.trim() || selectedGroupJid

  const refreshGroups = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const groupResult = await fetchWhatsAppGroups(true)
      setGroups(groupResult.groups)
      setSessionCount(groupResult.sessionCount)
      setSessionStatus(groupResult.sessionStatus || null)
      setSessionName(groupResult.sessionName || null)
      if (!selectedGroupJid && groupResult.groups[0]) setSelectedGroupJid(groupResult.groups[0].jid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh groups')
    } finally {
      setRefreshing(false)
    }
  }

  const handleDispatch = async () => {
    if (channel === 'group' && !looksLikeGroupJid(groupJidToSend)) {
      setError('Paste a WhatsApp group ID ending in @g.us, or pick a listed group')
      return
    }
    if (channel === 'dealer' && !selectedDealerId) {
      setError('Select a dealer number')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const group = groupOptions.find((item) => item.jid === groupJidToSend)
      const sent = await dispatchRfq({
        leadId: lead.id,
        dealerId: channel === 'dealer' ? selectedDealerId : undefined,
        groupJid: channel === 'group' ? groupJidToSend : undefined,
        groupName: channel === 'group' ? group?.name || 'WhatsApp group' : undefined,
        deadlineHours,
      })
      setSuccess(`RFQ ${sent.request_code} sent via WhatsApp`)
      await load()
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send RFQ')
    } finally {
      setBusy(false)
    }
  }

  const canSend =
    channel === 'group' ? looksLikeGroupJid(groupJidToSend) : Boolean(selectedDealerId)

  const repliesByRequest = (id: string) => replies.filter((r) => r.dealer_request_id === id)
  const FIELD = 'h-9 w-full rounded-lg border border-line-strong bg-white px-3 text-sm max-sm:h-11'

  return (
    <div className="flex flex-col gap-5">
      {requests.length > 0 && (
        <section aria-labelledby="rq-h" className="flex flex-col gap-2.5">
          <h2 id="rq-h" className="text-base font-bold">Requests for quotation</h2>
          <div className="overflow-x-auto rounded-[10px] border border-shop-border bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5">Dealer</th>
                  <th className="px-3.5 py-2.5">Channel</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Offer</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => {
                  const mine = repliesByRequest(req.id)
                  const state = requestState(req, mine, now)
                  const price = offerPrice(mine[0])
                  return (
                    <tr key={req.id} className="border-b border-neutral-bg last:border-0">
                      <td className="px-3.5 py-3">
                        <strong>{req.group_name || req.dealer_name || 'WhatsApp'}</strong>
                        <div className="font-mono text-xs text-shop-muted">{req.request_code}</div>
                      </td>
                      <td className="px-3.5 py-3">{req.whatsapp_group_jid ? 'WhatsApp group' : 'Direct message'}</td>
                      <td className="px-3.5 py-3">
                        <StatusBadge
                          label={state.label}
                          tone={state.tone}
                          icon={state.tone === 'success' ? <Check /> : state.tone === 'warning' ? <Clock /> : undefined}
                        />
                      </td>
                      <td className="px-3.5 py-3 font-bold tabular-nums">
                        {price ?? <span className="font-normal text-shop-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="nd-h" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="nd-h" className="text-base font-bold">{requests.length ? 'Ask more dealers' : 'Ask dealers for deals'}</h2>
          <span className="text-[13px] text-shop-muted">Dealers must reply with the REQ code.</span>
        </div>

        <div className="flex flex-col gap-3.5 rounded-[10px] border border-shop-border bg-white p-4">
          <div className="self-start">
          <SegmentedControl
            ariaLabel="Where to send the request"
            value={channel}
            onChange={(id) => setChannel(id as Channel)}
            items={[
              { id: 'group', label: 'WhatsApp group' },
              { id: 'dealer', label: 'Dealer number' },
            ]}
          />
          </div>

          {loading ? (
            <p className="text-sm text-shop-muted">Loading destinations…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              {channel === 'group' ? (
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600">Group</span>
                    <button
                      type="button"
                      onClick={() => void refreshGroups()}
                      className="-my-2 py-2 text-xs font-semibold text-shop-accent hover:underline max-sm:-my-3 max-sm:py-3"
                      disabled={refreshing}
                    >
                      {refreshing ? 'Refreshing…' : 'Refresh list'}
                    </button>
                  </div>
                  {groupOptions.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-shop-muted">
                      {sessionStatus === 'connected'
                        ? `WhatsApp is connected${sessionName ? ` as ${sessionName}` : ''}, but Wasender has not synced groups (${sessionCount} from the session). Reconnect this number in Wasender (unlink the device and scan QR again), then Refresh. A message in the group will also make it appear here.`
                        : 'This WhatsApp session has no groups yet. Paste a group ID below, or save one on the dealer.'}
                    </p>
                  ) : (
                    <select
                      aria-label="Group"
                      value={selectedGroupJid}
                      onChange={(e) => setSelectedGroupJid(e.target.value)}
                      className={FIELD}
                    >
                      {groupOptions.map((group) => (
                        <option key={group.jid} value={group.jid}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold text-slate-600">Or paste group ID</span>
                    <input
                      value={customGroupJid}
                      onChange={(e) => setCustomGroupJid(e.target.value)}
                      placeholder="120363xxxxxxxxxx@g.us"
                      className={`${FIELD} font-mono`}
                    />
                  </label>
                </div>
              ) : (
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-semibold text-slate-600">Dealer</span>
                  {suggestedDealers.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-shop-muted">
                      No dealers configured. Add dealers first.
                    </p>
                  ) : (
                    <select
                      value={selectedDealerId}
                      onChange={(e) => setSelectedDealerId(e.target.value)}
                      className={FIELD}
                    >
                      {suggestedDealers.map((dealer) => (
                        <option key={dealer.id} value={dealer.id}>
                          {dealer.name}
                          {dealer.phone ? ` · ${dealer.phone}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              )}
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-semibold text-slate-600">Deadline (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={deadlineHours}
                  onChange={(e) => setDeadlineHours(Number(e.target.value) || 24)}
                  className={`${FIELD} sm:w-28`}
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-shop-muted">Sends from the agency WhatsApp number</span>
            <Button
              variant="secondary"
              icon={<Send />}
              loading={busy}
              disabled={!canSend}
              onClick={() => void handleDispatch()}
              className="border-shop-accent text-shop-accent"
            >
              Send RFQ
            </Button>
          </div>

          {success && (
            <div role="status" className="rounded-lg bg-shop-green-bg px-3 py-2 text-sm text-primary-800">
              {success}
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">{error}</div>
          )}
        </div>
      </section>
    </div>
  )
}
