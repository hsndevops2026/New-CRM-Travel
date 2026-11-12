import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Link2, Lock, Mail, Send } from 'lucide-react'
import {
  lockVersion,
  sendVersion,
  fetchVersions,
  fetchDeliveries,
  retryDelivery,
  revokeVersion,
  openVersionPdf,
  type QuoteVersion,
  type QuoteDelivery,
  awaitingApproval,
  reviewVersion,
} from '../lib/quoteVersions'
import type { QuoteDraft } from '../lib/quoteDrafts'
import { currentVersion, deliveryTimeline, eventTime, versionStatusLabel, versionSummary } from '../lib/versionView'
import Button from './ui/Button'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import OverflowMenu from './ui/OverflowMenu'
import SegmentedControl from './ui/SegmentedControl'
import StatusBadge, { type BadgeTone } from './ui/StatusBadge'

type Props = {
  leadId: string
  leadPhone?: string | null
  leadEmail?: string | null
  draft: QuoteDraft | null
}

type Channel = 'whatsapp' | 'email'

// ── helpers ───────────────────────────────────────────────────────────────────

// Postgres hands numeric columns back as strings, so coerce before formatting.
function money(v: number | string | null, currency = 'USD') {
  const amount = v == null || v === '' ? NaN : Number(v)
  if (!Number.isFinite(amount)) return '—'
  try {
    return amount.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 })
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

const FIELD = 'h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm max-sm:h-11'
const LABEL = 'text-xs font-semibold text-slate-600'
const CAP = 'text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase'

const VERSION_TONE: Record<string, BadgeTone> = {
  sent: 'info',
  accepted: 'success',
  revoked: 'neutral',
}

const EVENT_DOT: Record<string, string> = {
  success: 'bg-shop-green-bg text-primary-800',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warn-bg text-warn-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
}

// ── version card ──────────────────────────────────────────────────────────────

function VersionCard({
  version,
  current,
  selected,
  onSelect,
  onRevoked,
  onReviewed,
}: {
  version: QuoteVersion
  current: boolean
  selected: boolean
  onSelect: () => void
  onRevoked: (id: string) => void
  onReviewed: (version: QuoteVersion) => void
}) {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const [reviewing, setReviewing] = useState<'approved' | 'rejected' | null>(null)
  const [askingChanges, setAskingChanges] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const review = async (decision: 'approved' | 'rejected') => {
    setReviewing(decision)
    setError(null)
    try {
      onReviewed(await reviewVersion(version.id, decision, decision === 'rejected' ? reviewNote : undefined))
      setAskingChanges(false)
      setReviewNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setReviewing(null)
    }
  }
  const { confirm, dialog } = useConfirm()
  const [openingPdf, setOpeningPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revoked = version.status === 'revoked'
  const margin = version.snapshot?.pricing?.gross_margin_pct
  const summary = versionSummary(version)
  const created = eventTime(version.created_at, new Date())

  const openPdf = async () => {
    setError(null)
    setOpeningPdf(true)
    try {
      await openVersionPdf(version.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open PDF')
    } finally {
      setOpeningPdf(false)
    }
  }

  const revoke = async () => {
    setError(null)
    const ok = await confirm({
      title: translate("Revoke quote v{value0}?", { value0: translate(String(version.version_number)) }),
      description: translate("The customer’s link for v{value0} will stop working and show “This quote has been replaced”. Other versions are not affected. This can’t be undone.", { value0: translate(String(version.version_number)) }),
      confirmLabel: translate("Revoke v{value0}", { value0: translate(String(version.version_number)) }),
    })
    if (!ok) return
    try {
      await revokeVersion(version.id)
      onRevoked(version.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke')
    }
  }

  return (
    <article
      aria-label={translate("Version {value0}, {value1}", { value0: translate(String(version.version_number)), value1: translate(String(revoked ? 'revoked' : current ? 'current' : versionStatusLabel(version.status))) })}
      className={`overflow-hidden rounded-[10px] bg-white ${
        selected && !revoked ? 'border-2 border-shop-accent' : 'border border-shop-border'
      } ${revoked ? 'opacity-85' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`grid size-11 shrink-0 place-items-center rounded-[10px] font-extrabold ${
              revoked ? 'bg-neutral-bg text-neutral-fg' : 'bg-shop-accent text-white'
            }`}
          >
            v{version.version_number}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-base">{version.snapshot?.title || translate("Quote v{value0}", { value0: translate(String(version.version_number)) })}</strong>
              <StatusBadge
                label={versionStatusLabel(version.status)}
                tone={VERSION_TONE[version.status] || 'neutral'}
                icon={version.status === 'accepted' ? <Check /> : undefined}
                className={revoked ? 'line-through' : ''}
              />
              {current && <StatusBadge label={translate("Current")} tone="neutral" />}
              {version.approval_status === 'pending' && <StatusBadge label={translate('Waiting for manager approval')} tone="warning" />}
              {version.approval_status === 'approved' && <StatusBadge label={translate('Approved by manager')} tone="success" />}
              {version.approval_status === 'rejected' && <StatusBadge label={translate('Changes requested')} tone="danger" />}
            </div>
            <span className="text-[13px] text-shop-muted tabular-nums">
              {translate("Created")}{' '}{created}
              {version.snapshot?.valid_until ? translate(" · valid until {value0}", { value0: translate(String(version.snapshot.valid_until.slice(0, 10))) }) : ''}
            </span>
            {summary && <span className="text-[13px] tabular-nums">{summary}</span>}
            {version.notes && <span className="text-[13px] text-shop-muted">{translate("Note:")}{' '}{version.notes}</span>}
          </div>
        </div>
        <div className="text-end">
          <span className={CAP}>{translate("Selling price")}</span>
          <div className={`text-2xl font-extrabold tabular-nums ${revoked ? 'text-shop-muted line-through' : ''}`}>
            {money(version.selling_price, version.currency)}
          </div>
          {margin != null && !revoked && (
            <span className="text-xs text-shop-muted tabular-nums">{translate("Margin")}{' '}{margin}{translate("% · internal")}</span>
          )}
        </div>
      </div>

      {version.accepted_at && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-shop-green-bg px-3 py-2 text-[13px] text-primary-800">
          <Check className="size-4" aria-hidden="true" />
          {translate("Accepted")}{' '}{new Date(version.accepted_at).toLocaleString()}
          {version.accepted_by ? translate(" by {value0}", { value0: translate(String(version.accepted_by)) }) : ''}
        </div>
      )}
      {version.approval_status === 'rejected' && version.review_note && (
        <p className="mx-4 mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
          <strong>{translate('Manager:')}</strong>{' '}<bdi>{version.review_note}</bdi>
        </p>
      )}
      {version.approval_status === 'pending' && isAdmin && !revoked && (
        <div className="mx-4 mb-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-[13px]">{translate('An employee locked this quote. Check the price and margin, then approve it or ask for changes.')}</p>
          {askingChanges ? (
            <>
              <textarea
                rows={2}
                dir="auto"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={translate('What needs changing?')}
                aria-label={translate('What needs changing?')}
                className="rounded-lg border border-line-strong bg-white px-2.5 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" loading={reviewing === 'rejected'} disabled={!reviewNote.trim()} onClick={() => void review('rejected')}>
                  {translate('Send back')}
                </Button>
                <Button size="sm" onClick={() => setAskingChanges(false)}>{translate('Cancel')}</Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Check />} loading={reviewing === 'approved'} onClick={() => void review('approved')}>
                {translate('Approve')}
              </Button>
              <Button size="sm" onClick={() => setAskingChanges(true)}>{translate('Ask for changes')}</Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mx-4 mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
          {translate(error)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-shop-border bg-slate-50 px-4 py-3">
        {!revoked && !awaitingApproval(version) && (
          <Button variant={selected ? 'secondary' : 'primary'} size="sm" aria-pressed={selected} onClick={onSelect}>
            {selected ? translate("Sending v{value0}", { value0: translate(String(version.version_number)) }) : translate("Send v{value0}", { value0: translate(String(version.version_number)) })}
          </Button>
        )}
        <Button size="sm" icon={<Download />} loading={openingPdf} onClick={() => void openPdf()}>
          PDF
        </Button>
        {!revoked && version.status !== 'accepted' && (
          <OverflowMenu
            label={translate("More actions for v{value0}", { value0: translate(String(version.version_number)) })}
            items={[{ id: 'revoke', label: translate("Revoke share links"), tone: 'danger', onClick: () => void revoke() }]}
          />
        )}
      </div>
      {dialog}
    </article>
  )
}

// ── send + history ────────────────────────────────────────────────────────────

function SendPanel({
  version,
  leadPhone,
  leadEmail,
}: {
  version: QuoteVersion
  leadPhone?: string | null
  leadEmail?: string | null
}) {
  useI18n()
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [deliveries, setDeliveries] = useState<QuoteDelivery[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const defaultRecipient = useMemo(() => {
    if (channel === 'email') return leadEmail || ''
    const phone = String(leadPhone || '').trim()
    if (phone.startsWith('+') || phone.length > 10) return phone.startsWith('+') ? phone : `+${phone}`
    return ''
  }, [channel, leadPhone, leadEmail])

  const [recipient, setRecipient] = useState(defaultRecipient)
  const [prevDefault, setPrevDefault] = useState(defaultRecipient)
  if (defaultRecipient !== prevDefault) {
    setPrevDefault(defaultRecipient)
    setRecipient(defaultRecipient)
  }

  const loadDeliveries = async () => {
    try {
      setDeliveries(await fetchDeliveries(version.id))
      setNow(new Date())
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchDeliveries(version.id)
      .then((list) => {
        if (cancelled) return
        setDeliveries(list)
        setNow(new Date())
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [version.id])

  const send = async () => {
    setSendError(null)
    setSending(true)
    try {
      const result = await sendVersion(version.id, { channel, recipient })
      setShareLink(result.share_link)
      await loadDeliveries()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const retry = async (deliveryId: string) => {
    setRetrying(deliveryId)
    try {
      await retryDelivery(deliveryId)
      await loadDeliveries()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  const copyLink = async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setSendError('Could not copy — select the link and copy it manually.')
    }
  }

  const timeline = deliveryTimeline(version, deliveries, now)
  const emailMissing = channel === 'email' && !recipient

  return (
    <>
      <section aria-labelledby="snd-h" className="flex flex-col gap-3 rounded-[10px] border border-shop-border bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="snd-h" className="text-base font-bold">{translate("Send v")}{version.version_number}</h2>
          <SegmentedControl
            ariaLabel="Channel"
            value={channel}
            onChange={(id) => setChannel(id as Channel)}
            items={[
              { id: 'whatsapp', label: 'WhatsApp' },
              { id: 'email', label: translate("Email") },
            ]}
          />
        </div>

        <div className="grid gap-1">
          <label className={LABEL} htmlFor="send-to">{translate("To")}</label>
          <input
            id="send-to"
            type={channel === 'email' ? 'email' : 'tel'}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={channel === 'whatsapp' ? '+971501234567' : 'customer@email.com'}
            aria-invalid={emailMissing || undefined}
            aria-describedby={emailMissing ? 'send-to-hint' : undefined}
            className={`${FIELD} tabular-nums`}
          />
          {emailMissing && (
            <span id="send-to-hint" className="text-xs text-shop-muted">
              {translate("There is no email on this lead — type one to send by email.")}</span>
          )}
        </div>

        {shareLink && (
          <div className="grid gap-1">
            <span className={LABEL}>{translate("Share link")}</span>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute top-2.5 start-2.5 size-4 text-shop-muted" aria-hidden="true" />
                <input readOnly value={shareLink} aria-label={translate("Share link")} className={`${FIELD} ps-8 tabular-nums`} />
              </div>
              <Button onClick={() => void copyLink()}>{copied ? translate('Copied') : translate("Copy link")}</Button>
            </div>
          </div>
        )}

        {sendError && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
            {sendError}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            variant="secondary"
            icon={channel === 'email' ? <Mail /> : <Send />}
            loading={sending}
            disabled={!recipient}
            onClick={() => void send()}
            className="border-shop-accent text-shop-accent"
          >
            {channel === 'email' ? translate("Send email") : translate("Send on WhatsApp")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="his-h" className="flex flex-col rounded-[10px] border border-shop-border bg-white p-4">
        <h2 id="his-h" className="mb-1.5 text-base font-bold">{translate("Delivery history")}</h2>
        {loadingHistory ? (
          <p role="status" className="py-2 text-[13px] text-shop-muted">{translate("Loading history…")}</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {timeline.map((event) => (
              <li
                key={event.id}
                className={`flex gap-3 py-2.5 ${event.failed ? '-mx-2.5 rounded-lg bg-[#FEF2F2] px-2.5' : ''}`}
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full ${EVENT_DOT[event.tone]}`} aria-hidden="true">
                  {event.failed ? <span className="text-sm leading-none font-bold">×</span> : event.id.startsWith('created-') ? <Lock className="size-3.5" /> : <Check className="size-3.5" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <strong className="text-sm">{translate(event.title)}</strong>
                  <span className={`text-[13px] tabular-nums ${event.failed ? 'text-[#7F1D1D]' : 'text-shop-muted'}`}>{event.detail}</span>
                </div>
                {event.failed && (
                  <Button size="sm" loading={retrying === event.id} onClick={() => void retry(event.id)}>
                    {translate("Retry")}</Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

// ── main panel ────────────────────────────────────────────────────────────────

export default function QuoteSendPanel({ leadId, leadPhone, leadEmail, draft }: Props) {
  useI18n()
  const [versions, setVersions] = useState<QuoteVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [locking, setLocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockNotes, setLockNotes] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [loadedLeadId, setLoadedLeadId] = useState(leadId)
  if (leadId !== loadedLeadId) {
    setLoadedLeadId(leadId)
    setLoading(true)
    setPickedId(null)
  }

  const load = async () => {
    setLoading(true)
    try {
      setVersions(await fetchVersions(leadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchVersions(leadId)
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load versions')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const handleLock = async () => {
    setLocking(true)
    setError(null)
    try {
      const created = await lockVersion(leadId, lockNotes || undefined)
      setLockNotes('')
      setPickedId(created.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock version')
    } finally {
      setLocking(false)
    }
  }

  const handleRevoked = (versionId: string) => {
    setVersions((prev) => prev.map((v) => (v.id === versionId ? { ...v, status: 'revoked' as const } : v)))
  }

  const hasPricing = draft && (draft.items?.length ?? 0) > 0
  const sellingPrice = draft?.pricing?.selling_price
  const current = currentVersion(versions)
  const ordered = [...versions].sort((a, b) => b.version_number - a.version_number)
  const picked = versions.find((v) => v.id === pickedId && v.status !== 'revoked') ?? current

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section aria-labelledby="ver-h" className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ver-h" className="text-base font-bold">{translate("Versions")}</h2>
          <span className="text-[13px] text-shop-muted">
            {translate("Versions are locked once created. Edit the draft in Build to make v")}{versions.length + 1}.
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-[10px] border border-shop-border bg-white p-4">
          <h3 className="text-sm font-bold">{translate("Lock a new version")}</h3>
          {!hasPricing ? (
            <p className="text-[13px] text-shop-muted">
              {translate("Select items in Build first, then come here to lock and send.")}</p>
          ) : (
            <>
              <input
                type="text"
                aria-label={translate("Note for this version")}
                placeholder={translate("Optional note for this version…")}
                value={lockNotes}
                onChange={(e) => setLockNotes(e.target.value)}
                className={FIELD}
              />
              {error && (
                <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
                  {translate(error)}
                </p>
              )}
              <Button variant="primary" block loading={locking} onClick={() => void handleLock()}>
                {translate("Lock v")}{versions.length + 1} — {money(sellingPrice ?? null, draft?.currency)}
              </Button>
              <p className="text-xs text-shop-muted">
                {translate("Locking creates an immutable snapshot. Items and prices cannot be changed after locking.")}</p>
            </>
          )}
        </div>

        {loading ? (
          <p role="status" className="py-6 text-center text-sm text-shop-muted">{translate("Loading versions…")}</p>
        ) : ordered.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-line-strong bg-white py-8 text-center text-sm text-shop-muted">
            {translate("No versions yet. Lock one above to start sending.")}</p>
        ) : (
          ordered.map((v) => (
            <VersionCard
              key={v.id}
              version={v}
              current={current?.id === v.id}
              selected={picked?.id === v.id}
              onSelect={() => setPickedId(v.id)}
              onRevoked={handleRevoked}
              onReviewed={(next) => setVersions((prev) => prev.map((x) => (x.id === next.id ? { ...x, ...next, snapshot: x.snapshot } : x)))}
            />
          ))
        )}

        {current && (
          <section aria-labelledby="acc-h" className="flex flex-col gap-2.5 rounded-[10px] border border-shop-border bg-white p-4">
            <h3 id="acc-h" className="text-[15px] font-bold">{translate("Customer acceptance")}</h3>
            {current.accepted_at ? (
              <div className="flex items-center gap-3 rounded-lg bg-shop-green-bg p-3 text-primary-800">
                <Check className="size-5" aria-hidden="true" />
                <div className="flex flex-col">
                  <strong>{translate("Accepted v")}{current.version_number}</strong>
                  <span className="text-[13px] tabular-nums">
                    {new Date(current.accepted_at).toLocaleString()}
                    {current.accepted_by ? ` · ${current.accepted_by}` : ''}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-strong p-3">
                <div className="flex flex-col">
                  <strong>{translate("Awaiting response")}</strong>
                  <span className="text-[13px] text-shop-muted">
                    {translate("When the customer accepts, their name and the time appear here and the lead moves to Accepted.")}</span>
                </div>
              </div>
            )}
          </section>
        )}
      </section>

      {picked && (
        <aside className="flex flex-[1_1_380px] flex-col gap-3.5 lg:max-w-[460px]">
          {awaitingApproval(picked) ? (
            <p role="status" className="rounded-[10px] border border-amber-300 bg-amber-50 p-4 text-sm">
              {picked.approval_status === 'pending'
                ? translate('v{value0} is waiting for a manager to approve it. You can send it once it is approved.', { value0: picked.version_number })
                : translate('A manager asked for changes to v{value0}. Fix the quote and lock a new version.', { value0: picked.version_number })}
            </p>
          ) : (
            <SendPanel key={picked.id} version={picked} leadPhone={leadPhone} leadEmail={leadEmail} />
          )}
        </aside>
      )}
    </div>
  )
}
