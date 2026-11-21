import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plane,
  Bed,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  approvePredefinedQuoteImport,
  fetchPredefinedQuoteImports,
  formatQuoteMoney,
  BROCHURE_ACCEPT,
  displayTotal,
  isBrochureFile,
  rejectPredefinedQuoteImport,
  uploadPredefinedQuoteBrochure,
  type PredefinedQuote,
  type PredefinedQuoteImport,
} from '../lib/predefinedQuotes'
import { formatFileSize } from '../lib/bookingDocuments'
import {
  approvalProblems,
  carouselOrder,
  indexAfterRemoval,
  offerRows,
  pageLabel,
  summaryCounts,
} from '../lib/importCarousel'
import Banner from './ui/Banner'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import ModalDrawer from './ui/ModalDrawer'
import StatusBadge from './ui/StatusBadge'
import { TableSkeleton } from './ui/Skeleton'
import { useConfirm } from '../hooks/useConfirm'

type FileJobStatus = 'queued' | 'reading' | 'done' | 'kept' | 'failed'
type FileJob = {
  key: string
  name: string
  size: number
  status: FileJobStatus
  detail?: string
}

const MAX_BROCHURE_BYTES = 50 * 1024 * 1024

function fileIcon(name: string) {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <ImageIcon className="size-3.5 shrink-0 text-shop-muted" aria-hidden="true" />
  return <FileText className="size-3.5 shrink-0 text-shop-muted" aria-hidden="true" />
}

function jobTone(status: FileJobStatus): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'reading') return 'info'
  if (status === 'done') return 'success'
  if (status === 'kept') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function jobLabel(status: FileJobStatus) {
  if (status === 'queued') return 'Queued'
  if (status === 'reading') return 'Reading'
  if (status === 'done') return 'Done'
  if (status === 'kept') return 'Kept'
  return 'Failed'
}

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
  useI18n()
  const { confirm, dialog } = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imports, setImports] = useState<PredefinedQuoteImport[]>([])
  // Which slide is showing. The id says WHICH package; the index remembers WHERE it was, so if
  // that package disappears (approved elsewhere, rejected) we land on its neighbour — never on
  // one that is no longer waiting for review ("Only imports waiting for review can be approved").
  const [cursor, setCursor] = useState<{ id: string | null; index: number }>({ id: null, index: 0 })
  // "Update an existing package" belongs to ONE import, so it can never leak to the next slide.
  const [targetChoice, setTargetChoice] = useState<{ importId: string; quoteId: string } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [fileJobs, setFileJobs] = useState<FileJob[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | 'all' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Whatever is on screen is stale from the moment the dialog reopens until the fresh list
  // arrives, so mark it loading right away.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLoading(true)
      setFiles([])
      setFileJobs(null)
      setDragging(false)
      setNotice(null)
      setError(null)
    }
  }
  const uploading = fileJobs !== null

  const patchJob = (key: string, patch: Partial<FileJob>) => {
    setFileJobs((prev) => prev?.map((job) => (job.key === key ? { ...job, ...patch } : job)) ?? null)
  }

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return
    const rejected: string[] = []
    const accepted: File[] = []
    for (const file of incoming) {
      if (!isBrochureFile(file)) {
        rejected.push(translate('“{value0}” is not a supported file type', { value0: file.name }))
        continue
      }
      if (file.size > MAX_BROCHURE_BYTES) {
        rejected.push(translate('“{value0}” is larger than 50 MB', { value0: file.name }))
        continue
      }
      accepted.push(file)
    }
    if (accepted.length) {
      setFiles((prev) => {
        const map = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]))
        for (const file of accepted) map.set(`${file.name}:${file.size}`, file)
        return [...map.values()]
      })
      setError(null)
    }
    if (rejected.length) setError(rejected.join('; '))
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, at) => at !== index))
  }

  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!uploading) setDragging(true)
  }

  const onDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget === event.target) setDragging(false)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    if (uploading) return
    addFiles(Array.from(event.dataTransfer.files || []))
  }

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

  /** Ask whether to re-read a file the server already knows. */
  const resolveDuplicate = async (
    file: File,
    result: Awaited<ReturnType<typeof uploadPredefinedQuoteBrochure>>,
  ) => {
    const waiting = result.importRecords.filter((r) => r.status === 'needs_review').length
    const approved = result.importRecords.filter((r) => r.status === 'approved').length
    const total = result.importRecords.length
    const parts = [
      waiting ? translate('{value0} waiting for review', { value0: translate(String(waiting)) }) : null,
      approved ? translate('{value0} already approved', { value0: translate(String(approved)) }) : null,
    ].filter(Boolean)
    const again = await confirm({
      title: 'This file was already imported',
      description: translate(
        '“{value0}” was read before and gave {value1} package{value2}{value3}. Read it again? Reading uses AI again{value4}. Approved packages stay in your library.',
        {
          value0: translate(String(file.name)),
          value1: translate(String(total)),
          value2: translate(String(total === 1 ? '' : 's')),
          value3: translate(String(parts.length ? ` (${parts.join(', ')})` : '')),
          value4: translate(
            String(
              waiting
                ? `, and the ${waiting} package${waiting === 1 ? '' : 's'} waiting for review ${waiting === 1 ? 'is' : 'are'} replaced by the new result`
                : '',
            ),
          ),
        },
      ),
      confirmLabel: 'Read it again',
      cancelLabel: 'Keep what I have',
      tone: 'primary',
    })
    if (!again) {
      return {
        kind: 'kept' as const,
        fileName: file.name,
        waiting,
        total,
        firstWaiting: result.importRecords.find((r) => r.status === 'needs_review') || null,
      }
    }
    return {
      kind: 'reextracted' as const,
      result: await uploadPredefinedQuoteBrochure(file, { reextract: true }),
    }
  }

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!files.length) return setError(translate('Choose a brochure, rate sheet or email file'))

    const selected = [...files]
    const multi = selected.length > 1
    const jobs: FileJob[] = selected.map((file, index) => ({
      key: `${file.name}:${file.size}:${index}`,
      name: file.name,
      size: file.size,
      status: 'queued',
    }))
    setFileJobs(jobs)
    setError(null)
    setNotice(null)

    let packagesFound = 0
    let filesOk = 0
    let replacedTotal = 0
    let firstWaitingId: string | null = null
    const failed: string[] = []
    const kept: { fileName: string; waiting: number; total: number }[] = []

    try {
      for (let i = 0; i < selected.length; i += 1) {
        const file = selected[i]
        const key = jobs[i].key
        patchJob(key, { status: 'reading', detail: translate('Extracting packages…') })
        try {
          let result = await uploadPredefinedQuoteBrochure(file)
          if (result.duplicate) {
            const resolved = await resolveDuplicate(file, result)
            if (resolved.kind === 'kept') {
              kept.push({ fileName: resolved.fileName, waiting: resolved.waiting, total: resolved.total })
              if (resolved.firstWaiting && !firstWaitingId) firstWaitingId = resolved.firstWaiting.id
              patchJob(key, {
                status: 'kept',
                detail: resolved.waiting
                  ? translate('{value0} waiting', { value0: translate(String(resolved.waiting)) })
                  : translate('Already reviewed'),
              })
              continue
            }
            result = resolved.result
          }

          packagesFound += result.importRecords.length
          replacedTotal += result.replaced
          filesOk += 1
          const first = result.importRecords.find((record) => record.status === 'needs_review')
          if (first && !firstWaitingId) firstWaitingId = first.id
          patchJob(key, {
            status: 'done',
            detail: translate('{value0} package{value1}', {
              value0: translate(String(result.importRecords.length)),
              value1: translate(String(result.importRecords.length === 1 ? '' : 's')),
            }),
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'failed'
          failed.push(`${file.name}: ${message}`)
          patchJob(key, { status: 'failed', detail: message })
        }
      }

      if (firstWaitingId) setCursor({ id: firstWaitingId, index: 0 })
      await load()

      const summaryParts: string[] = []
      if (filesOk > 0) {
        if (!multi && kept.length === 0 && failed.length === 0) {
          summaryParts.push(
            replacedTotal
              ? translate(
                  'Read again: {value0} package{value1} found, replacing the {value2} that were waiting. Check each one and approve.',
                  {
                    value0: translate(String(packagesFound)),
                    value1: translate(String(packagesFound === 1 ? '' : 's')),
                    value2: translate(String(replacedTotal)),
                  },
                )
              : packagesFound > 1
                ? translate(
                    'Found {value0} packages in this brochure — one per hotel. Check each one and approve.',
                    { value0: translate(String(packagesFound)) },
                  )
                : 'Extraction finished. Check the details, then approve.',
          )
        } else {
          summaryParts.push(
            translate(
              'Read {value0} file{value1}: {value2} package{value3} ready to review.',
              {
                value0: translate(String(filesOk)),
                value1: translate(String(filesOk === 1 ? '' : 's')),
                value2: translate(String(packagesFound)),
                value3: translate(String(packagesFound === 1 ? '' : 's')),
              },
            ),
          )
          if (replacedTotal > 0) {
            summaryParts.push(
              translate('Replaced {value0} that were waiting.', {
                value0: translate(String(replacedTotal)),
              }),
            )
          }
        }
      }

      if (kept.length === 1 && !multi && filesOk === 0 && failed.length === 0) {
        const only = kept[0]
        summaryParts.push(
          only.waiting
            ? translate(
                'Kept the {value0} package{value1} from the earlier read — {value2} still waiting for review.',
                {
                  value0: translate(String(only.total)),
                  value1: translate(String(only.total === 1 ? '' : 's')),
                  value2: translate(String(only.waiting)),
                },
              )
            : 'Kept the earlier read. Everything from this file has already been reviewed.',
        )
      } else if (kept.length) {
        for (const item of kept) {
          summaryParts.push(
            item.waiting
              ? translate(
                  '“{value0}”: kept {value1} package{value2} from earlier — {value3} still waiting.',
                  {
                    value0: item.fileName,
                    value1: translate(String(item.total)),
                    value2: translate(String(item.total === 1 ? '' : 's')),
                    value3: translate(String(item.waiting)),
                  },
                )
              : translate('“{value0}”: already reviewed — kept as is.', { value0: item.fileName }),
          )
        }
      }

      if (summaryParts.length) setNotice(summaryParts.join(' '))
      if (failed.length) {
        setError(
          !multi && failed.length === 1 && filesOk === 0 && kept.length === 0
            ? failed[0].replace(/^[^:]+:\s*/, '')
            : translate('{value0} could not be imported — {value1}', {
                value0: translate(String(failed.length)),
                value1: translate(String(failed.join('; '))),
              }),
        )
      }
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setFileJobs(null)
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
      setNotice(translate("Approved “{value0}”. It is now in your quotes library.", { value0: translate(String(quote.title)) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve this package')
    } finally {
      setBusyId(null)
    }
  }

  const approvable = slides.filter((s) => approvalProblems(s.extracted_payload).length === 0)

  const approveAll = async () => {
    const ok = await confirm({
      title: translate("Approve {value0} package{value1}?", { value0: translate(String(approvable.length)), value1: translate(String(approvable.length === 1 ? '' : 's')) }),
      description:
        'Each is added to your quotes library exactly as extracted. Packages with missing details are skipped, and you can still edit any of them afterwards.',
      confirmLabel: translate("Approve {value0}", { value0: translate(String(approvable.length)) }),
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
    setNotice(translate("Approved {value0} package{value1}.", { value0: translate(String(done)), value1: translate(String(done === 1 ? '' : 's')) }))
    if (failed.length) setError(translate("{value0} could not be approved — {value1}", { value0: translate(String(failed.length)), value1: translate(String(failed.join('; '))) }))
    setBusyId(null)
  }

  const reject = async (record: PredefinedQuoteImport) => {
    const ok = await confirm({
      title: translate("Reject “{value0}”?", { value0: translate(String(record.extracted_payload?.title || record.file_name)) }),
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
    const label = translate("{value0} package{value1}", { value0: translate(String(pending.length)), value1: translate(String(pending.length === 1 ? '' : 's')) })
    const ok = await confirm({
      title: translate("Reject all {value0}?", { value0: translate(String(label)) }),
      description: 'Every package currently waiting in this review modal is discarded. Approved quotes are not affected, and you can upload the brochures again later.',
      confirmLabel: translate("Reject all {value0}", { value0: translate(String(pending.length)) }),
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
    setNotice(translate("Rejected {value0} package{value1}.", { value0: translate(String(done)), value1: translate(String(done === 1 ? '' : 's')) }))
    if (failed.length) setError(translate("{value0} could not be rejected — {value1}", { value0: translate(String(failed.length)), value1: translate(String(failed.join('; '))) }))
    setBusyId(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return
    const forwardKey = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backKey = forwardKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'
    if (event.key === forwardKey) {
      event.preventDefault()
      show(position + 1)
    } else if (event.key === backKey) {
      event.preventDefault()
      show(position - 1)
    }
  }

  const payload = current?.extracted_payload ?? null
  // Approving into an existing package (a new month's prices): show which one, and how the price moves.
  const updates = targetQuoteId ? quotes.find((quote) => quote.id === targetQuoteId) || null : null
  const updatedPrice = (() => {
    if (!updates || !payload) return null
    const before = displayTotal(updates)
    const after = displayTotal(payload)
    if (before == null || after == null || before === after) return null
    return {
      before: formatQuoteMoney(before, updates.currency || 'USD'),
      after: formatQuoteMoney(after, payload.currency || 'USD'),
    }
  })()
  const problems = approvalProblems(payload)
  const rows = offerRows(payload)
  const counts = summaryCounts(payload)
  const busy = busyId !== null || uploading
  const total = payload?.total_price ?? null
  const jobsDone = fileJobs?.filter((j) => j.status !== 'queued' && j.status !== 'reading').length ?? 0
  const jobsTotal = fileJobs?.length ?? 0
  const jobsReading = fileJobs?.find((j) => j.status === 'reading')
  const progressPct = jobsTotal ? Math.round((jobsDone / jobsTotal) * 100) : 0

  return (
    <>
      <ModalDrawer
        open={open}
        title={translate('Import brochure')}
        subtitle="Upload one or more brochures, photos, Excel or CSV rate sheets. Each hotel becomes a package for you to check and approve. A new price list for a package you already have updates that package."
        onClose={uploading ? () => {} : onClose}
        maxWidthClassName="max-w-4xl"
        footer={
          current ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-slate-600 sm:max-w-xs">
                {translate("When approved")}<select
                  className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm font-normal max-sm:h-11"
                  value={targetQuoteId}
                  disabled={busy}
                  onChange={(event) => setTargetChoice({ importId: current.id, quoteId: event.target.value })}
                >
                  <option value="">{translate("Create a new predefined quote")}</option>
                  {quotes.map((quote) => (
                    <option key={quote.id} value={quote.id}>
                      {translate("Update:")}{' '}{quote.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => void reject(current)}>
                  {translate("Reject")}</Button>
                <Button icon={<Pencil />} disabled={busy || loading || !payload} onClick={() => onReview(current, targetQuoteId || null)}>
                  {translate("Edit details")}</Button>
                <Button
                  variant="primary"
                  icon={<Check />}
                  loading={busyId === current.id}
                  disabled={busy || loading || problems.length > 0}
                  onClick={() => void approve()}
                >
                  {translate("Approve")}</Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <form onSubmit={upload} className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={BROCHURE_ACCEPT}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              addFiles(Array.from(event.target.files || []))
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />

          {uploading && fileJobs ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[12px] border border-shop-border bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-tint text-shop-accent">
                    <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-sm text-shop-ink">
                      {translate('Reading brochures…')}
                    </strong>
                    <p className="mt-0.5 text-[13px] text-shop-muted">
                      {jobsReading
                        ? translate('Extracting “{value0}” ({value1} of {value2})', {
                            value0: jobsReading.name,
                            value1: translate(String(Math.min(jobsDone + 1, jobsTotal))),
                            value2: translate(String(jobsTotal)),
                          })
                        : translate('{value0} of {value1} finished', {
                            value0: translate(String(jobsDone)),
                            value1: translate(String(jobsTotal)),
                          })}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold tabular-nums text-shop-muted">
                  {progressPct}%
                </span>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-bg"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <div
                  className="h-full rounded-full bg-shop-accent transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <ul className="mt-3 m-0 flex list-none flex-col gap-1.5 p-0">
                {fileJobs.map((job) => (
                  <li
                    key={job.key}
                    className="flex items-center gap-2 rounded-lg border border-shop-border bg-shop-bg px-2.5 py-2"
                  >
                    {job.status === 'reading' ? (
                      <LoaderCircle className="size-3.5 shrink-0 text-shop-accent motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      fileIcon(job.name)
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-shop-ink">{job.name}</span>
                      <span className="block truncate text-[11px] text-shop-muted">
                        {[formatFileSize(job.size), job.detail].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <StatusBadge label={jobLabel(job.status)} tone={jobTone(job.status)} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`rounded-[12px] border-2 border-dashed p-4 transition-colors ${
                dragging
                  ? 'border-shop-accent bg-tint'
                  : 'border-shop-border bg-shop-bg hover:border-line-strong'
              }`}
            >
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:text-start">
                <span
                  className={`grid size-12 shrink-0 place-items-center rounded-[12px] [&_svg]:size-5 ${
                    dragging ? 'bg-shop-accent text-white' : 'bg-white text-shop-accent shadow-[0_1px_2px_rgb(16_24_40/0.06)]'
                  }`}
                  aria-hidden="true"
                >
                  <Upload />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm text-shop-ink">
                    {dragging
                      ? translate('Drop files to add them')
                      : translate('Drop brochures here, or browse')}
                  </strong>
                  <p className="mt-0.5 text-[13px] text-shop-muted">
                    {translate('PDF, image, Excel or CSV — up to 50 MB each. Select multiple files at once.')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {translate('Browse files')}
                </Button>
              </div>

              {files.length > 0 && (
                <div className="mt-3 border-t border-shop-border pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600">
                      {translate('{value0} file{value1} selected', {
                        value0: translate(String(files.length)),
                        value1: translate(String(files.length === 1 ? '' : 's')),
                      })}
                    </span>
                    <button
                      type="button"
                      className="text-xs font-semibold text-shop-muted hover:text-shop-ink"
                      onClick={() => setFiles([])}
                    >
                      {translate('Clear all')}
                    </button>
                  </div>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}:${file.size}:${index}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-shop-border bg-white py-1 ps-2.5 pe-1 text-xs font-medium"
                      >
                        {fileIcon(file.name)}
                        <span className="max-w-[160px] truncate">{file.name}</span>
                        <span className="text-shop-muted tabular-nums">{formatFileSize(file.size)}</span>
                        <button
                          type="button"
                          aria-label={translate('Remove {value0}', { value0: file.name })}
                          onClick={() => removeFile(index)}
                          className="grid size-6 place-items-center rounded-md text-neutral-fg hover:bg-neutral-bg"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex justify-end">
                    <Button type="submit" variant="primary" icon={<Upload />} disabled={!files.length}>
                      {translate('Upload and extract')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>

        {notice && (
          <div className="mt-3">
            <Banner tone="success" title={translate('Ready to review')}>
              {notice}
            </Banner>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Banner
              tone="danger"
              title={
                /could not be imported/i.test(error)
                  ? translate('Could not finish every file')
                  : translate('Upload problem')
              }
            >
              {error}
            </Banner>
          </div>
        )}

        {loading && !current && !uploading && <TableSkeleton rows={3} label={translate("Loading imports")} />}

        {!loading && !current && !uploading && (
          <EmptyState
            icon={<FileText />}
            tone="neutral"
            title={translate("No brochures are waiting for review")}
            description={translate('Upload brochures above. Every hotel they contain shows up here as a page you can check and approve.')}
          />
        )}

        {current && (
          <section
            role="group"
            aria-roledescription="carousel"
            aria-label={translate("Packages waiting for review")}
            onKeyDown={onKeyDown}
            className="mt-4 flex flex-col gap-3"
          >
            {/* Position, with a chip per package labelled by the page it came from. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                iconOnly
                aria-label={translate("Previous package")}
                icon={<ChevronLeft />}
                disabled={slides.length < 2 || busy}
                onClick={() => show(position - 1)}
              />
              <strong className="text-sm tabular-nums">
                {position + 1}{' '}{translate("of")}{' '}{slides.length}
              </strong>
              <Button
                size="sm"
                iconOnly
                aria-label={translate("Next package")}
                icon={<ChevronRight />}
                disabled={slides.length < 2 || busy}
                onClick={() => show(position + 1)}
              />
              <div className="ms-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => void load()}>
                  {translate("Refresh")}</Button>
                {slides.length > 1 && (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 />}
                    loading={busyId === 'reject-all'}
                    disabled={busy}
                    onClick={() => void rejectAll()}
                  >
                    {translate("Reject all")}{' '}{slides.length}
                  </Button>
                )}
                {approvable.length > 1 && (
                  <Button size="sm" loading={busyId === 'approve-all'} disabled={busy} onClick={() => void approveAll()}>
                    {translate("Approve all")}{' '}{approvable.length}
                  </Button>
                )}
              </div>
            </div>

            <ol aria-label={translate("Packages")} className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1">
              {slides.map((slide, i) => {
                const label = pageLabel(slide.source_pages)
                const on = i === position
                const flagged = approvalProblems(slide.extracted_payload).length > 0
                return (
                  <li key={slide.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      aria-label={translate("Package {value0}{value1}{value2}", { value0: translate(String(i + 1)), value1: translate(String(label ? `, ${label.toLowerCase()}` : '')), value2: translate(String(flagged ? ', needs attention' : '')) })}
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
              aria-label={translate("Package {value0} of {value1}", { value0: translate(String(position + 1)), value1: translate(String(slides.length)) })}
              className="flex flex-col gap-4 rounded-[10px] border border-shop-border bg-white p-4"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pageLabel(current.source_pages) && <StatusBadge label={pageLabel(current.source_pages)!} tone="info" />}
                    <span className="truncate text-xs text-shop-muted">
                      {current.file_name}
                      {(current.batch_total ?? 0) > 1 ? translate(" · package {value0} of {value1} in this file", { value0: translate(String((current.batch_index ?? 0) + 1)), value1: translate(String(current.batch_total)) }) : ''}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold">{payload?.title || 'Untitled package'}</h3>
                  <p className="text-sm text-shop-muted tabular-nums">
                    {[
                      payload?.destination,
                      payload?.travel_date && payload?.return_date ? `${payload.travel_date} → ${payload.return_date}` : payload?.travel_date,
                      payload?.nights ? translate("{value0} nights", { value0: translate(String(payload.nights)) }) : null,
                      counts.hotels ? translate("{value0} hotel{value1}", { value0: translate(String(counts.hotels)), value1: translate(String(counts.hotels === 1 ? '' : 's')) }) : null,
                      translate("{value0} offer{value1}", { value0: translate(String(counts.offers)), value1: translate(String(counts.offers === 1 ? '' : 's')) }),
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Nothing extracted'}
                  </p>
                </div>
                {total != null && (
                  <div className="text-end">
                    <span className="block text-[11px] font-bold tracking-[0.06em] text-shop-muted uppercase">{translate("Total")}</span>
                    <strong className="text-xl font-extrabold tabular-nums">
                      {formatQuoteMoney(total, payload?.currency || 'USD')}
                    </strong>
                  </div>
                )}
              </header>

              {updates && (
                <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-info-bg px-3 py-2.5 text-[13px] text-info-fg">
                  <span>
                    {translate('Updates the package you already have:')}{' '}<strong dir="auto">{updates.title}</strong>
                  </span>
                  {updatedPrice && (
                    <span className="tabular-nums">
                      {translate('Price')}{' '}{updatedPrice.before}{' → '}<strong>{updatedPrice.after}</strong>
                    </span>
                  )}
                </div>
              )}

              {rows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-shop-border">
                  <table className="relative w-full min-w-[560px] text-start text-sm">
                    <caption className="sr-only">{translate("Offers extracted from this package")}</caption>
                    <thead>
                      <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                        <th className="px-3 py-2">{translate("Offer")}</th>
                        <th className="px-3 py-2">{translate("Room · board")}</th>
                        <th className="px-3 py-2">{translate("Dates")}</th>
                        <th className="px-3 py-2 text-end">{translate("Price")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-b border-neutral-bg last:border-0">
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2 font-semibold">
                              {row.kind === 'flight' ? (
                                <Plane className="size-4 shrink-0 text-shop-muted" aria-label={translate("Flight")} />
                              ) : (
                                <Bed className="size-4 shrink-0 text-shop-muted" aria-label={translate("Hotel")} />
                              )}
                              {translate(row.title)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{row.detail || <span className="text-shop-muted">—</span>}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums">
                            {row.when || <span className="text-shop-muted">—</span>}
                          </td>
                          <td className="px-3 py-2 text-end font-bold whitespace-nowrap tabular-nums">
                            {row.price != null ? formatQuoteMoney(row.price, row.currency) : <span className="font-normal text-shop-muted">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-shop-muted">
                  {translate("No offers were found on this page.")}</p>
              )}

              {current.warnings.length > 0 && (
                <ul className="m-0 flex list-disc flex-col gap-1 rounded-lg bg-warn-bg py-2.5 pe-3 ps-7 text-[13px] text-warn-fg">
                  {current.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {problems.length > 0 && (
                <div role="alert" className="flex gap-2 rounded-lg bg-danger-bg px-3 py-2.5 text-[13px] text-danger-fg">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {translate("Can’t approve yet:")}{' '}{problems.join('; ')}{translate(". Use")}{' '}<strong>{translate("Edit details")}</strong> {' '}{translate("to fix it.")}</span>
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
