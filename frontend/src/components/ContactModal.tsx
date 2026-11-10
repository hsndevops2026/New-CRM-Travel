import { useMemo, useState, type FormEvent } from 'react'
import { createContact, updateContact, type Contact } from '../lib/contacts'
import { formatPhone } from '../lib/leads'
import {
  composeInternationalPhone,
  COUNTRY_DIALS,
  DEFAULT_DIAL,
  splitInternationalPhone,
} from '../lib/phone'

type Props = {
  open: boolean
  contact?: Contact | null
  onClose: () => void
  onSaved: (contact: Contact) => void
}

export default function ContactModal({ open, contact, onClose, onSaved }: Props) {
  const sessionKey = open ? (contact?.id ?? 'new') : null
  const initialPhone = contact?.phone ? splitInternationalPhone(contact.phone) : null
  const [formKey, setFormKey] = useState(sessionKey)
  const [name, setName] = useState(contact?.name || '')
  const [dial, setDial] = useState(initialPhone?.dial || DEFAULT_DIAL)
  const [local, setLocal] = useState(initialPhone?.local || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (sessionKey !== formKey) {
    setFormKey(sessionKey)
    setError(null)
    setName(contact?.name || '')
    if (contact?.phone) {
      const parts = splitInternationalPhone(contact.phone)
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
      const payload = { name, phone }
      const saved = contact
        ? await updateContact(contact.id, payload)
        : await createContact(payload)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-shop-border px-4 py-4">
          <h2 className="text-lg font-semibold">{contact ? 'Edit contact' : 'Add contact'}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="grid gap-4 px-4 py-5">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Customer name</span>
            <input
              required
              className="min-h-11 rounded-lg border border-shop-border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="font-medium">WhatsApp number</span>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="contact-country-code">
                Country code
              </label>
              <select
                id="contact-country-code"
                className="min-h-11 w-[8.5rem] shrink-0 rounded-lg border border-shop-border bg-white px-2 py-2"
                value={dial}
                onChange={(e) => setDial(e.target.value)}
              >
                {COUNTRY_DIALS.map((country) => (
                  <option key={`${country.iso}-${country.dial}`} value={country.dial}>
                    {country.iso} +{country.dial}
                  </option>
                ))}
              </select>
              <input
                required
                inputMode="tel"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-shop-border px-3 py-2"
                placeholder="50 123 4567"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
              />
            </div>
            <span className="text-xs text-shop-muted">
              {preview ? `Saves as ${preview}` : 'Choose a country code, then enter the local number.'}
            </span>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-shop-border px-3 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-shop-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
