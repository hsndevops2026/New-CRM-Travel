import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import { t as translate, useI18n } from '../../lib/i18n'
import {
  DEFAULT_CHAT_TEXT,
  embedSnippet,
  lookPatch,
  parseOrigins,
  saveWebchatSettings,
  toLookDraft,
  type LookDraft,
  type WebchatSettingsResponse,
} from '../../lib/webchat'
import { ChatPreview, InstallBox, LookFields, OriginsEditor, SaveBar, Switch } from './ChatParts'
import { CARD } from './styles'

/**
 * Admins: the switch for every chat, the phone rules, the defaults every user's chat
 * starts from, and the shared code without a user (older installs).
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

  const origins = useMemo(() => parseOrigins(draft.look.origins_text).origins, [draft.look.origins_text])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial())
  const setLook = (patch: Partial<LookDraft>) => setDraft((d) => ({ ...d, look: { ...d.look, ...patch } }))
  const lang = (draft.look.language || 'ar') as 'ar' | 'en'
  const color = draft.look.color || agencyColor || '#0f766e'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onData(await saveWebchatSettings({
        ...lookPatch(draft.look, origins),
        language: draft.look.language || 'ar',
        verify_phone: draft.verify_phone,
        show_staff_replies: draft.verify_phone && draft.show_staff_replies,
      }))
      toast.show({ tone: 'success', message: translate('Website chat saved. Websites get the change within a minute.') })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the chat settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="wc-rules" className={CARD}>
        <h2 id="wc-rules" className="m-0 text-base font-bold">{translate('Rules for every chat')}</h2>
        <Switch
          checked={draft.look.enabled}
          onChange={(enabled) => setLook({ enabled })}
          label={translate('Allow website chats')}
          description={translate('Off hides every user\'s chat on every website.')}
        />
        <Switch
          checked={draft.verify_phone}
          onChange={(verify_phone) => setDraft((d) => ({ ...d, verify_phone }))}
          label={translate('Confirm the phone number with a code sent on WhatsApp before the chat starts')}
          description={translate('Stops people from chatting as someone else\'s number. Each code is one WhatsApp message.')}
        />
        <Switch
          checked={draft.verify_phone && draft.show_staff_replies}
          disabled={!draft.verify_phone}
          onChange={(show_staff_replies) => setDraft((d) => ({ ...d, show_staff_replies }))}
          label={translate('Show staff replies inside the website chat too')}
          description={draft.verify_phone
            ? translate('Replies from the Inbox still go to WhatsApp, and also appear in the visitor\'s chat while it is open.')
            : translate('Needs the phone code above, so a reply never reaches someone who only typed the number.')}
        />
      </section>

      <section aria-labelledby="wc-defaults" className={CARD}>
        <div>
          <h2 id="wc-defaults" className="m-0 text-base font-bold">{translate('Agency defaults')}</h2>
          <p className="m-0 mt-0.5 text-sm text-shop-muted">{translate('Every user\'s chat uses these for the fields they leave empty.')}</p>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-w-0 flex-col gap-4">
            <LookFields
              draft={draft.look}
              set={setLook}
              disabled={false}
              fallback={{ language: null, title: '', greeting: '', color: agencyColor || '#0f766e', colorLabel: 'Agency colour' }}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">{translate('Websites allowed to show the chat')}</span>
              <span className="text-xs text-shop-muted">{translate('For chats whose user has not listed their own websites.')}</span>
              <OriginsEditor id="wc-agency-origins" value={origins} onChange={(next) => setLook({ origins_text: next.join('\n') })} />
              {origins.length === 0 && (
                data.env_origins.length > 0 ? (
                  <p className="m-0 text-xs text-shop-muted">
                    {translate('While empty, the server setting is used: {value0}', { value0: data.env_origins.join(', ') })}
                  </p>
                ) : (
                  <p className="m-0 flex items-start gap-1.5 rounded-lg bg-warn-bg px-3 py-2 text-xs text-amber-900">
                    <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                    {translate('Any website can use chats that have no list of their own.')}
                  </p>
                )
              )}
            </div>
          </div>
          <ChatPreview
            color={color}
            language={lang}
            side={(draft.look.side || (lang === 'ar' ? 'left' : 'right')) as 'left' | 'right'}
            title={draft.look.title || DEFAULT_CHAT_TEXT[lang].title}
            greeting={draft.look.greeting || DEFAULT_CHAT_TEXT[lang].greeting}
            enabled={draft.look.enabled}
            site={origins[0]}
          />
        </div>
      </section>

      <details className="rounded-[10px] border border-shop-border bg-white p-4 sm:p-5">
        <summary className="cursor-pointer text-[15px] font-bold">{translate('Shared code without a user')}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="m-0 text-sm text-shop-muted">
            {translate('Code pasted before chats had a user keeps working with these defaults. Its leads are not given to anyone: assign them from the Leads page.')}
          </p>
          <InstallBox snippet={embedSnippet(data.script_url)} testUrl={data.test_page_url} />
        </div>
      </details>

      <SaveBar
        visible={dirty}
        saving={saving}
        error={error}
        label={translate('Save agency settings')}
        onSave={() => void save()}
        onDiscard={() => { setDraft(initial()); setError(null) }}
      />
    </div>
  )
}
