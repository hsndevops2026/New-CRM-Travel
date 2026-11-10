export function LeadStatusBadge({ status = 'new' }: { status?: string }) {
  const styles: Record<string, string> = {
    new: 'bg-shop-green-bg text-shop-green',
    contacted: 'bg-sky-100 text-sky-800',
    booked: 'bg-violet-100 text-violet-800',
    archived: 'bg-shop-gray-bg text-shop-muted',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
        styles[status] || styles.new
      }`}
    >
      {status}
    </span>
  )
}

export function LeadTypeBadge({ type }: { type: string }) {
  const styles =
    type === 'flight'
      ? 'bg-slate-800 text-white'
      : type === 'package'
        ? 'bg-indigo-100 text-indigo-900'
        : 'bg-amber-100 text-amber-900'
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${styles}`}>
      {type === 'package' ? 'flight+hotel' : type}
    </span>
  )
}
