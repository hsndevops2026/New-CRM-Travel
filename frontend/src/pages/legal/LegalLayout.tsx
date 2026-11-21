import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthBrand } from '../../components/auth/AuthLayout'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { t as translate, useI18n } from '../../lib/i18n'

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  useI18n()
  return (
    <div className="min-h-dvh bg-shop-bg text-shop-ink">
      <header className="border-b border-shop-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/login" className="no-underline">
            <AuthBrand />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link to="/login" className="text-sm font-semibold text-shop-accent hover:underline">
              {translate('Sign in')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-semibold tracking-[0.08em] text-shop-muted uppercase">
          {translate('Legal')}
        </p>
        <h1 className="mt-2 text-[32px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="mt-2 text-sm text-shop-muted">{updated}</p>

        <article className="prose-legal mt-8 space-y-8 rounded-2xl border border-shop-border bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
          {children}
        </article>

        <nav className="mt-8 flex flex-wrap gap-4 text-sm font-semibold" aria-label={translate('Legal')}>
          <Link to="/privacy-policy" className="text-shop-accent hover:underline">
            {translate('Privacy Policy')}
          </Link>
          <Link to="/term-and-service" className="text-shop-accent hover:underline">
            {translate('Terms of Service')}
          </Link>
          <Link to="/login" className="text-shop-muted hover:text-shop-ink hover:underline">
            {translate('Sign in')}
          </Link>
        </nav>
      </main>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-shop-ink">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-slate-700 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:ps-5 [&_a]:font-semibold [&_a]:text-shop-accent [&_a]:underline-offset-2 hover:[&_a]:underline">
        {children}
      </div>
    </section>
  )
}
