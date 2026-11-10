import { t as translate, useI18n } from '../lib/i18n'
import { useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import ModalDrawer from './ui/ModalDrawer'
import Button from './ui/Button'
import { SERVICE_OPTIONS, type DealerStats } from '../lib/dealerView'
import {
  createDealer,
  updateDealer,
  type Dealer,
  type DealerCountryCode,
  type DealerInput,
} from '../lib/dealers'
import { formatPhone } from '../lib/leads'
import {
  composeInternationalPhone,
  COUNTRY_DIALS,
  DEFAULT_DIAL,
  splitInternationalPhone,
} from '../lib/phone'

type Props = {
  open: boolean
  dealer?: Dealer | null
  countryCodes?: DealerCountryCode[]
  /** How this dealer has performed across leads (edit only). */
  stats?: DealerStats | null
  onClose: () => void
  onSaved: (dealer: Dealer) => void
}

export default function DealerModal({ open, dealer, countryCodes = [], stats = null, onClose, onSaved }: Props) {
  useI18n()
  const dialOptions = countryCodes.length
    ? countryCodes.map((country) => ({
        iso: country.iso_code || '',
        name: country.name,
        dial: country.dial_code,
      }))
    : COUNTRY_DIALS
  const sessionKey = open ? (dealer?.id ?? 'new') : null
  const initialPhone = dealer?.phone
    ? splitInternationalPhone(dealer.phone, DEFAULT_DIAL, dialOptions)
    : null
  const [formKey, setFormKey] = useState(sessionKey)
  const [name, setName] = useState(dealer?.name || '')
  const [dial, setDial] = useState(initialPhone?.dial || DEFAULT_DIAL)
  const [local, setLocal] = useState(initialPhone?.local || '')
  const [company, setCompany] = useState(dealer?.company || '')
  const [notes, setNotes] = useState(dealer?.notes || '')
  const [groupId, setGroupId] = useState(dealer?.whatsapp_group_id || '')
  const [destinations, setDestinations] = useState<string[]>(dealer?.destinations ?? [])
  const [services, setServices] = useState<string[]>(dealer?.services ?? [])
  const [newPlace, setNewPlace] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sessionKey !== formKey) {
    setFormKey(sessionKey)
    setError(null)
    setName(dealer?.name || '')
    setCompany(dealer?.company || '')
    setNotes(dealer?.notes || '')
    setGroupId(dealer?.whatsapp_group_id || '')
    setDestinations(dealer?.destinations ?? [])
    setServices(dealer?.services ?? [])
    setNewPlace('')
    if (dealer?.phone) {
      const parts = splitInternationalPhone(dealer.phone, DEFAULT_DIAL, dialOptions)
      setDial(parts.dial)
      setLocal(parts.local)
    } else {
      setDial(DEFAULT_DIAL)
      setLocal('')
    }
  }

  const preview = useMemo(() => {
    const combined = composeInternationalPhone(dial, local)
    return combined ? formatPhone(combined) : ''
  }, [dial, local])

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const phone = composeInternationalPhone(dial, local)
    if (!local.trim()) {
      setError('Enter the WhatsApp number')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: DealerInput = { name, phone, company, notes, whatsapp_group_id: groupId, destinations, services }
      const saved = dealer
        ? await updateDealer(dealer.id, payload)
        : await createDealer(payload)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dealer')
    } finally {
      setSaving(false)
    }
  }

  const addPlace = () => {
    const place = newPlace.trim()
    if (!place) return
    setDestinations((current) =>
      current.some((x) => x.toLowerCase() === place.toLowerCase()) ? current : [...current, place],
    )
    setNewPlace('')
  }

  const toggleService = (id: string) =>
    setServices((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  const FIELD = 'h-9 w-full rounded-lg border border-line-strong bg-white px-2.5 text-sm max-sm:h-11'
  const LABEL = 'text-xs font-semibold text-slate-600'

  return (
    <ModalDrawer
      open
      variant="side"
      title={dealer ? translate("Edit dealer") : translate("Add dealer")}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{translate("Cancel")}</Button>
          <Button variant="primary" type="submit" form="dealer-form" loading={saving}>
            {dealer ? translate("Save changes") : translate("Add dealer")}
          </Button>
        </div>
      }
    >
      <form id="dealer-form" onSubmit={submit} className="grid gap-3.5">
        <label className="grid gap-1">
          <span className={LABEL}>
            {translate("Name")}{' '}<span className="text-danger">*</span>
          </span>
          <input required className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="grid gap-1">
          <span className={LABEL}>
            WhatsApp <span className="text-danger">*</span>
          </span>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="dealer-country-code">{translate("Country code")}</label>
            <select
              id="dealer-country-code"
              className={`${FIELD.replace('w-full', 'w-[9.5rem]')} shrink-0`}
              value={dial}
              onChange={(e) => setDial(e.target.value)}
            >
              {dialOptions.map((country) => (
                <option key={`${country.iso}-${country.dial}`} value={country.dial}>
                  +{country.dial} {country.name}
                </option>
              ))}
            </select>
            <input
              required
              aria-label={translate("Number")}
              inputMode="tel"
              className={`${FIELD.replace('w-full', 'w-0')} min-w-0 flex-1 tabular-nums`}
              placeholder="50 123 4567"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
            />
          </div>
          <span className="text-xs text-shop-muted">
            {preview ? translate("Saves as {value0}", { value0: translate(String(preview)) }) : translate("Choose a country code, then enter the local number.")}
          </span>
        </div>

        <label className="grid gap-1">
          <span className={LABEL}>{translate("Company")}</span>
          <input className={FIELD} placeholder={translate("Optional")} value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>

        <label className="grid gap-1">
          <span className={LABEL}>{translate("WhatsApp group ID")}</span>
          <input
            className={`${FIELD} font-mono`}
            placeholder={translate("120363xxxxxxxxxx@g.us (optional)")}
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          />
          <span className="text-xs text-shop-muted">
            {translate("RFQs can go to this group instead of a direct message. Paste the group ID (ends in @g.us).")}</span>
        </label>

        <div className="grid gap-1.5">
          <span className={LABEL}>{translate("Destinations")}</span>
          <div className="flex flex-wrap gap-1.5">
            {destinations.map((place) => (
              <span
                key={place}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-bg pe-1 ps-2 text-xs font-semibold text-neutral-fg"
              >
                {place}
                <button
                  type="button"
                  aria-label={translate("Remove {value0}", { value0: translate(String(place)) })}
                  onClick={() => setDestinations((current) => current.filter((x) => x !== place))}
                  className="grid size-5 place-items-center rounded hover:bg-line-strong"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              aria-label={translate("Add a destination")}
              className={FIELD}
              placeholder={translate("Add a country or city")}
              value={newPlace}
              onChange={(e) => setNewPlace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addPlace()
                }
              }}
            />
            <Button type="button" onClick={addPlace} disabled={!newPlace.trim()}>
              {translate("Add")}</Button>
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className={`${LABEL} mb-1.5`}>{translate("Services")}</legend>
          {SERVICE_OPTIONS.map((option) => (
            <label key={option.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={services.includes(option.id)}
                onChange={() => toggleService(option.id)}
                className="size-4 accent-shop-accent"
              />
              {translate(option.label)}
            </label>
          ))}
        </fieldset>

        <label className="grid gap-1">
          <span className={LABEL}>{translate("Internal notes")}</span>
          <textarea
            rows={3}
            className="resize-y rounded-lg border border-line-strong px-2.5 py-2 text-sm"
            placeholder={translate("Optional")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {dealer && stats && (
          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-shop-bg p-3 text-center tabular-nums">
            <div>
              <dd className="text-lg font-extrabold">{stats.rfqs}</dd>
              <dt className="text-xs text-shop-muted">RFQs</dt>
            </div>
            <div>
              <dd className="text-lg font-extrabold">{stats.replyRate == null ? '—' : `${stats.replyRate}%`}</dd>
              <dt className="text-xs text-shop-muted">{translate("Replied")}</dt>
            </div>
            <div>
              <dd className="text-lg font-extrabold">{stats.replied}</dd>
              <dt className="text-xs text-shop-muted">{translate("Replies")}</dt>
            </div>
          </dl>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            {translate(error)}
          </div>
        )}
      </form>
    </ModalDrawer>
  )
}
