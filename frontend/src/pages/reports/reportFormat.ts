import { locale, t as translate } from '../../lib/i18n'

export const STAGE_LABEL: Record<string, string> = {
  new: 'New leads',
  sent: 'Quote sent',
  accepted: 'Accepted',
  booked: 'Booked',
}

export const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  web: 'Website',
  manual: 'Manual',
  import: 'Import',
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtMinutes(min: number | null) {
  if (min == null) return '—'
  if (min < 60) return translate('{value0} min', { value0: Math.round(min) })
  const h = min / 60
  if (h < 48) return translate('{value0} h', { value0: Math.round(h * 10) / 10 })
  return translate('{value0} days', { value0: Math.round((h / 24) * 10) / 10 })
}

export function money(total: number | null, currency: string) {
  if (total == null) return '—'
  return `${total.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${currency}`
}

export function stampDay() {
  return new Date().toISOString().slice(0, 10)
}
