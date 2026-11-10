type Fact = {
  label: string
  value: string
}

type Props = {
  facts: Fact[]
}

export default function RecordHighlights({ facts }: Props) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-shop-muted">{fact.label}</dt>
          <dd title={fact.value} className="truncate text-sm font-medium text-shop-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
