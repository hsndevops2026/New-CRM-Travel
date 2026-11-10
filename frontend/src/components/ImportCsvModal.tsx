import { t as translate, useI18n } from '../lib/i18n'
import { useRef, useState } from 'react'
import {
  CSV_TEMPLATE,
  bulkCreateLeads,
  csvRowToLeadInput,
  parseCsv,
  type Lead,
} from '../lib/leads'

type Props = {
  open: boolean
  onClose: () => void
  onImported: (leads: Lead[]) => void
}

export default function ImportCsvModal({ open, onClose, onImported }: Props) {
  useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState(0)
  const [rows, setRows] = useState<ReturnType<typeof csvRowToLeadInput>[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leads-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (file: File | null) => {
    setError(null)
    setMessage(null)
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    const parsed = parseCsv(text).map(csvRowToLeadInput)
    setRows(parsed)
    setPreviewCount(parsed.length)
  }

  const importRows = async () => {
    if (!rows.length) {
      setError('Choose a CSV file first')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await bulkCreateLeads(rows)
      onImported(result.created || [])
      setMessage(
        translate("Imported {value0} lead(s)", { value0: translate(String(result.created_count)) }) +
          (result.failed_count ? translate(", {value0} failed", { value0: translate(String(result.failed_count)) }) : ''),
      )
      if (!result.failed_count) {
        setTimeout(() => {
          onClose()
          setRows([])
          setFileName(null)
          setPreviewCount(0)
          setMessage(null)
        }, 800)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-shop-border px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold">{translate("Import leads from CSV")}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg">
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
          <p className="text-sm text-shop-muted">
            {translate("Upload a CSV with columns: phone, booking_type, origin, destination, travel_date, return_date, adults_count, children_count, children_ages, hotel_name, notes, status.")}</p>

          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={downloadTemplate}
              className="min-h-11 rounded-lg border border-shop-border px-3 py-2 text-sm font-medium hover:bg-shop-bg"
            >
              {translate("Download template")}</button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="min-h-11 rounded-lg border border-shop-border px-3 py-2 text-sm font-medium hover:bg-shop-bg"
            >
              {translate("Choose CSV")}</button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </div>

          {fileName && (
            <div className="rounded-lg bg-shop-bg px-3 py-2 text-sm break-all">
              <strong>{fileName}</strong> · {previewCount}{' '}{translate("row(s) ready")}</div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{translate(error)}</p>}
          {message && <p className="rounded-lg bg-shop-green-bg px-3 py-2 text-sm text-shop-green">{translate(message)}</p>}

          <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-shop-border bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex sm:justify-end sm:px-0 sm:pb-0">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-shop-border px-4 py-2 text-sm font-medium hover:bg-shop-bg"
            >
              {translate("Cancel")}</button>
            <button
              type="button"
              disabled={saving || !rows.length}
              onClick={() => void importRows()}
              className="min-h-11 rounded-lg bg-shop-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
            >
              {saving ? translate('Importing…') : translate("Import CSV")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
