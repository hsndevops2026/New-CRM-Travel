import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import StatusBadge from '../ui/StatusBadge'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  DEFAULT_CHAT_TEXT,
  embedSnippet,
  lookPatch,
  parseOrigins,
  rotateMyWidgetKey,
  saveMyWidget,
  toLookDraft,
  type LookDraft,
  type WebchatSettingsResponse,
} from '../../lib/webchat'
import { ChatPreview, LookFields, SnippetBox } from './ChatParts'
import { CARD, LABEL } from './styles'

/**
 * The signed-in user's own chat: their code, their look, their sites. Leads from it are theirs.
 * The page re-mounts it (key) when the saved chat changes, so the form starts from what is stored.
 */
export default function MyChatPanel({ data, onData, agencyColor }: {
  data: WebchatSettingsResponse
  onData: (next: WebchatSettingsResponse) => void
  agencyColor: string
}) {
  useI18n()
  const toast = useToast()
  const { confirm, dialog } = useConfirm()
  const widget = data.my_widget
  const agency = data.settings
  const [draft, setDraft] = useState<LookDraft>(() => toLookDraft(widget))
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseOrigins(draft.origins_text), [draft.origins_text])
  const dirty = JSON.stringify(draft) !== JSON.stringify(toLookDraft(widget))
  const set = (patch: Partial<LookDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const agencyColorNow = agency.color || agencyColor || '#0f766e'
  const lang = (draft.language || agency.language) as 'ar' | 'en'
  const side = (draft.side || agency.side || (lang === 'ar' ? 'left' : 'right')) as 'left' | 'right'
  const live = agency.enabled && widget.enabled && widget.owner_active
  const usesAgencySites = widget.allowed_origins.length === 0
  const effectiveSites = usesAgencySites ? (agency.allowed_origins.length ? agency.allowed_origins : data.env_origins) : widget.allowed_origins

  const save = async () => {
    if (parsed.invalid.length) {
      setError(translate('These are not website addresses: {value0}', { value0: parsed.invalid.join(', ') }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      onData(await saveMyWidget(lookPatch(draft, parsed.origins)))
      toast.show({ tone: 'success', message: translate('Your chat is saved. Websites get the change within a minute.') })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save your chat')
    } finally {
      setSaving(false)
    }
  }

  const rotate = async () => {
    const ok = await confirm({
      title: translate('Make a new code?'),
      description: translate('The code on your websites stops working at once. Paste the new code into every site that shows your chat.'),
      confirmLabel: translate('Make a new code'),
      tone: 'danger',
    })
    if (!ok) return
    setRotating(true)
    try {
      onData(await rotateMyWidgetKey())
      toast.show({ tone: 'success', message: translate('New code made. Paste it into your websites.') })
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to make a new code' })
    } finally {
      setRotating(false)
    }
  }

  return (
    <section aria-labelledby="wc-mine" className={CARD}>
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="wc-mine" className="text-base font-bold">{translate('Your chat')}</h2>
        <StatusBadge label={translate(live ? 'On' : 'Off')} tone={live ? 'success' : 'neutral'} />
      </div>
      <p className="m-0 text-sm text-shop-muted">
        {translate('Requests made in this chat become your leads: they appear in your Leads list and you get the notification.')}
      </p>

      {!agency.enabled && (
        <Banner tone="warning" title={translate('An admin has switched website chats off for the agency')}>
          {translate('Your chat shows nothing until they switch it back on.')}
        </Banner>
      )}
      {!widget.owner_active && (
        <Banner tone="warning" title={translate('Your account is not approved')}>
          {translate('Your chat shows nothing until an admin approves your account.')}
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        <span className={LABEL}>{translate('Your code for websites')}</span>
        <p className="m-0 text-xs text-shop-muted">
          {translate('Paste this line into the page\'s <head> (or anywhere in <body>) on every page that should show the chat. It also works in Google Tag Manager and in WordPress "header scripts" plugins.')}
        </p>
        <SnippetBox snippet={embedSnippet(data.script_url, widget.public_key)} testUrl={widget.test_page_url} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-shop-muted">
          <span>{translate('Someone copied your code to another site?')}</span>
          <Button variant="ghost" size="sm" icon={<RefreshCw />} loading={rotating} onClick={() => void rotate()}>
            {translate('Make a new code')}
          </Button>
        </div>
      </div>

      {effectiveSites.length === 0 && (
        <Banner tone="warning" title={translate('Any website can use your chat right now')}>
          {translate('Add the websites that may show it below, so nobody else can put your chat on their site.')}
        </Banner>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            {translate('Show my chat on websites')}
          </label>
          <LookFields
            idPrefix="wc-mine"
            draft={draft}
            set={set}
            disabled={false}
            fallback={{
              language: agency.language,
              title: agency.title || DEFAULT_CHAT_TEXT[lang].title,
              greeting: agency.greeting || DEFAULT_CHAT_TEXT[lang].greeting,
              color: agencyColorNow,
              colorLabel: 'Agency default',
            }}
            invalidOrigins={parsed.invalid}
            originsHint={
              usesAgencySites && effectiveSites.length
                ? translate('One website per line. While empty, the agency list is used: {value0}', { value0: effectiveSites.join(', ') })
                : translate('One website per line. Add both addresses if the site has one with and one without "www".')
            }
          />
          {error && <Banner tone="danger" title={translate('Your chat could not be saved')}>{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>{translate('Save my chat')}</Button>
            {dirty && <Button variant="ghost" disabled={saving} onClick={() => { setDraft(toLookDraft(widget)); setError(null) }}>{translate('Discard')}</Button>}
          </div>
        </div>
        <ChatPreview
          color={draft.color || agencyColorNow}
          language={lang}
          side={side}
          title={draft.title || agency.title || DEFAULT_CHAT_TEXT[lang].title}
          greeting={draft.greeting || agency.greeting || DEFAULT_CHAT_TEXT[lang].greeting}
          enabled={draft.enabled && live}
        />
      </div>
    </section>
  )
}
