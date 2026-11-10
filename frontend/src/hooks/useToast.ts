import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from '../context/toast'

const NOOP: ToastContextValue = { show: () => {} }

/** Without a provider (an isolated component test) toasts are simply dropped. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP
}
