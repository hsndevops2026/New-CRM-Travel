import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Plus, UsersRound } from 'lucide-react'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { locale, t as translate, useI18n } from '../lib/i18n'
import { formatPhone } from '../lib/leads'
import {
  VISA_STATUS_LABEL,
  createGroupTrip,
  downloadRoomingList,
  fetchGroupTrip,
  fetchGroupTrips,
  seatsPercent,
  setBookingRoom,
  updateGroupTrip,
  type GroupTrip,
} from '../lib/groupsVisas'

const FIELD = 'h-10 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm'
const fmtDay = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function Seats({ group }: { group: GroupTrip }) {
  const pct = seatsPercent(group)
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-bg" role="progressbar" aria-valuenow={group.seats_used} aria-valuemin={0} aria-valuemax={group.seats_total} aria-label={translate('Seats')}>
        <div className={`h-full ${pct >= 100 ? 'bg-danger-fg' : 'bg-primary-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-shop-muted tabular-nums">
        {translate('{value0} of {value1} seats taken', { value0: group.seats_used, value1: group.seats_total })}
      </p>
    </div>
  )
}

function NewGroupForm({ onCreated, onCancel }: { onCreated: (g: GroupTrip) => void; onCancel: () => void }) {
  const [f, setF] = useState({ title: '', destination: '', travel_date: '', return_date: '', seats_total: '40', price_per_person: '', currency: 'USD' })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      onCreated(await createGroupTrip({ ...f, seats_total: Number(f.seats_total), price_per_person: f.price_per_person || null } as never))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }
  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-[10px] border border-shop-border bg-white p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold text-shop-muted sm:col-span-2">{translate('Name')}<input required className={FIELD} dir="auto" placeholder={translate('e.g. Umrah, December')} value={f.title} onChange={set('title')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Destination')}<input className={FIELD} value={f.destination} onChange={set('destination')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Seats')}<input type="number" min={0} className={FIELD} value={f.seats_total} onChange={set('seats_total')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Departure')}<input type="date" className={FIELD} value={f.travel_date} onChange={set('travel_date')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Return')}<input type="date" className={FIELD} value={f.return_date} onChange={set('return_date')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Price per person')}<input type="number" min={0} className={FIELD} value={f.price_per_person} onChange={set('price_per_person')} /></label>
      <label className="grid gap-1 text-xs font-semibold text-shop-muted">{translate('Currency')}<input className={FIELD} maxLength={3} value={f.currency} onChange={set('currency')} /></label>
      {error && <p role="alert" className="text-sm text-danger-fg sm:col-span-2">{translate(error)}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="primary">{translate('Create group')}</Button>
        <Button type="button" size="sm" onClick={onCancel}>{translate('Cancel')}</Button>
      </div>
    </form>
  )
}

function GroupDetail({ id }: { id: string }) {
  useI18n()
  const { admin } = useAuth()
  const [group, setGroup] = useState<GroupTrip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => fetchGroupTrip(id).then(setGroup).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load')), [id])
  useEffect(() => { void load() }, [load])
  if (error) return <p role="alert" className="p-6 text-sm text-danger-fg">{translate(error)}</p>
  if (!group) return <p className="p-6 text-sm text-shop-muted">{translate('Loading…')}</p>

  const room = (leadId: string) => group.bookings?.find((b) => b.id === leadId)
  return (
    <div className="mx-auto w-full max-w-[1000px] p-4 pb-24 sm:p-6">
      <Link to="/groups" className="text-sm font-semibold text-shop-accent hover:underline">{translate('All group trips')}</Link>
      <PageHeader
        title={group.title}
        subtitle={[group.destination, [fmtDay(group.travel_date), fmtDay(group.return_date)].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Download />} onClick={() => void downloadRoomingList(group.id, group.title).catch(() => {})}>{translate('Rooming list (Excel)')}</Button>
            {admin?.role === 'admin' && group.status === 'open' && (
              <Button size="sm" onClick={() => void updateGroupTrip(group.id, { status: 'closed' }).then(load)}>{translate('Close bookings')}</Button>
            )}
          </div>
        }
      />
      <div className="mb-4 rounded-[10px] border border-shop-border bg-white p-4"><Seats group={group} /></div>
      <section className="mb-4 overflow-hidden rounded-[10px] border border-shop-border bg-white">
        <h2 className="border-b border-shop-border px-4 py-2 text-sm font-bold">{translate('Bookings and rooms')}</h2>
        {!group.bookings?.length ? (
          <p className="p-4 text-sm text-shop-muted">{translate('No bookings yet. Open a lead and choose this group in its trip step.')}</p>
        ) : (
          <ul className="divide-y divide-shop-border">
            {group.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Link to={`/leads/${b.id}`} className="min-w-0 flex-1 font-semibold hover:underline">{b.customer || formatPhone(b.phone)}</Link>
                <span className="text-xs text-shop-muted tabular-nums">{translate('{value0} seat(s)', { value0: (b.adults_count || 0) + (b.children_count || 0) })}</span>
                <input
                  aria-label={translate('Room for {value0}', { value0: b.customer || b.phone })}
                  placeholder={translate('Room')}
                  defaultValue={b.group_room || ''}
                  className="h-9 w-32 rounded-lg border border-line-strong px-2 text-sm"
                  onBlur={(e) => { if (e.target.value !== (b.group_room || '')) void setBookingRoom(group.id, b.id, e.target.value) }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="overflow-x-auto rounded-[10px] border border-shop-border bg-white">
        <h2 className="border-b border-shop-border px-4 py-2 text-sm font-bold">{translate('Passengers ({value0})', { value0: group.travellers?.length || 0 })}</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-shop-muted">
            <tr className="text-start">
              {['Room', 'Full name', 'Date of birth', 'Passport', 'Passport expiry', 'Visa'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{translate(h)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-bg">
            {(group.travellers || []).map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-1.5">{room(t.lead_id)?.group_room || room(t.lead_id)?.customer || ''}</td>
                <td className="px-3 py-1.5 font-semibold" dir="ltr">{t.full_name}{t.is_child ? ` (${translate('Child')})` : ''}</td>
                <td className="px-3 py-1.5 tabular-nums">{t.date_of_birth || ''}</td>
                <td className="px-3 py-1.5 tabular-nums" dir="ltr">{t.passport_number || ''}</td>
                <td className="px-3 py-1.5 tabular-nums">{t.passport_expiry || ''}</td>
                <td className="px-3 py-1.5">{translate(VISA_STATUS_LABEL[t.visa_status] || '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

/** Group trips: seats, bookings, passengers and the rooming list. */
export default function GroupTripsPage() {
  useI18n()
  const { id } = useParams()
  const { admin } = useAuth()
  const [groups, setGroups] = useState<GroupTrip[]>([])
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) return
    fetchGroupTrips(true).then(setGroups).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  if (id) return <GroupDetail id={id} />

  return (
    <div className="mx-auto w-full max-w-[1000px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="Group trips"
        subtitle={translate('Umrah, organised tours and school trips: seats, passengers and rooms in one place.')}
        actions={admin?.role === 'admin' && !adding && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>{translate('New group')}</Button>}
      />
      {adding && <NewGroupForm onCancel={() => setAdding(false)} onCreated={(g) => { setAdding(false); setGroups((list) => [g, ...list]) }} />}
      {loading ? <p className="text-sm text-shop-muted">{translate('Loading…')}</p> : groups.length === 0 ? (
        <section className="rounded-[10px] border border-shop-border bg-white">
          <EmptyState icon={<UsersRound />} title={translate('No group trips yet')} description={translate('Create one, then add bookings to it from each lead.')} />
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="block rounded-[10px] border border-shop-border bg-white p-4 hover:border-shop-accent">
                <p className="flex items-center justify-between gap-2 font-bold">
                  <span dir="auto">{g.title}</span>
                  {g.status !== 'open' && <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-[11px] text-neutral-fg">{translate(g.status === 'closed' ? 'Closed' : 'Cancelled')}</span>}
                </p>
                <p className="mb-2 text-xs text-shop-muted">{[g.destination, fmtDay(g.travel_date)].filter(Boolean).join(' · ')}</p>
                <Seats group={g} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
