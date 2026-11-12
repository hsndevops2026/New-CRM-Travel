import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './context/AuthContext.tsx'
import InterfaceProviders from './components/InterfaceProviders.tsx'
import ProtectedRoute from './components/ProtectedRoute.tsx'
import AppLayout from './layouts/AppLayout.tsx'
import CustomerLayout from './layouts/CustomerLayout.tsx'
import LoginPage from './pages/LoginPage.tsx'
import SignupPage from './pages/SignupPage.tsx'
import TravellerFormPage from './pages/TravellerFormPage.tsx'
import QuoteSharePage from './pages/QuoteSharePage.tsx'
import InboxPage from './pages/InboxPage.tsx'
import AssistantPage from './pages/AssistantPage.tsx'
import ReportsPage from './pages/ReportsPage.tsx'
import EmailPage from './pages/EmailPage.tsx'
import LeadsSegmentRoute from './pages/LeadsSegmentRoute.tsx'
import QuotesPage from './pages/QuotesPage.tsx'
import DealersPage from './pages/DealersPage.tsx'
import ContactsPage from './pages/ContactsPage.tsx'
import ContactProfilePage from './pages/ContactProfilePage.tsx'
import RemindersPage from './pages/RemindersPage.tsx'
import TasksPage from './pages/TasksPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import PermissionsPage from './pages/PermissionsPage.tsx'
import CustomerPortalPage from './pages/CustomerPortalPage.tsx'
import HomeRedirect from './components/HomeRedirect.tsx'

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
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/inbox/:threadId" element={<InboxPage />} />
              <Route path="/leads" element={<Navigate to="/leads/hotel" replace />} />
              <Route path="/leads/:segment" element={<LeadsSegmentRoute />} />
              <Route path="/quotes" element={<QuotesPage />} />
              <Route path="/dealers" element={<DealersPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/contacts/:id" element={<ContactProfilePage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/permissions" element={<PermissionsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/email" element={<EmailPage />} />
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
            <Route path="/travellers/:token" element={<TravellerFormPage />} />
            <Route path="/" element={<HomeRedirect />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </InterfaceProviders>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
