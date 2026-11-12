import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, Users } from 'lucide-react'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/ui/PageHeader'
import { currentLanguage, locale, t as translate, useI18n } from '../lib/i18n'
import { fetchPastCustomers, offerTemplate, sendPastCustomerOffer, type PastCustomer } from '../lib/growth'
import { formatPhone } from '../lib/leads'

const FIELD = 'h-10 rounded-lg border border-shop-border bg-white px-3 text-sm'

function Row({ customer, onSent }: { customer: PastCustomer; onSent: () => void }) {
  useI18n()
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const recent = customer.last_offer_at && now - new Date(customer.last_offer_at).getTime() < 7 * 86_400_000

  const open = () => {
    setText(offerTemplate(customer, `${window.location.origin}/offers`, currentLanguage() === 'en' ? 'en' : 'ar'))
    setWriting(true)
  }
  const send = async () => {
    setSending(true)
    setError(null)
    try {
      await sendPastCustomerOffer({ phone: customer.phone, text })
      setWriting(false)
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {customer.contact_id ? <Link to={`/contacts/${customer.contact_id}`} className="hover:underline">{customer.name || formatPhone(customer.phone)}</Link> : (customer.name || formatPhone(customer.phone))}
          </p>
          <p className="text-xs text-shop-muted tabular-nums">
            {[
              formatPhone(customer.phone),
              translate('{value0} trip(s)', { value0: customer.trips }),
              customer.last_destination && translate('Last: {value0}', { value0: customer.last_destination }),
              customer.last_travel_date && new Date(customer.last_travel_date).toLocaleDateString(locale(), { month: 'short', year: 'numeric' }),
              customer.last_offer_at && translate('Offer sent {value0}', { value0: new Date(customer.last_offer_at).toLocaleDateString(locale()) }),
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {!writing && (
          <Button size="sm" icon={<Send />} disabled={Boolean(recent)} onClick={open}>
            {recent ? translate('Sent this week') : translate('Write an offer')}
          </Button>
        )}
      </div>
      {writing && (
        <div className="mt-2 grid gap-2">
          <textarea rows={4} dir="auto" aria-label={translate('Message')} value={text} onChange={(e) => setText(e.target.value)} className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
          {error && <p role="alert" className="text-xs text-danger-fg">{translate(error)}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={sending} disabled={!text.trim()} onClick={() => void send()}>{translate('Send on WhatsApp')}</Button>
            <Button size="sm" onClick={() => setWriting(false)}>{translate('Cancel')}</Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Customers who travelled before, by season or destination, to send this year's offers. */
export default function PastCustomersPage() {
  useI18n()
  const [month, setMonth] = useState<number | ''>(() => ((new Date().getMonth() + 2) % 12) || 12)
  const [destination, setDestination] = useState('')
  const [customers, setCustomers] = useState<PastCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => fetchPastCustomers({ month, destination: destination.trim() })
    .then((rows) => { setCustomers(rows); setError(null) })
    .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
    .finally(() => setLoading(false)), [month, destination])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 300)
    return () => window.clearTimeout(timer)
  }, [load])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 pb-24 sm:p-6">
      <PageHeader
        title="Past customers"
        subtitle={translate('Customers who travelled with you before. Pick a season or destination and send this year\'s offers, one by one.')}
        actions={<a href="/offers" target="_blank" rel="noreferrer" className="text-sm font-semibold text-shop-accent hover:underline">{translate('Open offers page')}</a>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label={translate('Travelled in')} className={FIELD} value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}>
          <option value="">{translate('Any month')}</option>
          {months.map((m) => (
            <option key={m} value={m}>{new Date(2026, m - 1, 15).toLocaleDateString(locale(), { month: 'long' })}</option>
          ))}
        </select>
        <input aria-label={translate('Destination')} placeholder={translate('Destination')} className={FIELD} value={destination} onChange={(e) => setDestination(e.target.value)} />
        <span className="text-xs text-shop-muted">{translate('{value0} customers', { value0: customers.length })}</span>
      </div>
      <p className="mb-3 text-xs text-shop-muted">{translate('Customers with a request open in the last 60 days are left out. Each customer gets at most one offer a week.')}</p>
      {error && <p role="alert" className="mb-3 text-sm text-danger-fg">{translate(error)}</p>}
      {loading ? (
        <p className="text-sm text-shop-muted">{translate('Loading…')}</p>
      ) : customers.length === 0 ? (
        <section className="rounded-[10px] border border-shop-border bg-white">
          <EmptyState icon={<Users />} title={translate('Nobody matches')} description={translate('Try another month or destination.')} />
        </section>
      ) : (
        <ul className="divide-y divide-shop-border rounded-[10px] border border-shop-border bg-white">
          {customers.map((c) => <Row key={c.phone} customer={c} onSent={() => void load()} />)}
        </ul>
      )}
    </div>
  )
}
