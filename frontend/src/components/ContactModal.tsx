import { t as translate, useI18n } from '../lib/i18n'
import { useMemo, useState, type FormEvent } from 'react'
import Button from './ui/Button'
import ModalDrawer from './ui/ModalDrawer'
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
  useI18n()
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

  const FIELD = 'min-h-11 rounded-lg border border-shop-border px-3 py-2'

  return (
    <ModalDrawer
      open
      title={contact ? translate("Edit contact") : translate("Add contact")}
      onClose={onClose}
      maxWidthClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{translate("Cancel")}</Button>
          <Button variant="primary" type="submit" form="contact-form" loading={saving}>
            {translate("Save")}
          </Button>
        </div>
      }
    >
      <form id="contact-form" onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{translate("Customer name")}</span>
          <input
            required
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="grid gap-1 text-sm">
          <span className="font-medium">{translate("WhatsApp number")}</span>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="contact-country-code">
              {translate("Country code")}
            </label>
            <select
              id="contact-country-code"
              className={`${FIELD} w-[8.5rem] shrink-0 bg-white`}
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
              className={`${FIELD} min-w-0 flex-1`}
              placeholder="50 123 4567"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
            />
          </div>
          <span className="text-xs text-shop-muted">
            {preview ? translate("Saves as {value0}", { value0: translate(String(preview)) }) : translate("Choose a country code, then enter the local number.")}
          </span>
        </div>
        {error && <div className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">{translate(error)}</div>}
      </form>
    </ModalDrawer>
  )
}
