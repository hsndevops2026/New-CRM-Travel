import { useState, type FormEvent } from 'react'
import { createLead, type Lead, type LeadInput } from '../lib/leads'
import Button from './ui/Button'
import Field from './ui/Field'
import ModalDrawer from './ui/ModalDrawer'
import PlaceAutocomplete from './ui/PlaceAutocomplete'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (lead: Lead) => void
  /** Pre-fills the WhatsApp number (e.g. "Create lead" from a contact). */
  initialPhone?: string
}

const emptyForm: LeadInput = {
  phone: '',
  booking_type: 'hotel',
  origin: '',
  destination: '',
  travel_date: '',
  return_date: '',
  adults_count: 2,
  children_count: 0,
  children_ages: '',
  hotel_name: '',
  notes: '',
  status: 'new',
}

const TYPES: Array<{ id: LeadInput['booking_type']; label: string }> = [
  { id: 'hotel', label: 'Hotel' },
  { id: 'flight', label: 'Flight' },
  { id: 'package', label: 'Package' },
]

const inputClass = 'min-h-11 rounded-lg border border-shop-border px-3 py-2'

export default function AddLeadModal({ open, onClose, onCreated, initialPhone }: Props) {
  const [form, setForm] = useState<LeadInput>({ ...emptyForm, phone: initialPhone ?? '' })
  // Opening for a different number starts the form over with that number in it.
  const [seededPhone, setSeededPhone] = useState(initialPhone ?? '')
  if ((initialPhone ?? '') !== seededPhone) {
    setSeededPhone(initialPhone ?? '')
    setForm({ ...emptyForm, phone: initialPhone ?? '' })
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof LeadInput, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: LeadInput = {
        ...form,
        children_ages:
          typeof form.children_ages === 'string' ? form.children_ages : form.children_ages,
        source: 'crm',
      }
      const lead = await createLead(payload)
      onCreated(lead)
      setForm({ ...emptyForm, phone: initialPhone ?? '' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lead')
    } finally {
      setSaving(false)
    }
  }

  const showOrigin = form.booking_type === 'flight' || form.booking_type === 'package'

  return (
    <ModalDrawer
      open={open}
      title="Add lead"
      subtitle="Contact, trip, then any notes."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-lead-form" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save lead'}
          </Button>
        </div>
      }
    >
      <form id="add-lead-form" onSubmit={submit} className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-shop-muted">Contact</h3>
          <Field label="Phone">
            <input
              required
              className={inputClass}
              placeholder="9198xxxxxxx"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-shop-muted">Trip</h3>
          <div>
            <span className="mb-1 block text-sm font-medium">Booking type</span>
            <div className="flex flex-wrap gap-1">
              {TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => set('booking_type', type.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    form.booking_type === type.id
                      ? 'bg-shop-accent text-white'
                      : 'bg-shop-bg text-shop-muted ring-1 ring-shop-border'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {showOrigin && (
              <Field label="Origin" hint="Airport code or city">
                <PlaceAutocomplete
                  mode="airport"
                  required
                  className={`${inputClass} w-full`}
                  placeholder="DXB or Dubai"
                  value={form.origin || ''}
                  onChange={(value) => set('origin', value)}
                />
              </Field>
            )}
            <Field label="Destination">
              <PlaceAutocomplete
                mode={form.booking_type === 'flight' ? 'airport' : 'hotel'}
                required
                className={`${inputClass} w-full`}
                value={form.destination}
                onChange={(value) => set('destination', value)}
              />
            </Field>
            <Field label={form.booking_type === 'flight' ? 'Departure date' : 'Check-in'}>
              <input
                required
                type="date"
                className={inputClass}
                value={form.travel_date}
                onChange={(e) => set('travel_date', e.target.value)}
              />
            </Field>
            <Field label={form.booking_type === 'flight' ? 'Return date' : 'Check-out'}>
              <input
                required
                type="date"
                className={inputClass}
                value={form.return_date}
                onChange={(e) => set('return_date', e.target.value)}
              />
            </Field>
            <Field label="Adults">
              <input
                required
                type="number"
                min={1}
                className={inputClass}
                value={form.adults_count}
                onChange={(e) => set('adults_count', Number(e.target.value))}
              />
            </Field>
            <Field label="Children">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.children_count}
                onChange={(e) => set('children_count', Number(e.target.value))}
              />
            </Field>
            {Number(form.children_count) > 0 && (
              <Field label="Children ages (comma separated)" className="sm:col-span-2">
                <input
                  className={inputClass}
                  placeholder="5, 8"
                  value={typeof form.children_ages === 'string' ? form.children_ages : ''}
                  onChange={(e) => set('children_ages', e.target.value)}
                />
              </Field>
            )}
            {form.booking_type === 'hotel' && (
              <Field label="Hotel name (optional)" className="sm:col-span-2">
                <PlaceAutocomplete
                  mode="hotel"
                  className={`${inputClass} w-full`}
                  value={form.hotel_name || ''}
                  onChange={(value) => set('hotel_name', value)}
                />
              </Field>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-shop-muted">Notes</h3>
          <Field label="Notes (optional)">
            <textarea
              className="min-h-24 rounded-lg border border-shop-border px-3 py-2"
              value={form.notes || ''}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </section>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>
    </ModalDrawer>
  )
}
