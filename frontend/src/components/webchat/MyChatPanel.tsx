import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import { locale, t as translate, useI18n } from '../../lib/i18n'
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
import { ChatPreview, InstallBox, LookFields, OriginsEditor, SaveBar, StepCard, Switch } from './ChatParts'

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-shop-border bg-white px-4 py-3">
      <span className="text-xs font-semibold text-shop-muted">{label}</span>
      <span className="text-lg font-bold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-shop-muted">{hint}</span>}
    </div>
  )
}

/**
 * The signed-in user's own chat: their code, their websites, their look. Leads from it are theirs.
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

  const origins = useMemo(() => parseOrigins(draft.origins_text).origins, [draft.origins_text])
  const dirty = JSON.stringify(draft) !== JSON.stringify(toLookDraft(widget))
  const set = (patch: Partial<LookDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const agencyColorNow = agency.color || agencyColor || '#0f766e'
  const lang = (draft.language || agency.language) as 'ar' | 'en'
  const side = (draft.side || agency.side || (lang === 'ar' ? 'left' : 'right')) as 'left' | 'right'
  const blockedBy = !agency.enabled ? 'agency' : !widget.owner_active ? 'account' : null
  const live = !blockedBy && draft.enabled
  const agencySites = agency.allowed_origins.length ? agency.allowed_origins : data.env_origins
  const effectiveSites = origins.length ? origins : agencySites
  const used = Boolean(widget.last_used_at)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onData(await saveMyWidget(lookPatch(draft, origins)))
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
    <div className="flex flex-col gap-4">
      {dialog}
      {blockedBy === 'agency' && (
        <Banner tone="warning" title={translate('An admin has switched website chats off for the agency')}>
          {translate('Your chat shows nothing until they switch it back on.')}
        </Banner>
      )}
      {blockedBy === 'account' && (
        <Banner tone="warning" title={translate('Your account is not approved')}>
          {translate('Your chat shows nothing until an admin approves your account.')}
        </Banner>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <div className="flex flex-col justify-center rounded-[10px] border border-shop-border bg-white px-4 py-3">
          <Switch
            checked={draft.enabled}
            disabled={Boolean(blockedBy)}
            onChange={(enabled) => set({ enabled })}
            label={translate(live ? 'Your chat is on' : 'Your chat is off')}
            description={translate(dirty && draft.enabled !== widget.enabled ? 'Save to apply' : live ? 'Visitors can chat with you' : 'Websites show nothing')}
          />
        </div>
        <Stat
          label={translate('Website leads')}
          value={widget.lead_count ?? 0}
          hint={<Link to="/leads/hotel" className="font-semibold text-shop-accent hover:underline">{translate('See your leads')}</Link>}
        />
        <Stat
          label={translate('Last visitor chat')}
          value={used
            ? new Date(widget.last_used_at as string).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
            : '—'}
          hint={used ? undefined : translate('No chats yet: try the test page')}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <StepCard
            id="wc-step-code"
            step={1}
            done={used}
            title={translate('Add the code to your website')}
            description={translate('Requests made in this chat become your leads: they appear in your Leads list and you get the notification.')}
          >
            <InstallBox snippet={embedSnippet(data.script_url, widget.public_key)} testUrl={widget.test_page_url} />
          </StepCard>

          <StepCard
            id="wc-step-sites"
            step={2}
            done={effectiveSites.length > 0}
            title={translate('Choose which websites can show it')}
            description={translate('A site that is not on the list gets nothing, even with your code. Add both addresses if the site has one with and one without "www".')}
          >
            <OriginsEditor id="wc-mine-origins" value={origins} onChange={(next) => set({ origins_text: next.join('\n') })} />
            {origins.length === 0 && (
              effectiveSites.length > 0 ? (
                <p className="m-0 text-xs text-shop-muted">
                  {translate('While empty, the agency list is used: {value0}', { value0: effectiveSites.map((o) => o.replace(/^https?:\/\//, '')).join(', ') })}
                </p>
              ) : (
                <p className="m-0 flex items-start gap-1.5 rounded-lg bg-warn-bg px-3 py-2 text-xs text-amber-900">
                  <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                  {translate('Any website can use your chat right now. Add your websites so nobody else can put your chat on their site.')}
                </p>
              )
            )}
          </StepCard>

          <StepCard
            id="wc-step-look"
            step={3}
            done={Boolean(widget.title || widget.greeting || widget.color)}
            title={translate('Make it look like your brand')}
            description={translate('Optional. Empty fields use the agency defaults shown in grey.')}
          >
            <LookFields
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
            />
          </StepCard>

          <section aria-labelledby="wc-code-safety" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-shop-border bg-white p-4 sm:p-5">
            <div className="min-w-0 flex-1">
              <h3 id="wc-code-safety" className="m-0 text-[15px] font-bold">{translate('Someone copied your code to another site?')}</h3>
              <p className="m-0 mt-0.5 text-sm text-shop-muted">
                {translate('Make a new code: the old one stops working at once, and you paste the new one into your own websites.')}
              </p>
            </div>
            <Button variant="danger" icon={<RefreshCw />} loading={rotating} onClick={() => void rotate()}>
              {translate('Make a new code')}
            </Button>
          </section>
        </div>

        <div className="lg:sticky lg:top-4">
          <ChatPreview
            color={draft.color || agencyColorNow}
            language={lang}
            side={side}
            title={draft.title || agency.title || DEFAULT_CHAT_TEXT[lang].title}
            greeting={draft.greeting || agency.greeting || DEFAULT_CHAT_TEXT[lang].greeting}
            enabled={live}
            site={effectiveSites[0]}
          />
        </div>
      </div>

      <SaveBar
        visible={dirty}
        saving={saving}
        error={error}
        label={translate('Save my chat')}
        onSave={() => void save()}
        onDiscard={() => { setDraft(toLookDraft(widget)); setError(null) }}
      />
    </div>
  )
}
