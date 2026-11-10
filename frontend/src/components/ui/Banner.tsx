import type { ReactNode } from 'react'
import { Check, CircleAlert, Clock, X } from 'lucide-react'

type Tone = 'warning' | 'success' | 'danger'

type Props = {
  tone: Tone
  title: string
  children?: ReactNode
  action?: ReactNode
}

const STYLE: Record<Tone, { box: string; icon: ReactNode; role: 'alert' | 'status' }> = {
  warning: { box: 'bg-warn-bg text-[#78350F]', icon: <Clock className="size-4" />, role: 'alert' },
  success: { box: 'bg-shop-green-bg text-[#134E4A]', icon: <Check className="size-4" />, role: 'status' },
  danger: { box: 'bg-danger-bg text-[#7F1D1D]', icon: <CircleAlert className="size-4" />, role: 'alert' },
}

/** Inline banner (design system): what happened, what it means, what to do. */
export default function Banner({ tone, title, children, action }: Props) {
  const style = STYLE[tone]
  return (
    <div role={style.role} className={`flex gap-3 rounded-[10px] p-3.5 ${style.box}`}>
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {tone === 'danger' ? <X className="size-4" /> : style.icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <strong>{title}</strong>
        {children ? <span className="tabular-nums">{children}</span> : null}
        {action ? <div className="font-bold [&_a]:underline [&_button]:underline">{action}</div> : null}
      </div>
    </div>
  )
}
