import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { t as translate, useI18n } from '../lib/i18n'
import { fetchGroupTrips, setLeadGroup, type GroupTrip } from '../lib/groupsVisas'

/** Put this booking in an open group trip (or take it out). */
export default function GroupSelect({ leadId, groupId }: { leadId: string; groupId: string | null }) {
  useI18n()
  const [groups, setGroups] = useState<GroupTrip[]>([])
  const [value, setValue] = useState(groupId || '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGroupTrips().then((g) => { if (!cancelled) setGroups(g) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!groups.length && !groupId) return null

  const change = async (next: string) => {
    const before = value
    setValue(next)
    setError(null)
    try {
      await setLeadGroup(leadId, next || null)
    } catch (err) {
      setValue(before)
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-shop-border bg-white p-3 text-sm">
      <label htmlFor="group-select" className="font-semibold">{translate('Group trip')}</label>
      <select id="group-select" className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm" value={value} onChange={(e) => void change(e.target.value)}>
        <option value="">{translate('Not in a group')}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title} ({translate('{value0} seats left', { value0: Math.max(0, g.seats_total - g.seats_used) })})
          </option>
        ))}
      </select>
      {value && <Link to={`/groups/${value}`} className="text-xs font-semibold text-shop-accent hover:underline">{translate('Open group')}</Link>}
      {error && <span role="alert" className="text-xs text-danger-fg">{translate(error)}</span>}
    </div>
  )
}
