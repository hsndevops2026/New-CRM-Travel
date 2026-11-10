import { useI18n, type Language } from '../lib/i18n'

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()
  return (
    <select
      aria-label={t('Interface language')}
      value={language}
      onChange={(event) => setLanguage(event.target.value as Language)}
      className="max-w-32 rounded-lg border border-shop-border bg-white px-2 py-1 text-sm text-shop-ink"
    >
      <option value="ar" lang="ar" dir="rtl">العربية</option>
      <option value="en" lang="en" dir="ltr">English</option>
    </select>
  )
}
