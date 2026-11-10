import { t as translate, useI18n } from '../lib/i18n'
import { useRef, useState } from 'react'
import { uploadQuoteImage } from '../lib/predefinedQuotes'
import Button from './ui/Button'

type Props = {
  label: string
  value?: string | null
  onChange: (url: string) => void
}

export default function ImageUpload({ label, value, onChange }: Props) {
  useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose a JPG, PNG, or WebP image')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Keep images under 8 MB')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const url = await uploadQuoteImage(file)
      onChange(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{translate(label)}</span>
      {value ? (
        <div className="flex items-start gap-3">
          <img src={value} alt="" className="size-16 rounded-lg object-cover ring-1 ring-shop-border" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? translate('Uploading…') : translate('Replace')}
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => onChange('')} disabled={uploading}>
              {translate("Remove")}</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-shop-border bg-shop-bg/50 px-3 text-xs font-medium text-shop-muted hover:bg-shop-bg"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? translate("Uploading to Cloudinary…") : translate("Upload image")}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      {error && <p className="text-xs text-red-700">{translate(error)}</p>}
    </div>
  )
}
