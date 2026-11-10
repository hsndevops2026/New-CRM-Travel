import { t as translate, useI18n } from '../lib/i18n'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { ToastContext, type ToastOptions, type ToastTone } from './toast'

type Item = { id: number; message: string; tone: ToastTone }

const TONE: Record<ToastTone, { box: string; icon: ReactNode; role: 'status' | 'alert' }> = {
  success: { box: 'bg-primary-800 text-white', icon: <Check className="size-4" />, role: 'status' },
  error: { box: 'bg-danger text-white', icon: <CircleAlert className="size-4" />, role: 'alert' },
  info: { box: 'bg-shop-ink text-white', icon: <Info className="size-4" />, role: 'status' },
}

/**
 * Short confirmations and errors that don't need a decision ("Link copied", "Could not
 * download"). They replace window.alert, which blocks the page and can't be styled.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  useI18n()
  const [items, setItems] = useState<Item[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const show = useCallback(
    ({ message, tone = 'info', duration }: ToastOptions) => {
      const id = nextId.current++
      setItems((list) => [...list.slice(-3), { id, message, tone }])
      window.setTimeout(() => dismiss(id), duration ?? (tone === 'error' ? 8000 : 4000))
    },
    [dismiss],
  )

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed end-4 bottom-4 start-4 z-[60] flex flex-col items-center gap-2 sm:start-auto sm:items-end">
        {items.map((item) => (
          <div
            key={item.id}
            role={TONE[item.tone].role}
            className={`pointer-events-auto flex max-w-md items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] font-medium shadow-[0_8px_24px_rgba(15,23,42,0.2)] ${TONE[item.tone].box}`}
          >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {TONE[item.tone].icon}
            </span>
            <span className="min-w-0 flex-1">{translate(item.message)}</span>
            <button
              type="button"
              aria-label={translate("Dismiss")}
              onClick={() => dismiss(item.id)}
              className="-m-1 grid size-7 shrink-0 place-items-center rounded-md hover:bg-white/15"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
