import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plane } from 'lucide-react'
import { locale, t as translate, useI18n } from '../lib/i18n'
import { fetchTravelHistory, type TravelHistory } from '../lib/growth'

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

/** Where this customer travelled with us and what they spent. */
export default function TravelHistoryPanel({ contactId }: { contactId: string }) {
  useI18n()
  const [data, setData] = useState<TravelHistory | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchTravelHistory(contactId).then((d) => { if (!cancelled) setData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [contactId])
  if (!data || data.trips.length === 0) return null
  return (
    <section aria-labelledby="hist-h" className="rounded-[10px] border border-shop-border bg-white p-4">
      <h2 id="hist-h" className="flex items-center gap-2 text-sm font-semibold">
        <Plane className="size-4" aria-hidden="true" />
        {translate('Travel history')}
        <span className="text-xs font-normal text-shop-muted">
          {translate('{value0} trip(s)', { value0: data.trips.length })}
          {data.totals.length ? ` · ${data.totals.map((t) => money(t.amount, t.currency)).join(' + ')}` : ''}
        </span>
      </h2>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {data.trips.map((trip) => (
          <li key={trip.id} className="flex flex-wrap justify-between gap-2">
            <Link to={`/leads/${trip.id}`} className="font-semibold hover:underline">{trip.destination || translate('Trip')}</Link>
            <span className="text-shop-muted tabular-nums">
              {[
                trip.travel_date && new Date(trip.travel_date).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }),
                trip.price != null && trip.currency && money(trip.price, trip.currency),
              ].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
