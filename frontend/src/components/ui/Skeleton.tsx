type BlockProps = { className?: string }

/** A shimmering placeholder block. Size it with className (h-3 w-1/4, size-8 rounded-full…). */
export function Skeleton({ className = '' }: BlockProps) {
  return <div aria-hidden="true" className={`skeleton rounded-md ${className}`} />
}

/** Table-shaped loading placeholder: a header line, then avatar · text · pill rows. */
export function TableSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} role="status" className="flex flex-col gap-3.5 p-4">
      <div className="flex gap-3">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/5" />
        <Skeleton className="h-3 w-[15%]" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}
