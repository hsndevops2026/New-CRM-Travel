import { createContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export type ToastOptions = {
  message: string
  tone?: ToastTone
  /** Milliseconds before it dismisses itself. Errors stay longer. */
  duration?: number
}

export type ToastContextValue = {
  show: (toast: ToastOptions) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
