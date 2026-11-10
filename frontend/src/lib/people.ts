/**
 * Staff accounts have only an email, so show the person from it:
 * "layla.mansour@horizontravel.ae" → "Layla Mansour" / "LM".
 */
export function nameFromEmail(email?: string | null) {
  const local = String(email || '').split('@')[0]
  const words = local.split(/[._\-+\s]+/).filter(Boolean)
  if (!words.length) return 'Account'
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export function initialsFromName(name?: string | null) {
  const words = String(name || '').split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
}
