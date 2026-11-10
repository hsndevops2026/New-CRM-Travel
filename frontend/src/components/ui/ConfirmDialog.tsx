import { useEffect, useId, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import Button from './Button'

type Props = {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  /** `danger` is for things that can't be undone. */
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation dialog (design system): says what will happen, names the thing, and puts the
 * safe choice first. Replaces window.confirm.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const descId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Land on the safe choice, never on the destructive one.
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-shop-ink/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[14px] bg-white p-6 shadow-[0_20px_48px_rgba(15,23,42,0.25)]"
      >
        {tone === 'danger' && (
          <div aria-hidden="true" className="grid size-10 place-items-center rounded-[10px] bg-danger-bg text-danger">
            <Trash2 className="size-5" />
          </div>
        )}
        <h3 id={titleId} className="text-lg font-bold">
          {title}
        </h3>
        {description && (
          <p id={descId} className="text-shop-muted">
            {description}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-line-strong bg-white px-3.5 text-[13px] font-semibold hover:bg-neutral-bg disabled:opacity-60 max-sm:h-11"
          >
            {cancelLabel}
          </button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
