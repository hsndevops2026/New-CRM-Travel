import { t as translate, useI18n } from '../lib/i18n'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import AuthLayout from '../components/auth/AuthLayout'
import PasswordField from '../components/auth/PasswordField'
import Button from '../components/ui/Button'
import { homePathFor, isCustomer } from '../lib/auth'

export default function LoginPage() {
  useI18n()
  const { admin, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const from = (location.state as { from?: string } | null)?.from || ''

  if (!loading && admin) {
    const fallback = homePathFor(admin)
    const target =
      from && !(isCustomer(admin) && !from.startsWith('/portal')) && !(!isCustomer(admin) && from.startsWith('/portal'))
        ? from
        : fallback
    return <Navigate to={target || fallback} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const session = await login(email.trim(), password)
      const fallback = homePathFor(session)
      const target =
        from &&
        ((isCustomer(session) && from.startsWith('/portal')) ||
          (!isCustomer(session) && !from.startsWith('/portal')))
          ? from
          : fallback
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthLayout>
      <form className="flex w-full max-w-[380px] flex-col gap-5" aria-labelledby="si-h" onSubmit={(e) => void onSubmit(e)}>
        <div className="flex flex-col gap-1.5">
          <h1 id="si-h" className="text-[26px] font-extrabold tracking-[-0.01em]">{translate("Sign in")}</h1>
          <p className="text-shop-muted">{translate("Staff and customer portal accounts use email and password.")}</p>
        </div>

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-[10px] bg-danger-bg px-3.5 py-3 text-[#7F1D1D]">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{translate(error)}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-neutral-fg" htmlFor="si-email">{translate("Email")}</label>
          <input
            id="si-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-[15px]"
          />
        </div>

        <PasswordField
          label={translate("Password")}
          id="si-pw"
          autoComplete="current-password"
          required
          minLength={8}
          invalid={Boolean(error)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" variant="primary" loading={saving} className="h-11 text-[15px] font-bold">
          {saving ? translate("Signing in…") : translate("Sign in")}
        </Button>

        <div className="h-px bg-shop-border" />
        <p className="text-center text-slate-600">
          {translate("Agency staff?")}{' '}
          <Link to="/signup" className="font-bold text-shop-accent hover:underline">
            {translate("Request access")}</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
