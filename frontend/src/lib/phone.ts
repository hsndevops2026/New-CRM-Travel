export const COUNTRY_DIALS = [
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'PK', name: 'Pakistan', dial: '92' },
  { iso: 'EG', name: 'Egypt', dial: '20' },
  { iso: 'QA', name: 'Qatar', dial: '974' },
  { iso: 'KW', name: 'Kuwait', dial: '965' },
  { iso: 'BH', name: 'Bahrain', dial: '973' },
  { iso: 'OM', name: 'Oman', dial: '968' },
  { iso: 'JO', name: 'Jordan', dial: '962' },
  { iso: 'IL', name: 'Israel', dial: '972' },
  { iso: 'LB', name: 'Lebanon', dial: '961' },
  { iso: 'TR', name: 'Turkey', dial: '90' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'IT', name: 'Italy', dial: '39' },
  { iso: 'ES', name: 'Spain', dial: '34' },
  { iso: 'PH', name: 'Philippines', dial: '63' },
] as const

export const DEFAULT_DIAL = '971'

export function digitsOnly(value: string) {
  return String(value || '').replace(/\D/g, '')
}

export function composeInternationalPhone(dial: string, local: string) {
  const code = digitsOnly(dial)
  const national = digitsOnly(local).replace(/^0+/, '')
  return `${code}${national}`
}

type DialOption = { dial: string }

export function splitInternationalPhone(
  phone: string,
  fallbackDial = DEFAULT_DIAL,
  countryDials: readonly DialOption[] = COUNTRY_DIALS,
) {
  const digits = digitsOnly(phone)
  const ranked = [...countryDials].sort((a, b) => b.dial.length - a.dial.length)
  const match = ranked.find((country) => digits.startsWith(country.dial) && digits.length > country.dial.length)
  if (!match) {
    return { dial: fallbackDial, local: digits }
  }
  return { dial: match.dial, local: digits.slice(match.dial.length) }
}
