import { t as translate, useI18n } from '../../lib/i18n'
import { Columns3, List } from 'lucide-react'
import type { Lead } from '../../lib/leads'
import { formatDate, formatWhen, leadPerson, leadTitle } from '../../lib/leads'
import { LeadTypeBadge } from './LeadBadges'
import DataTable from '../ui/DataTable'
import OverflowMenu from '../ui/OverflowMenu'
import LifecycleBadge from '../ui/LifecycleBadge'
import SegmentedControl from '../ui/SegmentedControl'

type Props = {
  leads: Lead[]
  selected: Set<string>
  onToggleOne: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
  onChat: (id: string) => void
  onDelete: (id: string) => void
}

export default function LeadsTable({
  leads,
  selected,
  onToggleOne,
  onOpen,
  onChat,
  onDelete,
}: Props) {
  useI18n()
  return (
    <DataTable
      rows={leads}
      rowKey={(lead) => lead.id}
      emptyLabel="No leads found."
      onRowClick={(lead) => onOpen(lead.id)}
      columns={[
        {
          key: 'select',
          header: '',
          className: 'w-10',
          render: (lead) => (
            <input
              type="checkbox"
              aria-label={translate("Select {value0}", { value0: translate(String(leadPerson(lead))) })}
              checked={selected.has(lead.id)}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onToggleOne(lead.id, event.target.checked)}
            />
          ),
        },
        {
          key: translate("lead"),
          header: translate("Lead"),
          render: (lead) => (
            <div>
              <div className="font-semibold">{leadPerson(lead)}</div>
              <div className="text-shop-muted">{leadTitle(lead)}</div>
            </div>
          ),
        },
        {
          key: 'stage',
          header: translate('Stage'),
          render: (lead) => <LifecycleBadge status={lead.lifecycle_status} />,
        },
        {
          key: 'dates',
          header: translate("Dates"),
          className: 'whitespace-nowrap',
          render: (lead) => `${formatDate(lead.travel_date)} → ${formatDate(lead.return_date)}`,
        },
        {
          key: 'type',
          header: translate("Type"),
          render: (lead) => (
            <span className="inline-flex items-center gap-1">
              <LeadTypeBadge type={lead.booking_type} />
              {lead.quote_status === 'processing' && (
                <span className="text-xs text-amber-700">{translate("fetching")}</span>
              )}
            </span>
          ),
        },
        {
          key: 'created',
          header: translate("Created"),
          className: 'whitespace-nowrap text-shop-muted',
          render: (lead) => formatWhen(lead.created_at),
        },
        {
          key: 'actions',
          header: '',
          className: 'w-12',
          render: (lead) => (
            <div onClick={(event) => event.stopPropagation()}>
              <OverflowMenu
                items={[
                  { id: 'open', label: translate("Open"), onClick: () => onOpen(lead.id) },
                  { id: 'chat', label: translate('Chat'), onClick: () => onChat(lead.id) },
                  {
                    id: 'delete',
                    label: translate("Delete"),
                    tone: 'danger',
                    onClick: () => onDelete(lead.id),
                  },
                ]}
              />
            </div>
          ),
        },
      ]}
    />
  )
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'table' | 'board'
  onChange: (value: 'table' | 'board') => void
}) {
  useI18n()
  return (
    <SegmentedControl
      ariaLabel="View"
      value={value}
      onChange={(id) => onChange(id as 'table' | 'board')}
      items={[
        { id: 'table', label: translate('Table'), icon: <List strokeWidth={1.8} /> },
        { id: 'board', label: translate("Board"), icon: <Columns3 strokeWidth={1.8} /> },
      ]}
    />
  )
}
