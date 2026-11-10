import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Check, CircleAlert, Clock, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AuthBrand } from '../components/auth/AuthLayout'
import PasswordField from '../components/auth/PasswordField'
import Button from '../components/ui/Button'
import { passwordChecks } from '../lib/passwordRules'

export default function SignupPage() {
  const { admin, loading, signup } = useAuth()
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!loading && admin) {
    return <Navigate to="/" replace />
  }

  const checks = passwordChecks(password, confirm)
  const canSubmit = email.trim() !== '' && checks.every((c) => c.ok)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await signup(email.trim(), password)
      setSubmittedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center gap-8 bg-shop-bg px-6 py-10 text-shop-ink">
      <AuthBrand />

      {submittedAt ? (
        <section role="status" className="flex w-full max-w-[520px] flex-col gap-[18px] rounded-[14px] border border-shop-border bg-white p-7">
          <div aria-hidden="true" className="grid size-[52px] place-items-center rounded-[14px] bg-warn-bg text-warn-fg">
            <Clock className="size-[26px]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-extrabold">Waiting for approval</h1>
            <p className="text-slate-600">
              Your request for <strong>{email.trim()}</strong> went to the agency admins. Come back and sign in once
              they have approved it.
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col rounded-[10px] border border-shop-border p-0">
            <li className="flex items-center gap-3 border-b border-shop-border px-3.5 py-3">
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-shop-accent text-white">
                <Check className="size-3.5" />
              </span>
              <span className="flex-1">Request submitted</span>
              <span className="text-[13px] text-shop-muted tabular-nums">
                Today, {submittedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
            <li aria-current="step" className="flex items-center gap-3 border-b border-shop-border bg-[#FFFBEB] px-3.5 py-3">
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-full border-2 border-[#B45309]">
                <span className="size-2 rounded-full bg-[#B45309]" />
              </span>
              <span className="flex-1 font-semibold">Admin review</span>
              <span className="text-[13px] font-semibold text-warn-fg">In progress</span>
            </li>
            <li className="flex items-center gap-3 px-3.5 py-3">
              <span aria-hidden="true" className="size-6 rounded-full border-2 border-line-strong" />
              <span className="flex-1 text-shop-muted">Sign in to the CRM</span>
            </li>
          </ol>
          <div>
            <Link
              to="/login"
              className="inline-flex h-10 items-center rounded-lg border border-line-strong px-4 font-semibold hover:bg-neutral-bg"
            >
              Back to sign in
            </Link>
          </div>
        </section>
      ) : (
        <form
          aria-labelledby="su-h"
          onSubmit={(e) => void onSubmit(e)}
          className="flex w-full max-w-[460px] flex-col gap-4 rounded-[14px] border border-shop-border bg-white p-7"
        >
          <h1 id="su-h" className="text-2xl font-extrabold">Request staff access</h1>
          <p className="text-shop-muted">
            An administrator reviews every request before you can sign in. New accounts start with 3 lead credits.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-neutral-fg" htmlFor="su-e">Work email</label>
            <input
              id="su-e"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-[15px]"
            />
          </div>

          <PasswordField label="Password" id="su-p" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <PasswordField label="Confirm password" id="su-c" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />

          <ul aria-label="Password requirements" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {checks.map((check) => (
              <li key={check.id} className={`flex items-center gap-1.5 ${check.ok ? 'text-shop-accent' : 'text-slate-600'}`}>
                {check.ok ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                {check.label}
                <span className="sr-only">{check.ok ? ' — met' : ' — not met yet'}</span>
              </li>
            ))}
          </ul>

          {error && (
            <div role="alert" className="flex gap-2.5 rounded-[10px] bg-danger-bg px-3.5 py-3 text-[#7F1D1D]">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit} className="h-11 text-[15px] font-bold">
            Send request
          </Button>
          <p className="text-center text-slate-600">
            Already approved?{' '}
            <Link to="/login" className="font-bold text-shop-accent hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  )
}
