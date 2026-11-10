import type { AgencySettings } from './agencySettings'

/** WCAG relative luminance of a #rrggbb colour, or null when it isn't one. */
function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(match[1].slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast of white text on this colour (1–21), or null for an invalid colour. */
export function whiteContrast(hex: string): number | null {
  const l = luminance(hex)
  return l == null ? null : 1.05 / (l + 0.05)
}

export type ContrastVerdict = { ok: boolean; label: string }

/**
 * The brand colour is used as a button/header background with white text on public quotes, so
 * tell the agent when white text would be hard to read (WCAG AA = 4.5:1).
 */
export function contrastVerdict(hex: string): ContrastVerdict {
  const ratio = whiteContrast(hex)
  if (ratio == null) return { ok: false, label: 'Use a #rrggbb colour' }
  if (ratio >= 7) return { ok: true, label: 'AAA on white text' }
  if (ratio >= 4.5) return { ok: true, label: 'AA on white text' }
  return { ok: false, label: 'Too light for white text' }
}

const FIELDS: Array<keyof AgencySettings> = [
  'agency_name',
  'logo_url',
  'primary_color',
  'quotation_template',
  'phone',
  'email',
  'website',
  'address',
  'quotation_footer',
]

/** How many branding fields differ between what is on screen and what was last saved. */
export function changedFieldCount(current: AgencySettings, saved: AgencySettings): number {
  const norm = (v: unknown) => (v == null || v === '' ? '' : String(v))
  return FIELDS.filter((key) => norm(current[key]) !== norm(saved[key])).length
}
