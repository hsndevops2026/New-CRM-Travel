import { useCallback, useRef, useState, type ReactNode } from 'react'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

/**
 * `await confirm({...})` instead of `window.confirm(...)`. Render `dialog` somewhere in the
 * component's output; it resolves true on confirm and false on cancel / Escape / backdrop.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second request while one is open cancels the first rather than leaving it hanging.
    resolver.current?.(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }

  const dialog = options ? (
    <ConfirmDialog open {...options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  ) : null

  return { confirm, dialog }
}
