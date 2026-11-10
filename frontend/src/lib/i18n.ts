import { createContext, createElement, Fragment, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import ar from '../locales/ar.json'
import en from '../locales/en.json'

const dictionaries = { ar: new Map(Object.entries(ar)), en: new Map(Object.entries(en)) }
export type Language = keyof typeof dictionaries
const foldedArabic = new Map(Object.entries(ar).map(([key, value]) => [key.toLowerCase(), value]))
let language: Language = 'ar'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setLanguage(next: Language) {
  document.documentElement.lang = next
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr'
  if (language === next) return
  language = next
  listeners.forEach((listener) => listener())
}

export function t(key: string | null | undefined, values: Record<string, string | number> = {}) {
  if (key == null) return ''
  const text = dictionaries[language].get(key)
    ?? (language === 'ar' ? foldedArabic.get(key.toLowerCase()) : undefined)
    ?? dictionaries.en.get(key)
    ?? key
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.hasOwn(values, name)) return match
    const value = String(values[name])
    return language === 'ar' ? `\u2068${value}\u2069` : value
  })
}

export function locale() {
  return language === 'ar' ? 'ar-u-nu-latn' : undefined
}

/** Put an emphasized number at the catalog's count placeholder. */
export function translateCount(key: string, count: number, values: Record<string, string | number>) {
  const [before, after] = t(key, values).split('{count}')
  return createElement(Fragment, null, before, createElement('strong', { dir: 'ltr' }, count), after)
}

type LanguageContextValue = { language: Language; setLanguage: (next: Language) => void; t: typeof t }
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ userId, forcedLanguage, children }: {
  userId?: string
  forcedLanguage?: Language
  children: ReactNode
}) {
  const current = useSyncExternalStore(subscribe, () => language)
  const storageKey = `travel-crm.language.${userId ?? 'guest'}`
  useLayoutEffect(() => {
    if (forcedLanguage) {
      setLanguage(forcedLanguage)
      return
    }
    let stored: string | null = null
    try {
      stored = localStorage.getItem(storageKey)
    } catch {
      // Storage may be disabled.
    }
    setLanguage(stored === 'en' ? 'en' : 'ar')
  }, [forcedLanguage, storageKey])
  function choose(next: Language) {
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // Keep the session usable without storage.
    }
    setLanguage(next)
  }
  return createElement(LanguageContext.Provider, { value: { language: current, setLanguage: choose, t } }, children)
}

export function useI18n(): LanguageContextValue {
  const current = useSyncExternalStore(subscribe, () => language)
  const context = useContext(LanguageContext)
  return context ?? { language: current, setLanguage, t }
}
