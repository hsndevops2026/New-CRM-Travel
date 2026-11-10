import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import Button from './ui/Button'
import {
  createLeadDocument,
  uploadBookingFile,
  type BookingDocument,
} from '../lib/bookingDocuments'

type Props = {
  leadId: string
  onUploaded: (document: BookingDocument) => void
  size?: 'sm' | 'md'
}

export default function UploadDocumentButton({ leadId, onUploaded, size = 'sm' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPick = async (file: File | null) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadBookingFile(file)
      const title = file.name.replace(/\.[^.]+$/, '') || file.name
      const document = await createLeadDocument(leadId, {
        title,
        file_url: uploaded.url,
        file_name: uploaded.fileName,
        mime_type: uploaded.mimeType,
      })
      onUploaded(document)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
        onChange={(e) => void onPick(e.target.files?.[0] || null)}
      />
      <Button
        size={size}
        variant="secondary"
        icon={<Upload />}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? 'Uploading…' : 'Upload document'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
