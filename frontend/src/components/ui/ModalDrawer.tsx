import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type Props = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  maxWidthClassName?: string
  /** `side` slides in from the right as a full-height panel (editing one record in place). */
  variant?: 'dialog' | 'side'
}

export default function ModalDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidthClassName = 'max-w-2xl',
  variant = 'dialog',
}: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) || [])
    dialog?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  const side = variant === 'side'

  return (
    <div
      className={`fixed inset-0 z-50 bg-shop-ink/45 ${
        side ? 'flex items-end justify-end sm:items-stretch' : 'flex items-end justify-center sm:items-center sm:p-4'
      }`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex w-full flex-col bg-white shadow-[0_20px_48px_rgba(15,23,42,0.25)] ${
          side
            ? 'max-h-[92dvh] max-w-none rounded-t-[14px] sm:max-h-none sm:max-w-[420px] sm:rounded-none'
            : `max-h-[92dvh] ${maxWidthClassName} rounded-t-[14px] sm:max-h-[90vh] sm:rounded-[14px]`
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-shop-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-sm text-shop-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg text-neutral-fg hover:bg-neutral-bg max-sm:size-11"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-shop-border px-4 py-3 sm:px-5">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
