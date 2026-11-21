import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AgencyChatPanel from '../components/webchat/AgencyChatPanel'
import AllChatsTable from '../components/webchat/AllChatsTable'
import MyChatPanel from '../components/webchat/MyChatPanel'
import Banner from '../components/ui/Banner'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { Skeleton } from '../components/ui/Skeleton'
import { useAuth } from '../context/AuthContext'
import { fetchAgencySettings } from '../lib/agencySettings'
import { t as translate, useI18n } from '../lib/i18n'
import { fetchWebchatSettings, type WebchatSettingsResponse } from '../lib/webchat'

type Tab = 'mine' | 'all' | 'agency'

/**
 * Website chat: every user's own chat bubble for their websites (leads from it are theirs),
 * plus, for admins, everyone's chats and the agency settings, each on its own tab.
 */
export default function WebsiteChatPage() {
  useI18n()
  const { admin } = useAuth()
  const isAdmin = admin?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: Tab = isAdmin && (requested === 'all' || requested === 'agency') ? requested : 'mine'
  const setTab = (next: Tab) => setParams(next === 'mine' ? {} : { tab: next }, { replace: true })
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

  const openChats = data?.widgets?.filter((w) => w.enabled && w.owner_active).length

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate('Website chat')}
        subtitle={translate('Put a chat bubble on any website. Visitors chat with the same bot as on WhatsApp, and finished requests become leads.')}
      />
      {isAdmin && (
        <div className="overflow-x-auto">
          <SegmentedControl
            ariaLabel="Website chat sections"
            value={tab}
            onChange={(id) => setTab(id as Tab)}
            items={[
              { id: 'mine', label: 'Your chat' },
              { id: 'all', label: 'Everyone\'s chats', count: openChats },
              { id: 'agency', label: 'Agency settings' },
            ]}
          />
        </div>
      )}
      {error && <Banner tone="danger" title={translate('The chat settings could not be loaded')}>{error}</Banner>}
      {!data && !error && (
        <div aria-busy="true" aria-label={translate('Loading…')} className="grid gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {data && tab === 'mine' && (
        <MyChatPanel
          key={`${data.my_widget.public_key}:${data.my_widget.updated_at ?? ''}`}
          data={data}
          onData={setData}
          agencyColor={agencyColor}
        />
      )}
      {data && tab === 'all' && <AllChatsTable data={data} onData={setData} />}
      {data && tab === 'agency' && (
        <AgencyChatPanel key={data.settings.updated_at ?? ''} data={data} onData={setData} agencyColor={agencyColor} />
      )}
    </div>
  )
}
