import { t as translate, useI18n } from '../../lib/i18n'
import type { ReactNode } from 'react'

type Props = {
  label: string
  hint?: string
  error?: string | null
  htmlFor?: string
  className?: string
  children: ReactNode
}

export default function Field({ label, hint, error, htmlFor, className = '', children }: Props) {
  useI18n()
  return (
    <label htmlFor={htmlFor} className={`grid gap-1 text-sm ${className}`}>
      <span className="font-medium">{translate(label)}</span>
      {children}
      {error ? (
        <span className="text-xs text-red-600">{translate(error)}</span>
      ) : hint ? (
        <span className="text-xs text-shop-muted">{hint}</span>
      ) : null}
    </label>
  )
}
