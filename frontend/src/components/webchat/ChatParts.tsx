import { useState } from 'react'
import { Check, Copy, ExternalLink, MessageCircle } from 'lucide-react'
import Button from '../ui/Button'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import { DEFAULT_CHAT_TEXT, type LookDraft } from '../../lib/webchat'
import { FIELD, LABEL } from './styles'


/** The script line with Copy and "Open test page". */
export function SnippetBox({ snippet, testUrl }: { snippet: string; testUrl: string }) {
  useI18n()
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show({ tone: 'error', message: translate('Copy failed. Select the code and copy it yourself.') })
    }
  }
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-shop-border bg-shop-bg px-3 py-2 font-mono text-xs whitespace-nowrap select-all">
        {snippet}
      </code>
      <Button icon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
        {translate(copied ? 'Copied' : 'Copy')}
      </Button>
      <a
        href={testUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold text-shop-ink hover:bg-neutral-bg max-sm:h-11"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        {translate('Open test page')}
      </a>
    </div>
  )
}

export function ChatPreview({ color, language, side, title, greeting, enabled }: {
  color: string
  language: 'ar' | 'en'
  side: 'left' | 'right'
  title: string
  greeting: string
  enabled: boolean
}) {
  useI18n()
  const rtl = language === 'ar'
  return (
    <figure className="m-0 flex flex-[0_1_300px] flex-col gap-2 max-lg:w-full max-lg:flex-none">
      <figcaption className={LABEL}>{translate('Live preview · website chat')}</figcaption>
      <div className="relative h-[380px] overflow-hidden rounded-[14px] border border-shop-border bg-slate-100">
        <div
          dir={rtl ? 'rtl' : 'ltr'}
          lang={language}
          className={`absolute bottom-[74px] flex w-[250px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] ${side === 'left' ? 'left-3' : 'right-3'} ${enabled ? '' : 'opacity-40'}`}
        >
          <div className="flex items-center justify-between px-3 py-2.5 text-sm font-bold text-white" style={{ background: color }}>
            <span className="truncate">{title}</span>
          </div>
          <div className="flex flex-col gap-2 bg-gray-50 p-3 text-[13px]">
            <span className="max-w-[85%] self-start rounded-2xl border border-gray-200 bg-white px-2.5 py-1.5 leading-snug whitespace-pre-wrap">{greeting}</span>
            <span className="h-7 rounded-lg border border-gray-300 bg-white" />
            <span className="h-7 rounded-lg border border-gray-300 bg-white" />
            <span className="grid h-8 place-items-center rounded-lg text-xs font-semibold text-white" style={{ background: color }}>
              {DEFAULT_CHAT_TEXT[language].start}
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
      </div>
      {!enabled && <span className="text-xs text-shop-muted">{translate('The chat is off: websites show nothing.')}</span>}
    </figure>
  )
}

/**
 * Language, look and allowed sites. In a user's chat an empty field means "the agency
 * default", shown as the placeholder; in the agency defaults it means the built-in text.
 */
export function LookFields({ idPrefix, draft, set, disabled, fallback, invalidOrigins, originsHint }: {
  idPrefix: string
  draft: LookDraft
  set: (patch: Partial<LookDraft>) => void
  disabled: boolean
  /** What an empty field turns into. language null = this is the agency form (language is required). */
  fallback: { language: 'ar' | 'en' | null; title: string; greeting: string; color: string; colorLabel: string }
  invalidOrigins: string[]
  originsHint: string
}) {
  useI18n()
  const userForm = fallback.language !== null
  const lang = (draft.language || fallback.language || 'ar') as 'ar' | 'en'
  const color = draft.color || fallback.color
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3.5">
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
        <label className="grid gap-1">
          <span className={LABEL}>{translate('Colour')}</span>
          <span className="flex items-center gap-2">
            <input
              type="color"
              aria-label={translate('Colour')}
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
        </label>
      </div>

      <label className="grid gap-1">
        <span className={LABEL}>{translate('Title')}</span>
        <input id={`${idPrefix}-title`} className={FIELD} dir="auto" maxLength={60} disabled={disabled} placeholder={fallback.title || DEFAULT_CHAT_TEXT[lang].title} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>{translate('Welcome message')}</span>
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

      <label className="grid gap-1">
        <span className={LABEL}>{translate('Websites allowed to show the chat')}</span>
        <textarea
          className="min-h-[88px] w-full rounded-lg border border-line-strong bg-white px-2.5 py-2 font-mono text-sm disabled:bg-neutral-bg"
          dir="ltr"
          disabled={disabled}
          placeholder={'https://agency.com\nhttps://booking.agency.com'}
          value={draft.origins_text}
          onChange={(e) => set({ origins_text: e.target.value })}
        />
        <span className="text-xs text-shop-muted">{originsHint}</span>
        {invalidOrigins.length > 0 && (
          <span role="alert" className="text-xs text-danger">
            {translate('These are not website addresses: {value0}', { value0: invalidOrigins.join(', ') })}
          </span>
        )}
      </label>
    </>
  )
}
