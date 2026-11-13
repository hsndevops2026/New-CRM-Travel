import { useRef, useState, type ChangeEvent } from 'react'
import { Plug, Puzzle, Trash2, Upload } from 'lucide-react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Field from '../ui/Field'
import ModalDrawer from '../ui/ModalDrawer'
import StatusBadge from '../ui/StatusBadge'
import { useToast } from '../../hooks/useToast'
import { t, useI18n } from '../../lib/i18n'
import {
  addConnector,
  installBundle,
  readFileAsBase64,
  removeAddon,
  type Addon,
  type AssistantState,
} from '../../lib/assistant'

type Props = {
  open: boolean
  state: AssistantState
  onClose: () => void
  onStateChange: (state: AssistantState) => void
}

type Scope = 'user' | 'agency'

const inputClass =
  'h-9 w-full rounded-lg border border-line-strong bg-white px-3 text-sm placeholder:text-shop-muted focus:border-shop-accent max-sm:h-11'
const MAX_ZIP_BYTES = 7 * 1024 * 1024

function ScopeSelect({ id, value, onChange, canAgency }: { id: string; value: Scope; onChange: (scope: Scope) => void; canAgency: boolean }) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as Scope)} className={inputClass}>
      <option value="user">{t('Just me')}</option>
      {canAgency && <option value="agency">{t('Everyone in the agency')}</option>}
    </select>
  )
}

function AddonRow({ addon, canRemove, onStateChange }: { addon: Addon; canRemove: boolean; onStateChange: (state: AssistantState) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const Icon = addon.kind === 'skill' ? Puzzle : Plug
  const remove = () => {
    setBusy(true)
    removeAddon(addon.id)
      .then(onStateChange)
      .catch((error: unknown) => {
        toast.show({ message: error instanceof Error ? error.message : t('Could not remove it'), tone: 'error' })
      })
      .finally(() => setBusy(false))
  }
  return (
    <li className="flex items-center gap-3 rounded-[10px] border border-shop-border px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tint text-shop-accent">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <strong className="truncate text-sm">{addon.name}</strong>
        <span className="truncate text-xs text-shop-muted">
          {addon.kind === 'skill' ? addon.description || t('Custom skill') : addon.url}
        </span>
      </div>
      {!addon.available && <StatusBadge label={t('Other key')} tone="warning" />}
      <StatusBadge label={t(addon.scope === 'agency' ? 'Agency' : 'Mine')} tone="neutral" />
      {canRemove && (
        <Button variant="ghost" size="sm" iconOnly aria-label={t('Remove {value0}', { value0: addon.name })} icon={<Trash2 />} loading={busy} onClick={remove} />
      )}
    </li>
  )
}

export default function AddonsModal({ open, state, onClose, onStateChange }: Props) {
  useI18n()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [bundleScope, setBundleScope] = useState<Scope>('user')
  const [installing, setInstalling] = useState(false)
  const [result, setResult] = useState<{ installed: string[]; skipped: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [connectorScope, setConnectorScope] = useState<Scope>('user')
  const [adding, setAdding] = useState(false)
  const [connectorError, setConnectorError] = useState<string | null>(null)

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    if (file.size > MAX_ZIP_BYTES) {
      setError(t('That archive is larger than 7 MB'))
      return
    }
    setInstalling(true)
    try {
      const next = await installBundle(await readFileAsBase64(file), bundleScope)
      onStateChange(next)
      setResult({ installed: next.installed.map((addon) => addon.name), skipped: next.skipped })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('The archive could not be installed'))
    } finally {
      setInstalling(false)
    }
  }

  const submitConnector = () => {
    setAdding(true)
    setConnectorError(null)
    addConnector({ name, url, token, scope: connectorScope })
      .then((next) => {
        onStateChange(next)
        setName('')
        setUrl('')
        setToken('')
        toast.show({ message: t('Connector added. Switch it on in the Tools menu.'), tone: 'success' })
      })
      .catch((err: unknown) => setConnectorError(err instanceof Error ? err.message : t('The connector could not be added')))
      .finally(() => setAdding(false))
  }

  return (
    <ModalDrawer
      open={open}
      onClose={onClose}
      title={t('Skills, plugins and connectors')}
      subtitle={t('Extend what Claude can do in the Assistant')}
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-bold">{t('Installed')}</h3>
          {state.addons.length === 0 ? (
            <p className="m-0 text-sm text-shop-muted">
              {t('Nothing installed yet. The built-in PowerPoint, Excel, Word and PDF skills are always available in the Tools menu.')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {state.addons.map((addon) => (
                <AddonRow
                  key={addon.id}
                  addon={addon}
                  canRemove={addon.scope === 'user' || state.can_manage_agency}
                  onStateChange={onStateChange}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-bold">{t('Install a skill or plugin')}</h3>
          <p className="m-0 text-sm text-shop-muted">
            {t('Upload a .zip. A skill is a folder containing a SKILL.md file. From a Claude Code plugin, its skills and remote connectors are installed; hooks, slash commands and subagents only work inside Claude Code and are skipped.')}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('Available to')} htmlFor="assistant-bundle-scope" className="min-w-[180px] flex-1">
              <ScopeSelect id="assistant-bundle-scope" value={bundleScope} onChange={setBundleScope} canAgency={state.can_manage_agency} />
            </Field>
            <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => void upload(event)} />
            <Button
              variant="primary"
              icon={<Upload />}
              loading={installing}
              disabled={state.connections.anthropic.active === null}
              onClick={() => fileRef.current?.click()}
            >
              {t('Choose .zip')}
            </Button>
          </div>
          {state.connections.anthropic.active === null && (
            <p className="m-0 text-xs text-shop-muted">{t('Connect Claude first — skills are uploaded to your Claude account.')}</p>
          )}
          {error && <Banner tone="danger" title={t('Nothing was installed')}>{error}</Banner>}
          {result && (
            <Banner tone="success" title={t('Installed: {value0}', { value0: result.installed.join(', ') })}>
              {result.skipped.length > 0 ? t('Skipped — {value0}', { value0: result.skipped.join('; ') }) : t('Switch it on in the Tools menu.')}
            </Banner>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-bold">{t('Add a connector')}</h3>
          <p className="m-0 text-sm text-shop-muted">
            {t('A connector is a remote MCP server that gives Claude tools from another service. Only add servers you trust: Claude will send them parts of your conversation.')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Name')} htmlFor="assistant-connector-name">
              <input id="assistant-connector-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('e.g. Notion')} className={inputClass} />
            </Field>
            <Field label={t('Available to')} htmlFor="assistant-connector-scope">
              <ScopeSelect id="assistant-connector-scope" value={connectorScope} onChange={setConnectorScope} canAgency={state.can_manage_agency} />
            </Field>
            <Field label={t('Server URL')} htmlFor="assistant-connector-url" className="sm:col-span-2">
              <input id="assistant-connector-url" type="url" dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" className={inputClass} />
            </Field>
            <Field label={t('Access token (optional)')} hint={t('Sent to the server as a Bearer token. Stored encrypted.')} htmlFor="assistant-connector-token" className="sm:col-span-2">
              <input id="assistant-connector-token" type="password" dir="ltr" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} className={inputClass} />
            </Field>
          </div>
          {connectorError && <p role="alert" className="m-0 text-xs text-danger">{connectorError}</p>}
          <div>
            <Button variant="primary" icon={<Plug />} loading={adding} disabled={!name.trim() || !url.trim()} onClick={submitConnector}>
              {t('Add connector')}
            </Button>
          </div>
        </section>
      </div>
    </ModalDrawer>
  )
}
