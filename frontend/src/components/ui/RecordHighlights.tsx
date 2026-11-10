import { t as translate, useI18n } from '../../lib/i18n'
type Fact = {
  label: string
  value: string
}

type Props = {
  facts: Fact[]
}

export default function RecordHighlights({ facts }: Props) {
  useI18n()
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={translate(fact.label)} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-shop-muted">{translate(fact.label)}</dt>
          <dd title={fact.value} className="truncate text-sm font-medium text-shop-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
