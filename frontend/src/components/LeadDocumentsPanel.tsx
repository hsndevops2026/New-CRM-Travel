import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Trash2, Upload } from 'lucide-react'
import Button from './ui/Button'
import {
  DOCUMENT_TYPE_NAMES,
  deleteLeadDocument,
  fetchLeadDocuments,
  uploadAndClassifyFiles,
  type BookingDocument,
} from '../lib/bookingDocuments'

type Props = {
  leadId: string
}

export default function LeadDocumentsPanel({ leadId }: Props) {
  useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<BookingDocument[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedLeadId, setLoadedLeadId] = useState(leadId)
  if (leadId !== loadedLeadId) {
    setLoadedLeadId(leadId)
    setLoading(true)
    setDocs([])
    setError(null)
  }

  const load = async () => {
    try {
      setDocs(await fetchLeadDocuments(leadId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchLeadDocuments(leadId)
      .then((next) => {
        if (cancelled) return
        setDocs(next)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load documents')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const onUpload = async (list: FileList | null) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setSaving(true)
    setError(null)
    setProgress({ done: 0, total: files.length })
    try {
      const { failed } = await uploadAndClassifyFiles(leadId, files, (done, total) => setProgress({ done, total }), title)
      setTitle('')
      if (failed.length) setError(translate('Could not upload: {value0}', { value0: failed.join('، ') }))
      await load()
    } finally {
      setSaving(false)
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDelete = async (doc: BookingDocument) => {
    setSaving(true)
    try {
      await deleteLeadDocument(leadId, doc.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[10px] border border-shop-border bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-4 text-shop-accent" />
        <h2 className="text-sm font-bold">{translate("Booking documents")}</h2>
      </div>
      <p className="mb-3 text-sm text-shop-muted">
        {translate("Upload tickets, vouchers, or invoices. Customers see these in their portal after booking.")}{' '}
        {translate('Pick several files at once: each one is read and renamed after what it is.')}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={translate("Document title (optional, single file)")}
          className="h-10 min-w-[200px] flex-1 rounded-lg border border-shop-border px-3 text-sm"
        />
        <Button
          size="sm"
          icon={<Upload className="size-4" />}
          loading={saving}
          onClick={() => inputRef.current?.click()}
        >
          {progress
            ? translate('Uploading and naming {value0}/{value1}…', { value0: Math.min(progress.done + 1, progress.total), value1: progress.total })
            : translate('Upload files')}</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void onUpload(e.target.files)}
        />
      </div>
      {error && <p className="mb-2 text-sm text-danger-fg">{error}</p>}
      {loading ? (
        <p className="text-sm text-shop-muted">{translate("Loading…")}</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-shop-muted">{translate("No documents uploaded yet.")}</p>
      ) : (
        <ul className="divide-y divide-shop-border rounded-lg border border-shop-border">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  {doc.document_type && DOCUMENT_TYPE_NAMES[doc.document_type] ? (
                    <span className="shrink-0 rounded bg-tint px-1.5 py-0.5 text-[11px] font-semibold text-shop-accent">
                      {translate(DOCUMENT_TYPE_NAMES[doc.document_type])}
                    </span>
                  ) : null}
                  <span dir="auto" className="truncate">{doc.title}</span>
                </p>
                <p className="truncate text-xs text-shop-muted">{doc.file_name || doc.file_url}</p>
              </div>
              <a
                href={doc.file_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-9 items-center justify-center rounded-lg text-shop-accent hover:bg-tint"
                aria-label={translate("Open {value0}", { value0: translate(String(doc.title)) })}
              >
                <ExternalLink className="size-4" />
              </a>
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
                aria-label={translate("Delete {value0}", { value0: translate(String(doc.title)) })}
                disabled={saving}
                onClick={() => void onDelete(doc)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
