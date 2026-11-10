import { useEffect, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { FileText, LogOut, MessageCircle, Plane } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { initialsFromName, nameFromEmail } from '../lib/people'
import { fetchPortalHome } from '../lib/portal'

const NAV = [
  { to: '/portal', label: 'Bookings', icon: Plane, end: true },
  { to: '/portal/documents', label: 'Documents', icon: FileText, end: false },
  { to: '/portal/chats', label: 'Chats', icon: MessageCircle, end: false },
] as const

export default function CustomerLayout({ children }: { children?: ReactNode }) {
  const { admin, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [brand, setBrand] = useState<{ agency_name?: string; logo_url?: string | null } | null>(null)
  const displayName = admin ? nameFromEmail(admin.email) : 'Guest'
  const agencyName = brand?.agency_name || 'Horizon Travel'

  useEffect(() => {
    fetchPortalHome()
      .then((home) => setBrand(home.agency || null))
      .catch(() => undefined)
  }, [])

  const signOut = () => {
    void logout().then(() => navigate('/login', { replace: true }))
  }

  return (
    <div className="flex min-h-dvh flex-col bg-shop-bg text-shop-ink">
      <header className="sticky top-0 z-20 border-b border-shop-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt="" className="size-8 rounded-lg object-contain" />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-lg bg-shop-accent font-extrabold text-white">
                {agencyName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="flex min-w-0 flex-col leading-tight">
              <strong className="truncate text-sm">{agencyName}</strong>
              <span className="text-xs text-shop-muted">Customer portal</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-shop-muted sm:inline">{displayName}</span>
            <span className="flex size-8 items-center justify-center rounded-full bg-shop-accent text-xs font-bold text-white">
              {initialsFromName(displayName)}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-shop-muted hover:bg-neutral-bg hover:text-shop-ink"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav aria-label="Customer portal" className="mx-auto flex max-w-5xl gap-1 px-4 pb-2">
          {NAV.map((item) => {
            const active = item.end
              ? location.pathname === item.to
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm no-underline ${
                  active
                    ? 'bg-tint font-bold text-shop-accent'
                    : 'font-medium text-neutral-fg hover:bg-neutral-bg'
                }`}
              >
                <Icon className="size-4" strokeWidth={1.8} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children || <Outlet />}</main>
    </div>
  )
}
