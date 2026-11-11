import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Mail,
  Briefcase,
  ChevronDown,
  FileText,
  Inbox,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  User,
  X,
} from 'lucide-react'
import { SearchProvider } from '../context/SearchProvider'
import { useSearch } from '../hooks/useSearch'
import { useNavCounts } from '../hooks/useNavCounts'
import { useAuth } from '../context/AuthContext'
import { fetchAgencySettings, type AgencySettings } from '../lib/agencySettings'
import { initialsFromName, nameFromEmail } from '../lib/people'
import type { NavCounts } from '../lib/navCounts'
import StatusBadge from '../components/ui/StatusBadge'
import LanguageSwitcher from '../components/LanguageSwitcher'

type NavEntry = {
  to: string
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  match: (pathname: string) => boolean
  adminOnly?: boolean
}

// Order and grouping follow the design: work areas, a divider, then admin areas.
const PRIMARY_NAV: NavEntry[] = [
  { to: '/inbox', label: 'Inbox', icon: Inbox, match: (path) => path.startsWith('/inbox') },
  { to: '/leads/hotel', label: 'Leads', icon: Briefcase, match: (path) => path.startsWith('/leads') },
  { to: '/quotes', label: 'Quotes', icon: FileText, match: (path) => path.startsWith('/quotes') },
  { to: '/dealers', label: 'Dealers', icon: Store, match: (path) => path.startsWith('/dealers') },
  { to: '/contacts', label: 'Contacts', icon: User, match: (path) => path.startsWith('/contacts') },
  { to: '/reminders', label: 'Reminders', icon: Bell, match: (path) => path.startsWith('/reminders') },
  { to: '/email', label: 'Email', icon: Mail, match: (path) => path.startsWith('/email') },
  { to: '/assistant', label: 'Assistant', icon: Sparkles, match: (path) => path.startsWith('/assistant') },
]
const ADMIN_NAV: NavEntry[] = [
  { to: '/reports', label: 'Reports', icon: BarChart3, match: (path) => path.startsWith('/reports'), adminOnly: true },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal, match: (path) => path.startsWith('/settings'), adminOnly: true },
  { to: '/permissions', label: 'Permissions', icon: ShieldCheck, match: (path) => path.startsWith('/permissions'), adminOnly: true },
]

/** The number beside a nav item: a teal badge for work waiting, amber for approvals, plain for totals. */
function countFor(to: string, counts: NavCounts | null): ReactNode {
  if (!counts) return null
  if (to === '/inbox' && counts.inbox_awaiting > 0) {
    return <StatusBadge label={String(counts.inbox_awaiting)} tone="success" className="tabular-nums" />
  }
  if (to === '/leads/hotel') {
    return <span className="text-xs tabular-nums text-shop-muted">{counts.leads_open}</span>
  }
  if (to === '/permissions' && counts.approvals_pending) {
    return <StatusBadge label={String(counts.approvals_pending)} tone="warning" className="tabular-nums" />
  }
  if (to === '/reminders' && counts.reminders_open > 0) {
    return <StatusBadge label={String(counts.reminders_open)} tone="warning" className="tabular-nums" />
  }
  return null
}

function NavItem({
  entry,
  active,
  counts,
  onNavigate,
}: {
  entry: NavEntry
  active: boolean
  counts: NavCounts | null
  onNavigate?: () => void
}) {
  useI18n()
  const Icon = entry.icon
  return (
    <Link
      to={entry.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm no-underline transition-colors max-md:h-11 ${
        active
          ? 'bg-tint font-bold text-shop-accent'
          : 'font-medium text-neutral-fg hover:bg-neutral-bg hover:text-shop-ink'
      }`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      <span className="flex-1">{translate(entry.label)}</span>
      {countFor(entry.to, counts)}
    </Link>
  )
}

function SidebarNav({ counts, onNavigate }: { counts: NavCounts | null; onNavigate?: () => void }) {
  useI18n()
  const location = useLocation()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const adminItems = ADMIN_NAV.filter((entry) => isAdmin || !entry.adminOnly)

  return (
    <nav aria-label={translate("Main navigation")} className="flex flex-col gap-0.5">
      {PRIMARY_NAV.map((entry) => (
        <NavItem key={entry.to} entry={entry} active={entry.match(location.pathname)} counts={counts} onNavigate={onNavigate} />
      ))}
      {adminItems.length > 0 && (
        <>
          <div className="my-2.5 h-px bg-shop-border" role="separator" />
          {adminItems.map((entry) => (
            <NavItem key={entry.to} entry={entry} active={entry.match(location.pathname)} counts={counts} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  )
}

function Brand({ agency, size = 30 }: { agency: AgencySettings | null; size?: number }) {
  useI18n()
  const name = agency?.agency_name || 'Horizon Travel'
  return (
    <div className="flex items-center gap-2.5">
      {agency?.logo_url ? (
        <img src={agency.logo_url} alt="" style={{ width: size, height: size }} className="rounded-lg object-contain" />
      ) : (
        <span
          aria-hidden="true"
          style={{ width: size, height: size }}
          className="flex items-center justify-center rounded-lg bg-shop-accent font-extrabold text-white"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <strong className="truncate">{name}</strong>
        <span className="text-xs text-shop-muted">{translate("Agency CRM")}</span>
      </div>
    </div>
  )
}

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  useI18n()
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-shop-accent text-xs font-bold text-white"
    >
      {initialsFromName(name)}
    </span>
  )
}

/** Agents work from a lead allowance; admins are unlimited, so only agents see the meter. */
function CreditsCard() {
  useI18n()
  const { admin } = useAuth()
  if (admin?.role !== 'agent') return null
  const left = admin.lead_credits ?? 0
  const used = admin.leads_used ?? 0
  const total = left + used
  const percent = total > 0 ? Math.round((left / total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-shop-border p-2.5">
      <div className="flex justify-between">
        <span className="text-xs font-semibold text-slate-600">{translate("Lead credits")}</span>
        <span className="font-bold tabular-nums">{left}</span>
      </div>
      <div
        className="h-1.5 rounded-sm bg-neutral-bg"
        role="meter"
        aria-label={translate("Lead credits remaining")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
      >
        <div className="h-1.5 rounded-sm bg-shop-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-shop-muted">{used}{' '}{translate("used ·")}{' '}{left}{' '}{translate("left")}</span>
    </div>
  )
}

function Shell() {
  useI18n()
  const { admin, logout } = useAuth()
  const navigate = useNavigate()
  const { query, setQuery, placeholder } = useSearch()
  const location = useLocation()
  const counts = useNavCounts(Boolean(admin))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agency, setAgency] = useState<AgencySettings | null>(null)
  const searchEnabled = /^\/(inbox|quotes|dealers|contacts)(\/|$)/.test(location.pathname)
    || /^\/leads\/(hotel|flight|package)$/.test(location.pathname)

  const displayName = nameFromEmail(admin?.email)
  const signOut = () => {
    setMenuOpen(false)
    setSidebarOpen(false)
    void logout().then(() => navigate('/login', { replace: true }))
  }

  useEffect(() => {
    setQuery('')
  }, [location.pathname, setQuery])

  useEffect(() => {
    fetchAgencySettings().then(setAgency).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-admin-menu]')) return
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const searchField = (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-shop-muted" strokeWidth={1.8} />
      <input
        type="search"
        aria-label={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-shop-bg ps-[34px] pe-3 text-sm placeholder:text-shop-muted focus:border-shop-accent focus:bg-white max-md:h-11"
      />
    </div>
  )

  return (
    <div className="flex h-dvh bg-shop-bg text-shop-ink">
      <aside className="hidden h-full w-[232px] shrink-0 flex-col gap-0.5 border-e border-shop-border bg-shop-sidebar px-3 py-3.5 md:flex">
        <button
          type="button"
          onClick={() => navigate('/inbox')}
          className="px-2 pb-4 pt-1 text-start"
          aria-label={translate("Go to Inbox")}
        >
          <Brand agency={agency} />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav counts={counts} />
        </div>
        <CreditsCard />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={translate("Close menu")}
            className="absolute inset-0 bg-shop-ink/45"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={translate("Main menu")}
            className="absolute inset-y-0 start-0 flex w-[min(300px,85vw)] flex-col gap-1 bg-white px-3 py-4 shadow-[8px_0_32px_rgba(15,23,42,.2)]"
          >
            <div className="flex items-center px-2 pb-4 pt-1">
              <div className="min-w-0 flex-1">
                <Brand agency={agency} size={34} />
              </div>
              <button
                type="button"
                aria-label={translate("Close menu")}
                className="flex size-11 items-center justify-center text-neutral-fg"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="size-4" strokeWidth={1.8} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav counts={counts} onNavigate={() => setSidebarOpen(false)} />
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-shop-border p-3">
              <Avatar name={displayName} size={36} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <strong className="truncate">{displayName}</strong>
                <span className="truncate text-[13px] capitalize text-shop-muted">
                  {translate(admin?.role)}
                  {admin?.role === 'agent' ? translate(" · {value0} credits", { value0: translate(String(admin.lead_credits ?? 0)) }) : ''}
                </span>
              </div>
              <button type="button" onClick={signOut} className="text-sm font-semibold text-shop-accent">
                {translate("Sign out")}</button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-shop-border bg-white px-3 md:px-6">
          <LanguageSwitcher />
          <button
            type="button"
            aria-label={translate("Open menu")}
            className="flex size-11 items-center justify-center rounded-lg text-shop-ink hover:bg-neutral-bg md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" strokeWidth={1.8} />
          </button>
          <span className="truncate font-bold md:hidden">{agency?.agency_name || 'Horizon Travel'}</span>
          {searchEnabled && <div className="hidden w-full max-w-[520px] flex-1 md:block">{searchField}</div>}
          <div className="relative ms-auto" data-admin-menu>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={translate("Account menu")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-9 items-center gap-2 rounded-lg px-1.5 hover:bg-neutral-bg max-sm:h-11 max-sm:min-w-11 max-sm:justify-center"
              title={admin?.email || ''}
            >
              <Avatar name={displayName} />
              <strong className="hidden text-[13px] sm:inline">{displayName}</strong>
              <ChevronDown className="hidden size-4 text-neutral-fg sm:block" strokeWidth={1.8} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute end-0 z-30 mt-2 w-64 rounded-[10px] border border-shop-border bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,.12)]"
              >
                <div className="px-2.5 py-2">
                  <div className="truncate font-semibold">{displayName}</div>
                  <div className="truncate text-xs text-shop-muted">{admin?.email}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {admin?.role && <StatusBadge label={admin.role} tone={admin.role === 'admin' ? 'success' : 'neutral'} />}
                    {admin?.role === 'agent' && (
                      <span className="text-xs tabular-nums text-shop-muted">{admin.lead_credits ?? 0}{' '}{translate("credits left")}</span>
                    )}
                  </div>
                </div>
                <div className="my-1 h-px bg-shop-border" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-start text-sm font-semibold text-neutral-fg hover:bg-neutral-bg"
                  onClick={signOut}
                >
                  <LogOut className="size-4" strokeWidth={1.8} />
                  {translate("Sign out")}</button>
              </div>
            )}
          </div>
        </header>

        {searchEnabled && <div className="border-b border-shop-border bg-white px-3 py-2 md:hidden">{searchField}</div>}

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default function AppLayout() {
  useI18n()
  return (
    <SearchProvider>
      <Shell />
    </SearchProvider>
  )
}
