import { useState } from 'react'
import Button from '../ui/Button'
import ModalDrawer from '../ui/ModalDrawer'
import StatusBadge from '../ui/StatusBadge'
import { useToast } from '../../hooks/useToast'
import { t, useI18n } from '../../lib/i18n'
import {
  removeProviderKey,
  saveProviderKey,
  type ConnectionInfo,
  type AssistantState,
  type Provider,
} from '../../lib/assistant'

type Props = {
  open: boolean
  state: AssistantState
  onClose: () => void
  onStateChange: (state: AssistantState) => void
}

const inputClass =
  'h-9 w-full rounded-lg border border-line-strong bg-white px-3 text-sm placeholder:text-shop-muted focus:border-shop-accent max-sm:h-11'

function activeLabel(info: ConnectionInfo) {
  if (info.active === 'user') return t('Using your own key')
  if (info.active === 'agency') return t('Using the agency key')
  if (info.active === 'env') return t('Using the server key')
  return t('Not connected')
}

function KeyRow({
  provider,
  scope,
  title,
  description,
  saved,
  editable,
  placeholder,
  onStateChange,
}: {
  provider: Provider
  scope: 'user' | 'agency'
  title: string
  description: string
  saved: { hint: string } | null
  editable: boolean
  placeholder: string
  onStateChange: (state: AssistantState) => void
}) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputId = `assistant-key-${provider}-${scope}`

  const save = () => {
    setBusy('save')
    setError(null)
    saveProviderKey(provider, scope, value.trim())
      .then((next) => {
        onStateChange(next)
        setValue('')
        toast.show({ message: t('Key saved'), tone: 'success' })
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('The key could not be saved')))
      .finally(() => setBusy(null))
  }

  const remove = () => {
    setBusy('remove')
    setError(null)
    removeProviderKey(provider, scope)
      .then((next) => {
        onStateChange(next)
        toast.show({ message: t('Key removed'), tone: 'success' })
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('The key could not be removed')))
      .finally(() => setBusy(null))
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-shop-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={inputId} className="font-semibold">{title}</label>
          <p className="m-0 text-xs text-shop-muted">{description}</p>
        </div>
        {saved ? <StatusBadge label={t('Saved {value0}', { value0: saved.hint })} tone="success" /> : <StatusBadge label={t('Not set')} tone="neutral" />}
      </div>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            dir="ltr"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={saved ? t('Paste a new key to replace it') : placeholder}
            className={`${inputClass} min-w-[200px] flex-1`}
          />
          <Button variant="primary" onClick={save} loading={busy === 'save'} disabled={value.trim().length < 20 || busy !== null}>
            {t('Save')}
          </Button>
          {saved && (
            <Button onClick={remove} loading={busy === 'remove'} disabled={busy !== null}>
              {t('Remove')}
            </Button>
          )}
        </div>
      ) : (
        <p className="m-0 text-xs text-shop-muted">{t('Only an admin can change the agency key.')}</p>
      )}
      {error && <p role="alert" className="m-0 text-xs text-danger">{error}</p>}
    </div>
  )
}

function ProviderSection({
  provider,
  heading,
  blurb,
  keyUrl,
  placeholder,
  state,
  onStateChange,
}: {
  provider: Provider
  heading: string
  blurb: string
  keyUrl: string
  placeholder: string
  state: AssistantState
  onStateChange: (state: AssistantState) => void
}) {
  const info = state.connections[provider]
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-bold">{heading}</h3>
        <StatusBadge label={activeLabel(info)} tone={info.active ? 'success' : 'warning'} />
      </div>
      <p className="m-0 text-sm text-shop-muted">
        {blurb}{' '}
        <a href={keyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-shop-accent">
          {t('Get a key')}
        </a>
      </p>
      <KeyRow
        provider={provider}
        scope="agency"
        title={t('Agency key')}
        description={t('Shared by everyone in the agency. Usage is billed to this key.')}
        saved={info.agency}
        editable={state.can_manage_agency}
        placeholder={placeholder}
        onStateChange={onStateChange}
      />
      <KeyRow
        provider={provider}
        scope="user"
        title={t('My own key')}
        description={t('Used only for your chats, and takes priority over the agency key.')}
        saved={info.user}
        editable
        placeholder={placeholder}
        onStateChange={onStateChange}
      />
    </section>
  )
}

export default function ConnectionsModal({ open, state, onClose, onStateChange }: Props) {
  useI18n()
  return (
    <ModalDrawer open={open} onClose={onClose} title={t('Connections')} subtitle={t('Keys are stored encrypted and never shown again')}>
      <div className="flex flex-col gap-6">
        <ProviderSection
          provider="anthropic"
          heading={t('Claude')}
          blurb={t('Powers chat, skills and connectors. This needs an API key from the Claude Console — a claude.ai subscription (Pro, Max, Team) cannot be used in other apps.')}
          keyUrl="https://platform.claude.com/settings/keys"
          placeholder="sk-ant-…"
          state={state}
          onStateChange={onStateChange}
        />
        <ProviderSection
          provider="openai"
          heading={t('OpenAI — images and video')}
          blurb={t("Claude cannot create images or video itself, so those are made by OpenAI's models.")}
          keyUrl="https://platform.openai.com/api-keys"
          placeholder="sk-…"
          state={state}
          onStateChange={onStateChange}
        />
      </div>
    </ModalDrawer>
  )
}
