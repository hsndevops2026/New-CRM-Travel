import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleAlert, FileText, Pencil, Plane, Bed, Trash2 } from 'lucide-react'
import {
  approvePredefinedQuoteImport,
  fetchPredefinedQuoteImports,
  formatQuoteMoney,
  isBrochureFile,
  rejectPredefinedQuoteImport,
  uploadPredefinedQuoteBrochure,
  type PredefinedQuote,
  type PredefinedQuoteImport,
} from '../lib/predefinedQuotes'
import {
  approvalProblems,
  carouselOrder,
  indexAfterRemoval,
  offerRows,
  pageLabel,
  summaryCounts,
} from '../lib/importCarousel'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import ModalDrawer from './ui/ModalDrawer'
import StatusBadge from './ui/StatusBadge'
import { TableSkeleton } from './ui/Skeleton'
import { useConfirm } from '../hooks/useConfirm'

type Props = {
  open: boolean
  quotes: PredefinedQuote[]
  onClose: () => void
  /** Open the full editor for one package (the carousel approves as extracted; this fixes fields first). */
  onReview: (importRecord: PredefinedQuoteImport, targetQuoteId: string | null) => void
  /** A package was approved straight from the carousel, so the library can show it. */
  onApproved?: (quote: PredefinedQuote) => void
}

export default function ImportPredefinedQuoteModal({ open, quotes, onClose, onReview, onApproved }: Props) {
  const { confirm, dialog } = useConfirm()
  const [imports, setImports] = useState<PredefinedQuoteImport[]>([])
  // Which slide is showing. The id says WHICH package; the index remembers WHERE it was, so if
  // that package disappears (approved elsewhere, rejected) we land on its neighbour — never on
  // one that is no longer waiting for review ("Only imports waiting for review can be approved").
  const [cursor, setCursor] = useState<{ id: string | null; index: number }>({ id: null, index: 0 })
  // "Update an existing package" belongs to ONE import, so it can never leak to the next slide.
  const [targetChoice, setTargetChoice] = useState<{ importId: string; quoteId: string } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  // Whatever is on screen is stale from the moment the dialog reopens until the fresh list
  // arrives, so mark it loading right away.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setLoading(true)
  }
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | 'all' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const slides = useMemo(() => carouselOrder(imports), [imports])
  const position = (() => {
    const at = slides.findIndex((s) => s.id === cursor.id)
    return at >= 0 ? at : Math.min(cursor.index, Math.max(0, slides.length - 1))
  })()
  const current = slides[position] ?? null
  const targetQuoteId =
    current && targetChoice?.importId === current.id ? targetChoice.quoteId : current?.target_quote_id || ''

  const show = (next: number) => {
    if (!slides.length) return
    const at = (next + slides.length) % slides.length
    setCursor({ id: slides[at].id, index: at })
  }

  /** Applies a freshly loaded list and keeps the slide on the same package, or its neighbour. */
  const applyList = (list: PredefinedQuoteImport[]) => {
    setImports(list)
    setCursor((c) => {
      const order = carouselOrder(list)
      if (!order.length) return { id: null, index: 0 }
      const at = order.findIndex((s) => s.id === c.id)
      if (at >= 0) return { id: c.id, index: at }
      const index = indexAfterRemoval(c.index, order.length)
      return { id: order[index].id, index }
    })
  }

  const load = async () => {
    setLoading(true)
    try {
      applyList(await fetchPredefinedQuoteImports('needs_review'))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending imports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchPredefinedQuoteImports('needs_review')
      .then((next) => {
        if (cancelled) return
        applyList(next)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pending imports')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) return setError('Choose a PDF or image brochure')
    if (!isBrochureFile(file)) return setError('Choose a PDF, PNG, JPEG, WebP, or GIF file')
    if (file.size > 50 * 1024 * 1024) return setError('File must be smaller than 50 MB')
    setUploading(true)
    setError(null)
    setNotice(null)
    try {
      let result = await uploadPredefinedQuoteBrochure(file)
      if (result.duplicate) {
        // Say what exists, and let the person decide whether it is worth reading again.
        const waiting = result.importRecords.filter((r) => r.status === 'needs_review').length
        const approved = result.importRecords.filter((r) => r.status === 'approved').length
        const total = result.importRecords.length
        const parts = [waiting ? `${waiting} waiting for review` : null, approved ? `${approved} already approved` : null].filter(Boolean)
        const again = await confirm({
          title: 'This file was already imported',
          description: `“${file.name}” was read before and gave ${total} package${total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}. Read it again? Reading uses AI again${waiting ? `, and the ${waiting} package${waiting === 1 ? '' : 's'} waiting for review ${waiting === 1 ? 'is' : 'are'} replaced by the new result` : ''}. Approved packages stay in your library.`,
          confirmLabel: 'Read it again',
          cancelLabel: 'Keep what I have',
          tone: 'primary',
        })
        if (!again) {
          const first = result.importRecords.find((r) => r.status === 'needs_review')
          if (first) setCursor({ id: first.id, index: 0 })
          setNotice(
            waiting
              ? `Kept the ${total} package${total === 1 ? '' : 's'} from the earlier read — ${waiting} still waiting for review.`
              : 'Kept the earlier read. Everything from this file has already been reviewed.',
          )
          setFile(null)
          await load()
          return
        }
        result = await uploadPredefinedQuoteBrochure(file, { reextract: true })
      }
      const count = result.importRecords.length
      setNotice(
        result.replaced
          ? `Read again: ${count} package${count === 1 ? '' : 's'} found, replacing the ${result.replaced} that were waiting. Check each one and approve.`
          : count > 1
            ? `Found ${count} packages in this brochure — one per hotel. Check each one and approve.`
            : 'Extraction finished. Check the details, then approve.',
      )
      setFile(null)
      const first = result.importRecords.find((record) => record.status === 'needs_review')
      if (first) setCursor({ id: first.id, index: 0 })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import brochure')
    } finally {
      setUploading(false)
    }
  }

  const removeSlide = (id: string) => {
    const remaining = imports.filter((r) => r.id !== id)
    const order = carouselOrder(remaining)
    setImports(remaining)
    if (!order.length) return setCursor({ id: null, index: 0 })
    const index = indexAfterRemoval(position, order.length)
    setCursor({ id: order[index].id, index })
  }

  const approveOne = async (record: PredefinedQuoteImport, target: string | null) => {
    const result = await approvePredefinedQuoteImport(record.id, record.extracted_payload!, target)
    onApproved?.(result.quote)
    return result.quote
  }

  const approve = async () => {
    if (!current?.extracted_payload) return
    setBusyId(current.id)
    setError(null)
    setNotice(null)
    try {
      const quote = await approveOne(current, targetQuoteId || null)
      removeSlide(current.id)
      setNotice(`Approved “${quote.title}”. It is now in your quotes library.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve this package')
    } finally {
      setBusyId(null)
    }
  }

  const approvable = slides.filter((s) => approvalProblems(s.extracted_payload).length === 0)

  const approveAll = async () => {
    const ok = await confirm({
      title: `Approve ${approvable.length} package${approvable.length === 1 ? '' : 's'}?`,
      description:
        'Each is added to your quotes library exactly as extracted. Packages with missing details are skipped, and you can still edit any of them afterwards.',
      confirmLabel: `Approve ${approvable.length}`,
      tone: 'primary',
    })
    if (!ok) return
    setBusyId('approve-all')
    setError(null)
    setNotice(null)
    let done = 0
    const failed: string[] = []
    let rest = imports
    for (const record of approvable) {
      try {
        const choice = targetChoice?.importId === record.id ? targetChoice.quoteId : record.target_quote_id || ''
        await approveOne(record, choice || null)
        rest = rest.filter((r) => r.id !== record.id)
        done += 1
      } catch (err) {
        failed.push(`${record.extracted_payload?.title || record.file_name}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    applyList(rest)
    setNotice(`Approved ${done} package${done === 1 ? '' : 's'}.`)
    if (failed.length) setError(`${failed.length} could not be approved — ${failed.join('; ')}`)
    setBusyId(null)
  }

  const reject = async (record: PredefinedQuoteImport) => {
    const ok = await confirm({
      title: `Reject “${record.extracted_payload?.title || record.file_name}”?`,
      description: 'This package is discarded. The rest of the brochure is not affected, and you can upload the file again later.',
      confirmLabel: 'Reject package',
    })
    if (!ok) return
    setBusyId(record.id)
    try {
      await rejectPredefinedQuoteImport(record.id)
      removeSlide(record.id)
      setNotice('Package rejected.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject import')
    } finally {
      setBusyId(null)
    }
  }

  const rejectAll = async () => {
    const pending = [...slides]
    if (pending.length < 2) return
    const label = `${pending.length} package${pending.length === 1 ? '' : 's'}`
    const ok = await confirm({
      title: `Reject all ${label}?`,
      description: 'Every package currently waiting in this review modal is discarded. Approved quotes are not affected, and you can upload the brochures again later.',
      confirmLabel: `Reject all ${pending.length}`,
    })
    if (!ok) return

    setBusyId('reject-all')
    setError(null)
    setNotice(null)
    let rest = imports
    let done = 0
    const failed: string[] = []
    for (const record of pending) {
      try {
        await rejectPredefinedQuoteImport(record.id)
        rest = rest.filter((item) => item.id !== record.id)
        done += 1
      } catch (err) {
        failed.push(`${record.extracted_payload?.title || record.file_name}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    applyList(rest)
    setNotice(`Rejected ${done} package${done === 1 ? '' : 's'}.`)
    if (failed.length) setError(`${failed.length} could not be rejected — ${failed.join('; ')}`)
    setBusyId(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      show(position + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      show(position - 1)
    }
  }

  const payload = current?.extracted_payload ?? null
  const problems = approvalProblems(payload)
  const rows = offerRows(payload)
  const counts = summaryCounts(payload)
  const busy = busyId !== null
  const total = payload?.total_price ?? null

  return (
    <>
      <ModalDrawer
        open={open}
        title="Import brochure"
        subtitle="Upload a PDF or photo of a rate sheet. Each hotel becomes a package for you to check and approve."
        onClose={onClose}
        maxWidthClassName="max-w-4xl"
        footer={
          current ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-600 sm:max-w-xs">
                When approved
                <select
                  className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm font-normal max-sm:h-11"
                  value={targetQuoteId}
                  disabled={busy}
                  onChange={(event) => setTargetChoice({ importId: current.id, quoteId: event.target.value })}
                >
                  <option value="">Create a new package</option>
                  {quotes.map((quote) => (
                    <option key={quote.id} value={quote.id}>
                      Update: {quote.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => void reject(current)}>
                  Reject
                </Button>
                <Button icon={<Pencil />} disabled={busy || loading || !payload} onClick={() => onReview(current, targetQuoteId || null)}>
                  Edit details
                </Button>
                <Button
                  variant="primary"
                  icon={<Check />}
                  loading={busyId === current.id}
                  disabled={busy || loading || problems.length > 0}
                  onClick={() => void approve()}
                >
                  Approve
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <form onSubmit={upload} className="flex flex-wrap items-end gap-3 rounded-[10px] border border-shop-border bg-shop-bg p-3.5">
          <label className="grid min-w-[220px] flex-1 gap-1.5 text-xs font-semibold text-slate-600">
            Brochure (PDF or image, up to 50 MB)
            <input
              type="file"
              accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
              className="block w-full rounded-lg border border-line-strong bg-white p-1.5 text-sm font-normal"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <Button type="submit" variant="primary" loading={uploading}>
            {uploading ? 'Reading brochure…' : 'Upload and extract'}
          </Button>
        </form>

        {notice && (
          <div role="status" className="mt-3 rounded-lg bg-shop-green-bg px-3 py-2 text-sm text-primary-800">
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {error}
          </div>
        )}

        {loading && !current && <TableSkeleton rows={3} label="Loading imports" />}

        {!loading && !current && (
          <EmptyState
            icon={<FileText />}
            tone="neutral"
            title="No brochures are waiting for review"
            description="Upload a brochure above. Every hotel it contains shows up here as a page you can check and approve."
          />
        )}

        {current && (
          <section
            role="group"
            aria-roledescription="carousel"
            aria-label="Packages waiting for review"
            onKeyDown={onKeyDown}
            className="mt-4 flex flex-col gap-3"
          >
            {/* Position, with a chip per package labelled by the page it came from. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                iconOnly
                aria-label="Previous package"
                icon={<ChevronLeft />}
                disabled={slides.length < 2 || busy}
                onClick={() => show(position - 1)}
              />
              <strong className="text-sm tabular-nums">
                {position + 1} of {slides.length}
              </strong>
              <Button
                size="sm"
                iconOnly
                aria-label="Next package"
                icon={<ChevronRight />}
                disabled={slides.length < 2 || busy}
                onClick={() => show(position + 1)}
              />
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => void load()}>
                  Refresh
                </Button>
                {slides.length > 1 && (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 />}
                    loading={busyId === 'reject-all'}
                    disabled={busy}
                    onClick={() => void rejectAll()}
                  >
                    Reject all {slides.length}
                  </Button>
                )}
                {approvable.length > 1 && (
                  <Button size="sm" loading={busyId === 'approve-all'} disabled={busy} onClick={() => void approveAll()}>
                    Approve all {approvable.length}
                  </Button>
                )}
              </div>
            </div>

            <ol aria-label="Packages" className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1">
              {slides.map((slide, i) => {
                const label = pageLabel(slide.source_pages)
                const on = i === position
                const flagged = approvalProblems(slide.extracted_payload).length > 0
                return (
                  <li key={slide.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      aria-label={`Package ${i + 1}${label ? `, ${label.toLowerCase()}` : ''}${flagged ? ', needs attention' : ''}`}
                      disabled={busy}
                      onClick={() => show(i)}
                      className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold tabular-nums max-sm:h-10 ${
                        on ? 'border-shop-ink bg-shop-ink text-white' : 'border-shop-border bg-white text-neutral-fg hover:bg-neutral-bg'
                      }`}
                    >
                      {slide.source_pages ? `p.${slide.source_pages}` : i + 1}
                      {flagged && <span aria-hidden="true" className="size-1.5 rounded-full bg-warn-fg" />}
                    </button>
                  </li>
                )
              })}
            </ol>

            {/* The slide. */}
            <article
              aria-roledescription="slide"
              aria-label={`Package ${position + 1} of ${slides.length}`}
              className="flex flex-col gap-4 rounded-[10px] border border-shop-border bg-white p-4"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pageLabel(current.source_pages) && <StatusBadge label={pageLabel(current.source_pages)!} tone="info" />}
                    <span className="truncate text-xs text-shop-muted">
                      {current.file_name}
                      {(current.batch_total ?? 0) > 1 ? ` · package ${(current.batch_index ?? 0) + 1} of ${current.batch_total} in this file` : ''}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold">{payload?.title || 'Untitled package'}</h3>
                  <p className="text-sm text-shop-muted tabular-nums">
                    {[
                      payload?.destination,
                      payload?.travel_date && payload?.return_date ? `${payload.travel_date} → ${payload.return_date}` : payload?.travel_date,
                      payload?.nights ? `${payload.nights} nights` : null,
                      counts.hotels ? `${counts.hotels} hotel${counts.hotels === 1 ? '' : 's'}` : null,
                      `${counts.offers} offer${counts.offers === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Nothing extracted'}
                  </p>
                </div>
                {total != null && (
                  <div className="text-right">
                    <span className="block text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">Total</span>
                    <strong className="text-xl font-extrabold tabular-nums">
                      {formatQuoteMoney(total, payload?.currency || 'USD')}
                    </strong>
                  </div>
                )}
              </header>

              {rows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-shop-border">
                  <table className="relative w-full min-w-[560px] text-left text-sm">
                    <caption className="sr-only">Offers extracted from this package</caption>
                    <thead>
                      <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                        <th className="px-3 py-2">Offer</th>
                        <th className="px-3 py-2">Room · board</th>
                        <th className="px-3 py-2">Dates</th>
                        <th className="px-3 py-2 text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-b border-neutral-bg last:border-0">
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2 font-semibold">
                              {row.kind === 'flight' ? (
                                <Plane className="size-4 shrink-0 text-shop-muted" aria-label="Flight" />
                              ) : (
                                <Bed className="size-4 shrink-0 text-shop-muted" aria-label="Hotel" />
                              )}
                              {row.title}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{row.detail || <span className="text-shop-muted">—</span>}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums">
                            {row.when || <span className="text-shop-muted">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-bold whitespace-nowrap tabular-nums">
                            {row.price != null ? formatQuoteMoney(row.price, row.currency) : <span className="font-normal text-shop-muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-shop-muted">
                  No offers were found on this page.
                </p>
              )}

              {current.warnings.length > 0 && (
                <ul className="m-0 flex list-disc flex-col gap-1 rounded-lg bg-warn-bg py-2.5 pr-3 pl-7 text-[13px] text-warn-fg">
                  {current.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {problems.length > 0 && (
                <div role="alert" className="flex gap-2 rounded-lg bg-danger-bg px-3 py-2.5 text-[13px] text-danger-fg">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Can’t approve yet: {problems.join('; ')}. Use <strong>Edit details</strong> to fix it.
                  </span>
                </div>
              )}

            </article>
          </section>
        )}
      </ModalDrawer>
      {dialog}
    </>
  )
}
