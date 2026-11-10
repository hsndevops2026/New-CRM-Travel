import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Check, CircleAlert, Lock, Search } from 'lucide-react'
import { apiJson } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { useToast } from '../hooks/useToast'
import Banner from '../components/ui/Banner'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import StatusBadge from '../components/ui/StatusBadge'
import { TableSkeleton } from '../components/ui/Skeleton'
import { nameFromEmail, initialsFromName } from '../lib/people'
import {
  STAFF_TABS,
  creditSummary,
  defaultStaffTab,
  parseCreditAmount,
  staffCounts,
  visibleStaff,
  type StaffTab,
  type StaffUser,
} from '../lib/permissionsView'

const EMPTY_COPY: Record<StaffTab, { title: string; description: string }> = {
  pending: { title: 'No pending requests', description: 'New sign-ups will appear here for approval.' },
  approved: { title: 'No approved staff yet', description: 'Approve a pending request to give someone access.' },
  revoked: { title: 'Nobody is blocked', description: 'Rejected requests and blocked accounts are listed here.' },
}

export default function PermissionsPage() {
  const { admin } = useAuth()
  const toast = useToast()
  const { confirm, dialog } = useConfirm()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<StaffTab | null>(null)
  const [query, setQuery] = useState('')

  const reload = useCallback(async () => {
    const data = await apiJson<{ users: StaffUser[] }>('/api/permissions/users')
    setUsers(data.users)
    return data.users
  }, [])

  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load users'))
      .finally(() => setLoading(false))
  }, [reload])

  const counts = useMemo(() => staffCounts(users), [users])
  const activeTab = tab ?? defaultStaffTab(users)
  const rows = useMemo(() => visibleStaff(users, activeTab, query), [users, activeTab, query])

  if (admin?.role !== 'admin') return <Navigate to="/leads/hotel" replace />

  async function setApproval(user: StaffUser, status: 'approved' | 'revoked', done: string) {
    setBusy(user.id)
    setError(null)
    try {
      await apiJson(`/api/permissions/users/${user.id}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await reload()
      toast.show({ tone: 'success', message: `${user.email}: ${done}.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update access')
    } finally {
      setBusy(null)
    }
  }

  async function revoke(user: StaffUser) {
    const pending = user.approval_status === 'pending'
    const ok = await confirm({
      title: `${pending ? 'Reject' : 'Block'} ${user.email}?`,
      description: pending
        ? 'They will not be able to sign in. You can restore them later from the Blocked / rejected tab.'
        : 'They are signed out and cannot sign in until you restore them. Their leads stay in the workspace.',
      confirmLabel: pending ? 'Reject request' : 'Block access',
    })
    if (ok) await setApproval(user, 'revoked', pending ? 'rejected' : 'access blocked')
  }

  async function addCredits(user: StaffUser) {
    const amount = parseCreditAmount(amounts[user.id])
    if (amount == null) {
      setError('Enter a positive whole number of credits')
      return
    }
    setBusy(user.id)
    setError(null)
    try {
      await apiJson(`/api/permissions/users/${user.id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      })
      setAmounts((current) => ({ ...current, [user.id]: '' }))
      await reload()
      toast.show({ tone: 'success', message: `${amount} credit${amount === 1 ? '' : 's'} added to ${user.email}.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credits')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 p-4 pb-24 sm:p-6">
      <PageHeader
        title="Permissions"
        subtitle="Approve staff sign-ups and allocate lead credits."
        actions={<StatusBadge label="Admin only" tone="neutral" icon={<Lock />} />}
      />

      {error && (
        <Banner tone="danger" title="That did not work" action={<button type="button" onClick={() => setError(null)}>Dismiss</button>}>
          {error}
        </Banner>
      )}

      <section aria-label="Staff accounts" className="overflow-hidden rounded-[10px] border border-shop-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-shop-border px-3.5">
          <div role="tablist" aria-label="Account status" className="flex">
            {STAFF_TABS.map((item) => {
              const on = item.id === activeTab
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(item.id)}
                  className={`flex h-11 items-center gap-2 border-b-2 px-3.5 text-sm font-semibold whitespace-nowrap max-sm:h-12 ${
                    on ? 'border-shop-accent text-shop-ink' : 'border-transparent text-slate-600 hover:text-shop-ink'
                  }`}
                >
                  {item.label}
                  <StatusBadge
                    label={String(counts[item.id])}
                    tone={item.id === 'pending' && counts.pending > 0 ? 'warning' : 'neutral'}
                    className="tabular-nums"
                  />
                </button>
              )
            })}
          </div>
          <div className="relative w-[260px] max-w-full py-2">
            <label htmlFor="staff-search" className="sr-only">Search staff</label>
            <Search className="pointer-events-none absolute top-[19px] left-2.5 size-4 text-shop-muted" aria-hidden="true" />
            <input
              id="staff-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
              className="h-9 w-full rounded-lg border border-line-strong bg-white pr-2.5 pl-8 text-sm max-sm:h-11"
            />
          </div>
        </div>

        {loading && <TableSkeleton rows={4} label="Loading accounts" />}

        {!loading && rows.length === 0 && (
          <EmptyState
            tone={error ? 'danger' : query.trim() ? 'neutral' : 'default'}
            icon={error ? <CircleAlert /> : query.trim() ? <Search /> : undefined}
            title={query.trim() ? `No account matches “${query.trim()}”` : EMPTY_COPY[activeTab].title}
            description={query.trim() ? 'Try another name or email, or another tab.' : EMPTY_COPY[activeTab].description}
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-shop-border bg-shop-bg text-xs font-semibold text-slate-600">
                  <th className="px-3.5 py-2.5">Staff member</th>
                  <th className="px-3 py-2.5">Requested</th>
                  <th className="px-3 py-2.5">Lead credits</th>
                  <th className="px-3 py-2.5">Add credits</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => {
                  const credits = creditSummary(user)
                  const working = busy === user.id
                  return (
                    <tr key={user.id} className="border-b border-neutral-bg align-middle last:border-0">
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="grid size-[34px] shrink-0 place-items-center rounded-full bg-neutral-bg text-xs font-bold text-neutral-fg"
                          >
                            {initialsFromName(nameFromEmail(user.email))}
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <strong className="truncate">{nameFromEmail(user.email)}</strong>
                            <span className="truncate text-xs text-shop-muted">{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-shop-muted tabular-nums">
                        {new Date(user.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex w-40 flex-col gap-1">
                          <span className="tabular-nums">
                            <strong>{credits.remaining}</strong> left
                            <span className="text-shop-muted"> · {credits.used} of {credits.total} used</span>
                          </span>
                          <div
                            className="h-1.5 overflow-hidden rounded-full bg-neutral-bg"
                            role="progressbar"
                            aria-label={`Credits used by ${user.email}`}
                            aria-valuemin={0}
                            aria-valuemax={Math.max(1, credits.total)}
                            aria-valuenow={credits.used}
                          >
                            <div className="h-full rounded-full bg-shop-accent" style={{ width: `${credits.pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {user.approval_status === 'approved' ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              aria-label={`Credits to add for ${user.email}`}
                              type="number"
                              min="1"
                              step="1"
                              placeholder="Amount"
                              value={amounts[user.id] || ''}
                              onChange={(event) => setAmounts((current) => ({ ...current, [user.id]: event.target.value }))}
                              className="h-8 w-24 rounded-lg border border-line-strong px-2 text-sm tabular-nums max-sm:h-10"
                            />
                            <Button size="sm" disabled={working || !amounts[user.id]} onClick={() => void addCredits(user)}>
                              Add
                            </Button>
                          </div>
                        ) : (
                          <span className="text-shop-muted">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {user.approval_status === 'pending' && (
                            <>
                              <Button size="sm" variant="ghost" disabled={working} className="text-danger" onClick={() => void revoke(user)}>
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                loading={working}
                                icon={<Check />}
                                className="border-shop-accent text-shop-accent"
                                onClick={() => void setApproval(user, 'approved', 'access approved')}
                              >
                                Approve
                              </Button>
                            </>
                          )}
                          {user.approval_status === 'approved' && (
                            <>
                              <StatusBadge label="Active" tone="success" />
                              <Button size="sm" variant="ghost" disabled={working} onClick={() => void revoke(user)}>
                                Block
                              </Button>
                            </>
                          )}
                          {user.approval_status === 'revoked' && (
                            <>
                              <StatusBadge label="Blocked" tone="danger" />
                              <Button size="sm" loading={working} onClick={() => void setApproval(user, 'approved', 'access restored')}>
                                Restore
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialog}
    </div>
  )
}
