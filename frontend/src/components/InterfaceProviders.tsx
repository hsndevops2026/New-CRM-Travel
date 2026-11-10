import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import { ToastProvider } from '../context/ToastProvider.tsx'
import { LanguageProvider } from '../lib/i18n'

/** Language per signed-in user; customer pages stay in English until Task 2. */
export default function InterfaceProviders({ children }: { children: ReactNode }) {
  const { admin } = useAuth()
  const { pathname } = useLocation()
  const customerPage = pathname.startsWith('/portal') || pathname.startsWith('/quote/')
  return (
    <LanguageProvider userId={admin?.id} forcedLanguage={customerPage ? 'en' : undefined}>
      <ToastProvider>{children}</ToastProvider>
    </LanguageProvider>
  )
}
