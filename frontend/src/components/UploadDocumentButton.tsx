import { t as translate, useI18n } from '../lib/i18n'
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import Button from './ui/Button'
import { uploadAndClassifyFiles, type BookingDocument } from '../lib/bookingDocuments'

type Props = {
  leadId: string
  onUploaded: (document: BookingDocument) => void
  size?: 'sm' | 'md'
}

export default function UploadDocumentButton({ leadId, onUploaded, size = 'sm' }: Props) {
  useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const uploading = progress !== null

  const onPick = async (list: FileList | null) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setError(null)
    setProgress({ done: 0, total: files.length })
    try {
      const { documents, failed } = await uploadAndClassifyFiles(leadId, files, (done, total) => setProgress({ done, total }))
      documents.forEach(onUploaded)
      if (failed.length) setError(translate('Could not upload: {value0}', { value0: failed.join('، ') }))
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
        onChange={(e) => void onPick(e.target.files)}
      />
      <Button
        size={size}
        variant="secondary"
        icon={<Upload />}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {progress
          ? translate('Uploading and naming {value0}/{value1}…', { value0: Math.min(progress.done + 1, progress.total), value1: progress.total })
          : translate('Upload documents')}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
