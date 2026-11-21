import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  ListChecks,
  Bell,
  Mail,
  Briefcase,
  CalendarDays,
  ChevronDown,
  FileText,
  Inbox,
  LogOut,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Target,
  User,
  UsersRound,
  X,
} from 'lucide-react'
import { SearchProvider } from '../context/SearchProvider'
import NotificationBell from '../components/NotificationBell'
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
  { to: '/tasks', label: 'Tasks', icon: ListChecks, match: (path) => path.startsWith('/tasks') },
  { to: '/board', label: 'This week', icon: CalendarDays, match: (path) => path.startsWith('/board') },
  { to: '/groups', label: 'Group trips', icon: UsersRound, match: (path) => path.startsWith('/groups') },
  { to: '/targets', label: 'Targets', icon: Target, match: (path) => path.startsWith('/targets') },
  { to: '/email', label: 'Email', icon: Mail, match: (path) => path.startsWith('/email') },
  { to: '/assistant', label: 'Assistant', icon: Sparkles, match: (path) => path.startsWith('/assistant') },
  { to: '/website-chat', label: 'Website chat', icon: MessagesSquare, match: (path) => path.startsWith('/website-chat') },
]
const ADMIN_NAV: NavEntry[] = [
  { to: '/reports', label: 'Reports', icon: BarChart3, match: (path) => path.startsWith('/reports'), adminOnly: true },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal, match: (path) => path.startsWith('/settings'), adminOnly: true },
  { to: '/permissions', label: 'Permissions', icon: ShieldCheck, match: (path) => path.startsWith('/permissions'), adminOnly: true },
]

/** The number beside a nav item: a teal badge for work waiting, amber for approvals, plain for totals. */
const PILL = 'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums'

function countFor(to: string, counts: NavCounts | null): ReactNode {
  if (!counts) return null
  if (to === '/inbox' && counts.inbox_awaiting > 0) {
    return <span className={`${PILL} bg-teal-400 text-teal-950`}>{counts.inbox_awaiting}</span>
  }
  if (to === '/leads/hotel') {
    return <span className="text-xs tabular-nums text-sidebar-muted">{counts.leads_open}</span>
  }
  if (to === '/permissions' && counts.approvals_pending) {
    return <span className={`${PILL} bg-amber-300 text-amber-950`}>{counts.approvals_pending}</span>
  }
  if (to === '/reminders' && counts.reminders_open > 0) {
    return <span className={`${PILL} bg-amber-300 text-amber-950`}>{counts.reminders_open}</span>
  }
  return null
}

/** Dot on a collapsed icon: only for work that needs attention, not plain totals. */
function hasAttentionCount(to: string, counts: NavCounts | null): boolean {
  if (!counts) return false
  if (to === '/inbox') return counts.inbox_awaiting > 0
  if (to === '/permissions') return Boolean(counts.approvals_pending)
  if (to === '/reminders') return counts.reminders_open > 0
  return false
}

const SIDEBAR_COLLAPSED_KEY = 'crm.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* preference just is not remembered */
  }
}

function NavItem({
  entry,
  active,
  counts,
  onNavigate,
  collapsed,
}: {
  entry: NavEntry
  active: boolean
  counts: NavCounts | null
  onNavigate?: () => void
  collapsed?: boolean
}) {
  useI18n()
  const Icon = entry.icon
  const label = translate(entry.label)
  return (
    <Link
      to={entry.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`relative flex h-9 items-center rounded-lg text-[13.5px] no-underline transition-colors max-md:h-11 ${
        collapsed ? 'justify-center px-0' : 'gap-3 px-2.5'
      } ${
        active
          ? 'bg-sidebar-active font-semibold text-white before:absolute before:inset-y-2 before:-start-3 before:w-[3px] before:rounded-e-full before:bg-teal-400'
          : 'font-medium text-sidebar-ink hover:bg-sidebar-hover hover:text-white'
      }`}
    >
      <Icon className={`size-[18px] shrink-0 ${active ? 'text-teal-300' : 'text-sidebar-muted'}`} strokeWidth={1.8} />
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {countFor(entry.to, counts)}
        </>
      )}
      {collapsed && hasAttentionCount(entry.to, counts) && (
        <span className="absolute end-1 top-1 size-1.5 rounded-full bg-teal-400" aria-hidden="true" />
      )}
    </Link>
  )
}

function SidebarNav({
  counts,
  onNavigate,
  collapsed,
}: {
  counts: NavCounts | null
  onNavigate?: () => void
  collapsed?: boolean
}) {
  useI18n()
  const location = useLocation()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const adminItems = ADMIN_NAV.filter((entry) => isAdmin || !entry.adminOnly)

  return (
    <nav aria-label={translate("Main navigation")} className="flex flex-col gap-0.5">
      {!collapsed && (
        <p aria-hidden="true" className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-sidebar-muted uppercase">{translate("Workspace")}</p>
      )}
      {PRIMARY_NAV.map((entry) => (
        <NavItem key={entry.to} entry={entry} active={entry.match(location.pathname)} counts={counts} onNavigate={onNavigate} collapsed={collapsed} />
      ))}
      {adminItems.length > 0 && (
        <>
          <div className={`mb-1.5 h-px bg-sidebar-line ${collapsed ? 'mx-1 mt-2' : 'mt-4'}`} role="separator" />
          {!collapsed && (
            <p aria-hidden="true" className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-sidebar-muted uppercase">{translate("Admin")}</p>
          )}
          {adminItems.map((entry) => (
            <NavItem key={entry.to} entry={entry} active={entry.match(location.pathname)} counts={counts} onNavigate={onNavigate} collapsed={collapsed} />
          ))}
        </>
      )}
    </nav>
  )
}

function Brand({ agency, size = 30, collapsed }: { agency: AgencySettings | null; size?: number; collapsed?: boolean }) {
  useI18n()
  const name = agency?.agency_name || 'Horizon Travel'
  return (
    <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
      {agency?.logo_url ? (
        <img src={agency.logo_url} alt="" style={{ width: size, height: size }} className="rounded-[10px] bg-white object-contain p-0.5" />
      ) : (
        <span
          aria-hidden="true"
          style={{ width: size, height: size }}
          className="flex items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-300 to-teal-600 font-extrabold text-teal-950 shadow-[0_2px_8px_rgb(20_184_166/0.35)]"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {!collapsed && (
        <div className="flex min-w-0 flex-col leading-tight">
          <strong className="truncate text-[15px] text-white">{name}</strong>
          <span className="text-xs text-sidebar-muted">{translate("Agency CRM")}</span>
        </div>
      )}
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
function CreditsCard({ collapsed }: { collapsed?: boolean }) {
  useI18n()
  const { admin } = useAuth()
  if (admin?.role !== 'agent') return null
  const left = admin.lead_credits ?? 0
  const used = admin.leads_used ?? 0
  const total = left + used
  const percent = total > 0 ? Math.round((left / total) * 100) : 0
  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center gap-1 rounded-xl bg-sidebar-hover px-1.5 py-2 text-sidebar-ink"
        title={`${left} ${translate("credits left")}`}
      >
        <span className="text-xs font-bold text-white tabular-nums">{left}</span>
        <div
          className="h-1 w-full rounded-full bg-white/10"
          role="meter"
          aria-label={translate("Lead credits remaining")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={left}
        >
          <div className="h-1 rounded-full bg-teal-400" style={{ width: `${percent}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-sidebar-hover p-3 text-sidebar-ink">
      <div className="flex justify-between">
        <span className="text-xs font-semibold text-sidebar-muted">{translate("Lead credits")}</span>
        <span className="font-bold text-white tabular-nums">{left}</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-white/10"
        role="meter"
        aria-label={translate("Lead credits remaining")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
      >
        <div className="h-1.5 rounded-full bg-teal-400" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-sidebar-muted">{used}{' '}{translate("used ·")}{' '}{left}{' '}{translate("left")}</span>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agency, setAgency] = useState<AgencySettings | null>(null)
  const searchEnabled = /^\/(inbox|quotes|dealers|contacts)(\/|$)/.test(location.pathname)
    || /^\/leads\/(hotel|flight|package)$/.test(location.pathname)

  const displayName = nameFromEmail(admin?.email)
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      writeSidebarCollapsed(next)
      return next
    })
  }
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
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-shop-muted" strokeWidth={1.8} />
      <input
        type="search"
        aria-label={translate(placeholder)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={translate(placeholder)}
        className="h-10 w-full rounded-full border border-shop-border bg-shop-bg ps-10 pe-4 text-sm transition-colors hover:border-line-strong focus:bg-white max-md:h-11"
      />
    </div>
  )

  return (
    <div className="flex h-dvh bg-shop-bg text-shop-ink">
      <aside
        className={`hidden h-full shrink-0 flex-col gap-3 bg-sidebar-bg py-4 transition-[width] duration-200 ease-out md:flex ${
          sidebarCollapsed ? 'w-[68px] px-2' : 'w-[244px] px-3'
        }`}
        data-collapsed={sidebarCollapsed || undefined}
      >
        <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'flex-col' : ''}`}>
          <button
            type="button"
            onClick={() => navigate('/inbox')}
            className={`min-w-0 flex-1 rounded-lg pt-1 text-start ${sidebarCollapsed ? 'px-0 pb-1' : 'px-2 pb-3'}`}
            aria-label={translate("Go to Inbox")}
          >
            <Brand agency={agency} collapsed={sidebarCollapsed} />
          </button>
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? translate("Expand sidebar") : translate("Collapse sidebar")}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? translate("Expand sidebar") : translate("Collapse sidebar")}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sidebar-ink hover:bg-sidebar-hover hover:text-white"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            )}
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] ${sidebarCollapsed ? '' : 'ps-3 -ms-3'}`}>
          <SidebarNav counts={counts} collapsed={sidebarCollapsed} />
        </div>
        <CreditsCard collapsed={sidebarCollapsed} />
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
            className="absolute inset-y-0 start-0 flex w-[min(300px,85vw)] flex-col gap-3 bg-sidebar-bg px-3 py-4 shadow-[8px_0_32px_rgba(15,23,42,.3)]"
          >
            <div className="flex items-center px-2 pb-4 pt-1">
              <div className="min-w-0 flex-1">
                <Brand agency={agency} size={34} />
              </div>
              <button
                type="button"
                aria-label={translate("Close menu")}
                className="flex size-11 items-center justify-center rounded-lg text-sidebar-ink hover:bg-sidebar-hover"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="size-4" strokeWidth={1.8} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto ps-3 -ms-3">
              <SidebarNav counts={counts} onNavigate={() => setSidebarOpen(false)} />
            </div>
            <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-hover p-3 text-sidebar-ink">
              <Avatar name={displayName} size={36} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <strong className="truncate text-white">{displayName}</strong>
                <span className="truncate text-[13px] capitalize text-sidebar-muted">
                  {translate(admin?.role)}
                  {admin?.role === 'agent' ? translate(" · {value0} credits", { value0: translate(String(admin.lead_credits ?? 0)) }) : ''}
                </span>
              </div>
              <button type="button" onClick={signOut} className="text-sm font-semibold text-teal-300">
                {translate("Sign out")}</button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-shop-border bg-white/85 px-3 backdrop-blur-md md:px-6">
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
          <div className="ms-auto">
            <NotificationBell />
          </div>
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
                className="absolute end-0 z-30 mt-2 w-64 rounded-xl border border-shop-border bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,.14)]"
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
