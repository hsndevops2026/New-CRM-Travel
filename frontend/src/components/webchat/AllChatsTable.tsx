import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Button from '../ui/Button'
import StatusBadge from '../ui/StatusBadge'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import { locale, t as translate, useI18n } from '../../lib/i18n'
import { nameFromEmail } from '../../lib/people'
import { rotateWidgetKey, setWidgetEnabled, type WebchatSettingsResponse, type WebchatWidget } from '../../lib/webchat'
import { CARD } from './styles'

function lastUsed(value: string | null) {
  if (!value) return translate('Never')
  return new Date(value).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Admins: every user's chat, how many leads it brought, and switches for each. */
export default function AllChatsTable({ data, onData }: {
  data: WebchatSettingsResponse
  onData: (next: WebchatSettingsResponse) => void
}) {
  useI18n()
  const toast = useToast()
  const { confirm, dialog } = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const widgets = data.widgets || []

  const run = async (id: string, fn: () => Promise<WebchatSettingsResponse>, done: string) => {
    setBusy(id)
    try {
      onData(await fn())
      toast.show({ tone: 'success', message: done })
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to update the chat' })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (w: WebchatWidget) => run(
    w.id,
    () => setWidgetEnabled(w.id, !w.enabled),
    translate(w.enabled ? 'Chat of {value0} switched off.' : 'Chat of {value0} switched on.', { value0: nameFromEmail(w.owner_email) }),
  )

  const rotate = async (w: WebchatWidget) => {
    const ok = await confirm({
      title: translate('Make a new code for {value0}?', { value0: nameFromEmail(w.owner_email) }),
      description: translate('Their current code stops working at once. They will need to paste the new code into their websites.'),
      confirmLabel: translate('Make a new code'),
      tone: 'danger',
    })
    if (ok) await run(w.id, () => rotateWidgetKey(w.id), translate('New code made.'))
  }

  const status = (w: WebchatWidget) => {
    if (!w.owner_active) return <StatusBadge label={translate('Account not approved')} tone="warning" />
    if (!w.enabled) return <StatusBadge label={translate('Off')} tone="neutral" />
    if (!data.settings.enabled) return <StatusBadge label={translate('Off for the agency')} tone="neutral" />
    return <StatusBadge label={translate('On')} tone="success" />
  }

  return (
    <section aria-labelledby="wc-all" className={CARD}>
      {dialog}
      <h2 id="wc-all" className="text-base font-bold">{translate('Everyone\'s chats')}</h2>
      <p className="m-0 text-sm text-shop-muted">
        {translate('Each user has their own code. A chat appears here once its user has opened the Website chat page.')}
      </p>
      {widgets.length === 0 ? (
        <p className="m-0 text-sm text-shop-muted">{translate('No chats yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-shop-border text-start text-xs text-shop-muted">
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{translate('User')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{translate('Status')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{translate('Websites')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{translate('Website leads')}</th>
                <th scope="col" className="py-2 pe-3 text-start font-semibold">{translate('Last used')}</th>
                <th scope="col" className="py-2 text-end font-semibold"><span className="sr-only">{translate('Actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {widgets.map((w) => (
                <tr key={w.id} className="border-b border-shop-border last:border-0">
                  <td className="py-2.5 pe-3">
                    <div className="flex flex-col leading-tight">
                      <strong>{nameFromEmail(w.owner_email)}</strong>
                      <span className="text-xs text-shop-muted" dir="ltr">{w.owner_email}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pe-3">{status(w)}</td>
                  <td className="max-w-[220px] py-2.5 pe-3">
                    {w.allowed_origins.length ? (
                      <span className="block truncate text-xs" dir="ltr" title={w.allowed_origins.join('\n')}>
                        {w.allowed_origins.map((o) => o.replace(/^https?:\/\//, '')).join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs text-shop-muted">{translate('Agency list')}</span>
                    )}
                  </td>
                  <td className="py-2.5 pe-3 tabular-nums">{w.lead_count ?? 0}</td>
                  <td className="py-2.5 pe-3 text-xs text-shop-muted tabular-nums">{lastUsed(w.last_used_at)}</td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" loading={busy === w.id} disabled={busy !== null && busy !== w.id} onClick={() => void toggle(w)}>
                        {translate(w.enabled ? 'Switch off' : 'Switch on')}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<RefreshCw />} disabled={busy !== null} onClick={() => void rotate(w)}>
                        {translate('New code')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
