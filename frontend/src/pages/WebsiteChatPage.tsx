import { useEffect, useState } from 'react'
import AgencyChatPanel from '../components/webchat/AgencyChatPanel'
import AllChatsTable from '../components/webchat/AllChatsTable'
import MyChatPanel from '../components/webchat/MyChatPanel'
import Banner from '../components/ui/Banner'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { fetchAgencySettings } from '../lib/agencySettings'
import { t as translate, useI18n } from '../lib/i18n'
import { fetchWebchatSettings, type WebchatSettingsResponse } from '../lib/webchat'

/**
 * Website chat: every user's own chat bubble for their websites (leads from it are theirs),
 * plus, for admins, the agency defaults and everyone's chats.
 */
export default function WebsiteChatPage() {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const [agencyColor, setAgencyColor] = useState('#0f766e')
  const [data, setData] = useState<WebchatSettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Website chat · Horizon'
    fetchAgencySettings()
      .then((agency) => setAgencyColor(agency.primary_color))
      .catch(() => { /* the panels fall back to the default colour */ })
    fetchWebchatSettings()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load the chat settings'))
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={translate('Website chat')}
        subtitle={translate('Put a chat bubble on any website. Visitors chat with the same bot as on WhatsApp, and finished requests become leads.')}
      />
      {error && <Banner tone="danger" title={translate('The chat settings could not be loaded')}>{error}</Banner>}
      {!data && !error && <p className="text-sm text-shop-muted" aria-busy="true">{translate('Loading…')}</p>}
      {data && (
        <>
          <MyChatPanel
            key={`${data.my_widget.public_key}:${data.my_widget.updated_at ?? ''}`}
            data={data}
            onData={setData}
            agencyColor={agencyColor}
          />
          {isAdmin && <AllChatsTable data={data} onData={setData} />}
          {isAdmin && (
            <AgencyChatPanel key={data.settings.updated_at ?? ''} data={data} onData={setData} agencyColor={agencyColor} />
          )}
        </>
      )}
    </div>
  )
}
