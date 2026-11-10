import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  block?: boolean
  /** Shows a spinner and blocks clicks, while keeping the button's width so nothing jumps. */
  loading?: boolean
  /** An icon before the label (16px). For an icon-only button use `iconOnly` + `aria-label`. */
  icon?: ReactNode
  /** Square button holding just an icon — needs an `aria-label`. */
  iconOnly?: boolean
  children?: ReactNode
}

const variantStyles: Record<Variant, string> = {
  primary: 'border-shop-accent bg-shop-accent text-white hover:border-primary-800 hover:bg-primary-800',
  secondary: 'border-line-strong bg-white text-shop-ink hover:bg-neutral-bg',
  danger: 'border-danger bg-danger text-white hover:border-danger-hover hover:bg-danger-hover',
  ghost: 'border-transparent bg-transparent text-neutral-fg hover:bg-neutral-bg',
}

// Design system: controls are 36px on desktop and 44px on touch screens.
const sizeStyles: Record<Size, string> = {
  md: 'h-9 px-3.5 text-[13px] max-sm:h-11',
  sm: 'h-8 px-2.5 text-xs max-sm:h-10',
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  iconOnly = false,
  className = '',
  disabled,
  children,
  ...props
}: Props) {
  const inactive = disabled || loading
  return (
    <button
      {...props}
      disabled={inactive}
      aria-busy={loading || undefined}
      className={`relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed ${
        // A disabled control is grey whatever its variant; a loading one keeps its colour.
        disabled && !loading
          ? 'border-shop-border bg-neutral-bg text-slate-400'
          : variantStyles[variant]
      } ${sizeStyles[size]} ${iconOnly ? 'w-9 px-0 max-sm:w-11' : ''} ${block ? 'w-full' : ''} ${className}`}
    >
      {/* The label stays in the layout while loading, so the button does not change width. */}
      <span className={`inline-flex items-center gap-1.5 ${loading ? 'invisible' : ''}`}>
        {icon && <span className="flex shrink-0 [&_svg]:size-4">{icon}</span>}
        {children}
      </span>
      {loading && (
        <LoaderCircle
          className="absolute size-4 motion-safe:animate-spin"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
    </button>
  )
}
