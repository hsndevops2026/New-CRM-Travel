import { useState, type FormEvent } from 'react'
import { formatPhone, type Lead } from '../lib/leads'

type Draft = { id: string; phone: string; destination: string; name: string; email: string }

export type BookLeadDraft = { id: string; name: string; email: string }

type Props = {
  open: boolean
  leads: Lead[]
  title?: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: (drafts: BookLeadDraft[]) => Promise<void>
}

function draftsFromLeads(leads: Lead[]): Draft[] {
  return leads.map((lead) => ({
    id: lead.id,
    phone: lead.phone,
    destination: lead.destination,
    name: lead.contact_name || '',
    email: lead.contact_email || '',
  }))
}

export default function BookLeadsModal({
  open,
  leads,
  title = 'Mark as booked',
  confirmLabel = 'Book & create portal login',
  onClose,
  onConfirm,
}: Props) {
  const sessionKey = open ? leads.map((lead) => lead.id).join(',') : ''
  const [formKey, setFormKey] = useState(sessionKey)
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFromLeads(leads))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (sessionKey !== formKey) {
    setFormKey(sessionKey)
    setError(null)
    setDrafts(draftsFromLeads(leads))
  }

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (drafts.some((draft) => !draft.name.trim())) {
      setError('Enter a customer name for every booked lead.')
      return
    }
    if (drafts.some((draft) => !draft.email.trim() || !draft.email.includes('@'))) {
      setError('Enter a valid customer email for every booked lead. We email them a portal password.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(
        drafts.map((draft) => ({
          id: draft.id,
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
        })),
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book leads')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-shop-border px-4 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-shop-muted hover:bg-shop-bg">
            ✕
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-4 py-5">
          <p className="text-sm text-shop-muted">
            Save the customer into Contacts and create their portal login. An auto-generated password is emailed to them.
          </p>
          {drafts.map((draft) => (
            <div key={draft.id} className="grid gap-2 rounded-lg border border-shop-border p-3">
              <span className="text-sm font-medium">
                {formatPhone(draft.phone)}
                <span className="ml-2 font-normal text-shop-muted">{draft.destination}</span>
              </span>
              <label className="grid gap-1 text-sm">
                <span className="text-shop-muted">Customer name</span>
                <input
                  required
                  className="min-h-11 rounded-lg border border-shop-border px-3 py-2"
                  placeholder="Customer name"
                  value={draft.name}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((item) => (item.id === draft.id ? { ...item, name: e.target.value } : item)),
                    )
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-shop-muted">Email (portal login)</span>
                <input
                  required
                  type="email"
                  className="min-h-11 rounded-lg border border-shop-border px-3 py-2"
                  placeholder="customer@email.com"
                  value={draft.email}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((item) => (item.id === draft.id ? { ...item, email: e.target.value } : item)),
                    )
                  }
                />
              </label>
            </div>
          ))}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-shop-border px-4 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-shop-border px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-shop-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
