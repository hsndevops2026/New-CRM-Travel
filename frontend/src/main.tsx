import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './index.css'
import { AuthProvider, useAuth } from './context/AuthContext.tsx'
import { LanguageProvider } from './lib/i18n'
import type { ReactNode } from 'react'
import { ToastProvider } from './context/ToastProvider.tsx'
import ProtectedRoute from './components/ProtectedRoute.tsx'
import AppLayout from './layouts/AppLayout.tsx'
import CustomerLayout from './layouts/CustomerLayout.tsx'
import LoginPage from './pages/LoginPage.tsx'
import SignupPage from './pages/SignupPage.tsx'
import QuoteSharePage from './pages/QuoteSharePage.tsx'
import InboxPage from './pages/InboxPage.tsx'
import LeadsSegmentRoute from './pages/LeadsSegmentRoute.tsx'
import QuotesPage from './pages/QuotesPage.tsx'
import DealersPage from './pages/DealersPage.tsx'
import ContactsPage from './pages/ContactsPage.tsx'
import ContactProfilePage from './pages/ContactProfilePage.tsx'
import RemindersPage from './pages/RemindersPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import PermissionsPage from './pages/PermissionsPage.tsx'
import CustomerPortalPage from './pages/CustomerPortalPage.tsx'
import HomeRedirect from './components/HomeRedirect.tsx'

function InterfaceProviders({ children }: { children: ReactNode }) {
  const { admin } = useAuth()
  const { pathname } = useLocation()
  const customerPage = pathname.startsWith('/portal') || pathname.startsWith('/quote/')
  return (
    <LanguageProvider userId={admin?.id} forcedLanguage={customerPage ? 'en' : undefined}>
      <ToastProvider>{children}</ToastProvider>
    </LanguageProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InterfaceProviders>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              element={
                <ProtectedRoute staffOnly>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/inbox/:threadId" element={<InboxPage />} />
              <Route path="/leads" element={<Navigate to="/leads/hotel" replace />} />
              <Route path="/leads/:segment" element={<LeadsSegmentRoute />} />
              <Route path="/quotes" element={<QuotesPage />} />
              <Route path="/dealers" element={<DealersPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/contacts/:id" element={<ContactProfilePage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
            </Route>
            <Route
              element={
                <ProtectedRoute customerOnly>
                  <CustomerLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/portal" element={<CustomerPortalPage />} />
              <Route path="/portal/documents" element={<CustomerPortalPage />} />
              <Route path="/portal/chats" element={<CustomerPortalPage />} />
            </Route>
            <Route path="/quote/:token" element={<QuoteSharePage />} />
            <Route path="/" element={<HomeRedirect />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </InterfaceProviders>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
