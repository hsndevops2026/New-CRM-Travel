import { t as translate, useI18n } from '../lib/i18n'
import { useState, type FormEvent } from 'react'
import {
  createDealerCountryCode,
  deleteDealerCountryCode,
  updateDealerCountryCode,
  type DealerCountryCode,
} from '../lib/dealers'
import Button from './ui/Button'
import ModalDrawer from './ui/ModalDrawer'
import { useConfirm } from '../hooks/useConfirm'

type Props = {
  open: boolean
  countryCodes: DealerCountryCode[]
  onClose: () => void
  onChanged: () => Promise<void>
}

const emptyForm = { name: '', iso_code: '', dial_code: '' }

export default function CountryCodesModal({ open, countryCodes, onClose, onChanged }: Props) {
  useI18n()
  const { confirm, dialog } = useConfirm()
  const [editing, setEditing] = useState<DealerCountryCode | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editing) await updateDealerCountryCode(editing.id, form)
      else await createDealerCountryCode(form)
      await onChanged()
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save country code')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (country: DealerCountryCode) => {
    setEditing(country)
    setForm({
      name: country.name,
      iso_code: country.iso_code || '',
      dial_code: country.dial_code,
    })
    setError(null)
  }

  const remove = async (country: DealerCountryCode) => {
    const ok = await confirm({
      title: translate("Delete +{value0} {value1}?", { value0: translate(String(country.dial_code)), value1: translate(String(country.name)) }),
      description: 'It will no longer be offered when adding or editing a dealer. Existing dealers keep their numbers.',
      confirmLabel: 'Delete code',
    })
    if (!ok) return
    setError(null)
    try {
      await deleteDealerCountryCode(country.id)
      await onChanged()
      if (editing?.id === country.id) reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete country code')
    }
  }

  return (
    <>
      <ModalDrawer
        open={open}
        title={translate("Manage country codes")}
        subtitle="Codes are available when adding or editing a dealer."
        onClose={() => { reset(); onClose() }}
        maxWidthClassName="max-w-xl"
      >
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-shop-border bg-shop-bg p-3 sm:grid-cols-[1fr_6rem_7rem_auto] sm:items-end">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{translate("Country name")}</span>
            <input
              required
              className="min-h-10 rounded-lg border border-shop-border bg-white px-3 py-2"
              placeholder={translate("India")}
              value={form.name}
              onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">ISO</span>
            <input
              maxLength={2}
              className="min-h-10 rounded-lg border border-shop-border bg-white px-3 py-2 uppercase"
              placeholder="IN"
              value={form.iso_code}
              onChange={(event) => setForm((value) => ({ ...value, iso_code: event.target.value.toUpperCase() }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{translate("Calling code")}</span>
            <input
              required
              inputMode="numeric"
              className="min-h-10 rounded-lg border border-shop-border bg-white px-3 py-2"
              placeholder="+91"
              value={form.dial_code}
              onChange={(event) => setForm((value) => ({ ...value, dial_code: event.target.value }))}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? translate("Saving…") : editing ? translate('Update') : translate("Add")}
            </Button>
            {editing && <Button type="button" onClick={reset}>{translate("Cancel")}</Button>}
          </div>
        </form>

        {error && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{translate(error)}</div>}

        <div className="mt-4 divide-y divide-shop-border overflow-hidden rounded-xl border border-shop-border">
          {countryCodes.map((country) => (
            <div key={country.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium">+{country.dial_code} {country.name}</div>
                {country.iso_code && <div className="text-xs text-shop-muted">{country.iso_code}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" onClick={() => startEdit(country)}>{translate("Edit")}</Button>
                <Button type="button" size="sm" variant="danger" onClick={() => void remove(country)}>{translate("Delete")}</Button>
              </div>
            </div>
          ))}
          {countryCodes.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-shop-muted">{translate("No country codes configured.")}</p>
          )}
        </div>
      </ModalDrawer>
      {dialog}
    </>
  )
}
