import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Globe, MessageCircle, Plus, X } from 'lucide-react'
import Button from '../ui/Button'
import SegmentedControl from '../ui/SegmentedControl'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import { DEFAULT_CHAT_TEXT, normalizeOrigin, type LookDraft } from '../../lib/webchat'
import { FIELD, LABEL } from './styles'

/** A numbered setup step: "1  Add the code to your website". */
export function StepCard({ step, title, description, done, children, id }: {
  step: number
  title: string
  description?: string
  done?: boolean
  children: ReactNode
  id?: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-[10px] border border-shop-border bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-shop-accent text-white' : 'bg-tint text-shop-accent'}`}
        >
          {done ? <Check className="size-4" /> : step}
        </span>
        <div className="min-w-0">
          <h3 id={id} className="m-0 text-[15px] font-bold">{title}</h3>
          {description && <p className="m-0 mt-0.5 text-sm text-shop-muted">{description}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:ps-10">{children}</div>
    </section>
  )
}

type Platform = 'html' | 'wordpress' | 'gtm'

/** The script line, a Copy button, where to paste it on common platforms, and the test page. */
export function InstallBox({ snippet, testUrl }: { snippet: string; testUrl: string }) {
  useI18n()
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [platform, setPlatform] = useState<Platform>('html')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show({ tone: 'error', message: translate('Copy failed. Select the code and copy it yourself.') })
    }
  }
  const steps: Record<Platform, string[]> = {
    html: [
      'Open the HTML of every page that should show the chat.',
      'Paste the line inside <head>, or anywhere in <body>.',
      'Save and publish the page.',
    ],
    wordpress: [
      'Install a "header and footer scripts" plugin (for example WPCode).',
      'Paste the line into the Header box and save.',
    ],
    gtm: [
      'In Google Tag Manager, add a new tag of type "Custom HTML".',
      'Paste the line, set the trigger to "All Pages", then publish.',
    ],
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-lg border border-shop-border bg-slate-950 p-3 pe-28">
        <code dir="ltr" className="block whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-100 select-all">
          {snippet}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="absolute end-2 top-2 inline-flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-[13px] font-semibold text-white hover:bg-white/20 max-sm:h-11"
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {translate(copied ? 'Copied' : 'Copy')}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          ariaLabel="Where to paste it"
          value={platform}
          onChange={(id) => setPlatform(id as Platform)}
          items={[
            { id: 'html', label: 'Any website' },
            { id: 'wordpress', label: 'WordPress' },
            { id: 'gtm', label: 'Google Tag Manager' },
          ]}
        />
        <a
          href={testUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-shop-accent hover:underline max-sm:h-11"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {translate('Try it on a test page')}
        </a>
      </div>
      <ol className="m-0 grid list-decimal gap-1 ps-5 text-sm text-slate-700">
        {steps[platform].map((line) => <li key={line}>{translate(line)}</li>)}
      </ol>
    </div>
  )
}

/** Allowed websites as removable chips, with an input that checks each address as it is added. */
export function OriginsEditor({ id, value, onChange, disabled, placeholderSite = 'agency.com' }: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholderSite?: string
}) {
  useI18n()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const parts = input.split(/[\s,]+/).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    const bad: string[] = []
    for (const part of parts) {
      const origin = normalizeOrigin(part)
      if (!origin) bad.push(part)
      else if (!next.includes(origin)) next.push(origin)
    }
    onChange(next)
    setInput(bad.join(' '))
    setError(bad.length ? translate('These are not website addresses: {value0}', { value0: bad.join(', ') }) : null)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {value.map((origin) => (
            <li key={origin} className="inline-flex items-center gap-1 rounded-full border border-shop-border bg-shop-bg ps-3 pe-0.5 text-sm">
              <Globe className="size-3.5 text-shop-muted" aria-hidden="true" />
              <bdi dir="ltr">{origin.replace(/^https:\/\//, '')}</bdi>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="rounded-full"
                  aria-label={translate('Remove {value0}', { value0: origin })}
                  icon={<X />}
                  onClick={() => onChange(value.filter((o) => o !== origin))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input
            id={id}
            dir="ltr"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} flex-1`}
            placeholder={placeholderSite}
            aria-label={translate('Add a website')}
            aria-invalid={error ? true : undefined}
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null) }}
            onKeyDown={onKey}
            onBlur={() => { if (input.trim()) add() }}
          />
          <Button icon={<Plus />} disabled={!input.trim()} onClick={add}>{translate('Add')}</Button>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-xs text-danger-fg">{error}</p>}
    </div>
  )
}

/** A website with the chat open on it, as visitors will see it. */
export function ChatPreview({ color, language, side, title, greeting, enabled, site }: {
  color: string
  language: 'ar' | 'en'
  side: 'left' | 'right'
  title: string
  greeting: string
  enabled: boolean
  site?: string | null
}) {
  useI18n()
  const rtl = language === 'ar'
  const text = DEFAULT_CHAT_TEXT[language]
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className={LABEL}>{translate('Preview')}</figcaption>
      <div className="overflow-hidden rounded-[14px] border border-shop-border bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-shop-border bg-shop-bg px-3 py-2">
          <span aria-hidden="true" className="flex gap-1">
            <span className="size-2 rounded-full bg-slate-300" />
            <span className="size-2 rounded-full bg-slate-300" />
            <span className="size-2 rounded-full bg-slate-300" />
          </span>
          <span dir="ltr" className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-center text-[11px] text-shop-muted">
            {(site || 'your-website.com').replace(/^https?:\/\//, '')}
          </span>
        </div>
        <div className="relative h-[400px] bg-[linear-gradient(180deg,#f8fafc,#eef2f7)]">
          <div aria-hidden="true" className="flex flex-col gap-2 p-4 opacity-60">
            <span className="h-3 w-2/3 rounded bg-slate-200" />
            <span className="h-2 w-full rounded bg-slate-200" />
            <span className="h-2 w-5/6 rounded bg-slate-200" />
            <span className="mt-2 h-16 w-full rounded-lg bg-slate-200" />
          </div>
          {enabled ? (
            <>
              <div
                dir={rtl ? 'rtl' : 'ltr'}
                lang={language}
                className={`absolute bottom-[68px] flex w-[230px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] ${side === 'left' ? 'left-3' : 'right-3'}`}
              >
                <div className="flex items-center justify-between px-3 py-2.5 text-[13px] font-bold text-white" style={{ background: color }}>
                  <span className="truncate">{title}</span>
                  <X className="size-3.5 opacity-80" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-2 bg-gray-50 p-3 text-[12px]">
                  <span className="max-w-[90%] self-start rounded-2xl border border-gray-200 bg-white px-2.5 py-1.5 leading-snug whitespace-pre-wrap">{greeting}</span>
                  <span className="h-7 rounded-lg border border-gray-300 bg-white" />
                  <span className="h-7 rounded-lg border border-gray-300 bg-white" />
                  <span className="grid h-8 place-items-center rounded-lg text-xs font-semibold text-white" style={{ background: color }}>
                    {text.start}
                  </span>
                </div>
              </div>
              <span
                aria-hidden="true"
                className={`absolute bottom-3 grid size-12 place-items-center rounded-full text-white shadow-lg ${side === 'left' ? 'left-3' : 'right-3'}`}
                style={{ background: color }}
              >
                <MessageCircle className="size-6" />
              </span>
            </>
          ) : (
            <p className="absolute inset-x-4 bottom-4 m-0 rounded-lg bg-white/90 p-3 text-center text-sm text-shop-muted">
              {translate('The chat is off: websites show nothing.')}
            </p>
          )}
        </div>
      </div>
    </figure>
  )
}

/** Language, bubble side, colour, title and welcome message. Empty = the default shown as placeholder. */
export function LookFields({ draft, set, disabled, fallback }: {
  draft: LookDraft
  set: (patch: Partial<LookDraft>) => void
  disabled: boolean
  /** What an empty field turns into. language null = the agency form (language is required). */
  fallback: { language: 'ar' | 'en' | null; title: string; greeting: string; color: string; colorLabel: string }
}) {
  useI18n()
  const userForm = fallback.language !== null
  const lang = (draft.language || fallback.language || 'ar') as 'ar' | 'en'
  const color = draft.color || fallback.color
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3.5">
        <label className="grid gap-1">
          <span className={LABEL}>{translate('Language')}</span>
          <select className={FIELD} disabled={disabled} value={draft.language} onChange={(e) => set({ language: e.target.value as LookDraft['language'] })}>
            {userForm && (
              <option value="">{translate('Agency default ({value0})', { value0: fallback.language === 'en' ? 'English' : 'العربية' })}</option>
            )}
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className={LABEL}>{translate('Bubble position')}</span>
          <select className={FIELD} disabled={disabled} value={draft.side} onChange={(e) => set({ side: e.target.value as LookDraft['side'] })}>
            <option value="">{translate(userForm ? 'Agency default' : 'Automatic (left for Arabic, right for English)')}</option>
            <option value="left">{translate('Bottom left')}</option>
            <option value="right">{translate('Bottom right')}</option>
          </select>
        </label>
        <div className="grid gap-1">
          <span className={LABEL} id="wc-colour-label">{translate('Colour')}</span>
          <span className="flex h-9 items-center gap-2 max-sm:h-11">
            <input
              type="color"
              aria-labelledby="wc-colour-label"
              disabled={disabled}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-white p-1"
              value={color}
              onChange={(e) => set({ color: e.target.value })}
            />
            {draft.color ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ color: '' })}>{translate('Reset')}</Button>
            ) : (
              <span className="text-xs text-shop-muted">{translate(fallback.colorLabel)}</span>
            )}
          </span>
        </div>
      </div>
      <label className="grid gap-1">
        <span className={LABEL}>{translate('Title')}</span>
        <input className={FIELD} dir="auto" maxLength={60} disabled={disabled} placeholder={fallback.title || DEFAULT_CHAT_TEXT[lang].title} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="grid gap-1">
        <span className="flex items-baseline justify-between">
          <span className={LABEL}>{translate('Welcome message')}</span>
          <span className="text-[11px] text-shop-muted tabular-nums">{draft.greeting.length}/400</span>
        </span>
        <textarea
          className="min-h-[72px] w-full rounded-lg border border-line-strong bg-white px-2.5 py-2 text-sm disabled:bg-neutral-bg"
          dir="auto"
          maxLength={400}
          disabled={disabled}
          placeholder={fallback.greeting || DEFAULT_CHAT_TEXT[lang].greeting}
          value={draft.greeting}
          onChange={(e) => set({ greeting: e.target.value })}
        />
      </label>
    </>
  )
}

/** Stays at the bottom of the screen while there are unsaved changes. */
export function SaveBar({ visible, saving, label, onSave, onDiscard, error }: {
  visible: boolean
  saving: boolean
  label: string
  onSave: () => void
  onDiscard: () => void
  error?: string | null
}) {
  useI18n()
  if (!visible && !error) return null
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-shop-border bg-white p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.1)]">
      <span role="status" className={`me-auto ps-1.5 text-sm ${error ? 'text-danger-fg' : 'text-shop-muted'}`}>
        {error || translate('You have unsaved changes')}
      </span>
      <Button variant="ghost" disabled={saving} onClick={onDiscard}>{translate('Discard')}</Button>
      <Button variant="primary" loading={saving} onClick={onSave}>{label}</Button>
    </div>
  )
}

/** On/off switch with a label, used for the chat switches. */
export function Switch({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden="true" className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-shop-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-shop-accent" />
        <span aria-hidden="true" className="absolute start-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="block text-xs text-shop-muted">{description}</span>}
      </span>
    </label>
  )
}
