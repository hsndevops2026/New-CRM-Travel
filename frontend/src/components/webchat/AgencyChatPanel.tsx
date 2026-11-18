import { useMemo, useState } from 'react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  embedSnippet,
  lookPatch,
  parseOrigins,
  saveWebchatSettings,
  toLookDraft,
  type LookDraft,
  type WebchatSettingsResponse,
} from '../../lib/webchat'
import { ChatPreview, LookFields, SnippetBox } from './ChatParts'
import { CARD, LABEL } from './styles'

/**
 * Admins: the defaults every user's chat starts from, the phone rules for all chats,
 * the switch for all chats, and the shared code without a user (older installs).
 */
export default function AgencyChatPanel({ data, onData, agencyColor }: {
  data: WebchatSettingsResponse
  onData: (next: WebchatSettingsResponse) => void
  agencyColor: string
}) {
  useI18n()
  const toast = useToast()
  const s = data.settings
  const initial = () => ({ look: toLookDraft(s), verify_phone: s.verify_phone, show_staff_replies: s.show_staff_replies })
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseOrigins(draft.look.origins_text), [draft.look.origins_text])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial())
  const setLook = (patch: Partial<LookDraft>) => setDraft((d) => ({ ...d, look: { ...d.look, ...patch } }))
  const lang = (draft.look.language || 'ar') as 'ar' | 'en'
  const color = draft.look.color || agencyColor || '#0f766e'
  const openToAll = s.allowed_origins.length === 0 && data.env_origins.length === 0

  const save = async () => {
    if (parsed.invalid.length) {
      setError(translate('These are not website addresses: {value0}', { value0: parsed.invalid.join(', ') }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const patch = lookPatch(draft.look, parsed.origins)
      onData(await saveWebchatSettings({
        ...patch,
        language: draft.look.language || 'ar',
        verify_phone: draft.verify_phone,
        show_staff_replies: draft.show_staff_replies,
      }))
      toast.show({ tone: 'success', message: translate('Website chat saved. Websites get the change within a minute.') })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the chat settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="wc-agency" className={CARD}>
      <h2 id="wc-agency" className="text-base font-bold">{translate('Agency defaults')}</h2>
      <p className="m-0 text-sm text-shop-muted">
        {translate('Every user\'s chat uses these for the fields they leave empty. The phone rules and the main switch apply to all chats.')}
      </p>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-1" checked={draft.look.enabled} onChange={(e) => setLook({ enabled: e.target.checked })} />
            <span>
              {translate('Allow website chats')}
              <span className="block text-xs font-normal text-shop-muted">{translate('Off hides every user\'s chat on every website.')}</span>
            </span>
          </label>

          <LookFields
            idPrefix="wc-agency"
            draft={draft.look}
            set={setLook}
            disabled={false}
            fallback={{ language: null, title: '', greeting: '', color: agencyColor || '#0f766e', colorLabel: 'Agency colour' }}
            invalidOrigins={parsed.invalid}
            originsHint={
              s.allowed_origins.length === 0 && data.env_origins.length > 0
                ? translate('For chats whose user has not listed their own websites. While empty, the server setting is used: {value0}', { value0: data.env_origins.join(', ') })
                : translate('For chats whose user has not listed their own websites. One website per line.')
            }
          />

          <fieldset className="grid gap-3 rounded-lg border border-shop-border p-3">
            <legend className={`${LABEL} px-1`}>{translate('Phone number and replies')}</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={draft.verify_phone} onChange={(e) => setDraft((d) => ({ ...d, verify_phone: e.target.checked }))} />
              <span>
                {translate('Confirm the phone number with a code sent on WhatsApp before the chat starts')}
                <span className="block text-xs text-shop-muted">
                  {translate('Stops people from chatting as someone else\'s number. Each code is one WhatsApp message.')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!draft.verify_phone}
                checked={draft.verify_phone && draft.show_staff_replies}
                onChange={(e) => setDraft((d) => ({ ...d, show_staff_replies: e.target.checked }))}
              />
              <span>
                {translate('Show staff replies inside the website chat too')}
                <span className="block text-xs text-shop-muted">
                  {draft.verify_phone
                    ? translate('Replies from the Inbox still go to WhatsApp, and also appear in the visitor\'s chat while it is open.')
                    : translate('Needs the phone code above, so a reply never reaches someone who only typed the number.')}
                </span>
              </span>
            </label>
          </fieldset>

          {error && <Banner tone="danger" title={translate('The chat settings could not be saved')}>{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>{translate('Save agency defaults')}</Button>
            {dirty && <Button variant="ghost" disabled={saving} onClick={() => { setDraft(initial()); setError(null) }}>{translate('Discard')}</Button>}
          </div>
        </div>
        <ChatPreview
          color={color}
          language={lang}
          side={(draft.look.side || (lang === 'ar' ? 'left' : 'right')) as 'left' | 'right'}
          title={draft.look.title || (lang === 'ar' ? 'تحدث معنا' : 'Chat with us')}
          greeting={draft.look.greeting || (lang === 'ar' ? 'أهلاً بك! اكتب اسمك ورقم هاتفك لنبدأ، وسنساعدك في حجز رحلتك.' : 'Welcome! Enter your name and phone number to start, and we will help you book your trip.')}
          enabled={draft.look.enabled}
        />
      </div>

      <details className="rounded-lg border border-shop-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{translate('Shared code without a user')}</summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="m-0 text-xs text-shop-muted">
            {translate('Code pasted before chats had a user keeps working with these defaults. Its leads are not given to anyone: assign them from the Leads page.')}
          </p>
          {openToAll && (
            <Banner tone="warning" title={translate('Any website can use this chat right now')}>
              {translate('Add the websites that may show it above, so nobody else can put your chat on their site.')}
            </Banner>
          )}
          <SnippetBox snippet={embedSnippet(data.script_url)} testUrl={data.test_page_url} />
        </div>
      </details>
    </section>
  )
}
