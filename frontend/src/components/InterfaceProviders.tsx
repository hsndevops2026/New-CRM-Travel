import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.tsx'
import { ToastProvider } from '../context/ToastProvider.tsx'
import { LanguageProvider } from '../lib/i18n'

/**
 * Language per signed-in user. Customer pages (portal, quote link) default to
 * Arabic; ?lang=en or ?lang=he switches them for that customer.
 */
export default function InterfaceProviders({ children }: { children: ReactNode }) {
  const { admin } = useAuth()
  const { pathname, search } = useLocation()
  const customerPage = pathname.startsWith('/portal') || pathname.startsWith('/quote/') || pathname.startsWith('/travellers/') || pathname === '/offers'
  const requested = new URLSearchParams(search).get('lang')
  const customerLanguage = requested === 'en' || requested === 'he' ? requested : 'ar'
  return (
    <LanguageProvider userId={admin?.id} forcedLanguage={customerPage ? customerLanguage : undefined}>
      <ToastProvider>{children}</ToastProvider>
    </LanguageProvider>
  )
}
