import { t as translate, useI18n } from '../../lib/i18n'
import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  label: string
  invalid?: boolean
}

/** Password input with a show/hide toggle (a 40px target, announced with its state). */
export default function PasswordField({ label, invalid, id, ...props }: Props) {
  useI18n()
  const [shown, setShown] = useState(false)
  const inputId = id ?? `pw-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-neutral-fg" htmlFor={inputId}>
        {translate(label)}
      </label>
      <div className="relative">
        <input
          {...props}
          id={inputId}
          type={shown ? 'text' : 'password'}
          aria-invalid={invalid || undefined}
          className={`h-11 w-full rounded-lg border bg-white pe-12 ps-3 text-[15px] ${
            invalid ? 'border-danger' : 'border-line-strong'
          }`}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? translate("Hide password") : translate("Show password")}
          aria-pressed={shown}
          className="absolute top-0.5 end-0.5 grid size-10 place-items-center rounded-md text-slate-600 hover:bg-neutral-bg"
        >
          {shown ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
