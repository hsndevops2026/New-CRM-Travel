import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'

const auth = vi.hoisted(() => ({
  value: {
    admin: null as unknown,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.value }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/inbox" element={<div>inbox home</div>} />
        <Route path="/portal" element={<div>portal home</div>} />
        <Route path="/leads/hotel" element={<div>leads home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.value = {
    admin: null,
    loading: false,
    login: vi.fn(() => Promise.resolve({ id: '1', email: 'layla@horizon.ae', role: 'admin' })),
    signup: vi.fn(() => Promise.resolve()),
    logout: vi.fn(),
  }
})

describe('LoginPage', () => {
  it('asks for the work email and password, with a way to request access', () => {
    renderAt('/login')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Request access' }).getAttribute('href')).toBe('/signup')
  })

  it('signs in with the trimmed email and goes home', async () => {
    renderAt('/login')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  layla@horizon.ae ' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('inbox home')
    expect(auth.value.login).toHaveBeenCalledWith('layla@horizon.ae', 'correct-horse')
  })

  it('says what went wrong, marks the password invalid, and stays on the form', async () => {
    auth.value.login = vi.fn(() => Promise.reject(new Error('Invalid email or password')))
    renderAt('/login')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password')
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('home')).toBeNull()
  })

  it('shows and hides the password, and announces which', () => {
    renderAt('/login')
    const field = screen.getByLabelText('Password') as HTMLInputElement
    expect(field.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field.type).toBe('text')
    const hide = screen.getByRole('button', { name: 'Hide password' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(hide)
    expect(field.type).toBe('password')
  })

  it('goes straight on when already signed in', () => {
    auth.value.admin = { id: '1', email: 'a@b.co', role: 'admin' }
    renderAt('/login')
    expect(screen.getByText('inbox home')).toBeTruthy()
  })
})

describe('SignupPage', () => {
  const fill = (email: string, pw: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } })
  }

  it('tells the person, as they type, which password rules are met', () => {
    renderAt('/signup')
    const rules = screen.getByRole('list', { name: 'Password requirements' })
    expect(within(rules).getByText(/8\+ characters/).textContent).toMatch(/not met yet/)
    fill('o@h.ae', 'longenough', 'different')
    expect(within(rules).getByText(/8\+ characters/).textContent).toMatch(/— met/)
    expect(within(rules).getByText(/Passwords match/).textContent).toMatch(/not met yet/)
    fill('o@h.ae', 'longenough', 'longenough')
    expect(within(rules).getByText(/Passwords match/).textContent).toMatch(/— met/)
  })

  it('cannot be sent until the email is filled and both rules are met', () => {
    renderAt('/signup')
    const send = screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fill('o@h.ae', 'short', 'short')
    expect(send.disabled).toBe(true)
    fill('', 'longenough', 'longenough')
    expect(send.disabled).toBe(true)
    fill('o@h.ae', 'longenough', 'longenough')
    expect(send.disabled).toBe(false)
  })

  it('submits, then shows the waiting-for-approval state with the email and a way back', async () => {
    renderAt('/signup')
    fill(' omar@horizon.ae ', 'longenough', 'longenough')
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeTruthy()
    expect(auth.value.signup).toHaveBeenCalledWith('omar@horizon.ae', 'longenough')
    expect(screen.getByText('omar@horizon.ae')).toBeTruthy()
    const steps = screen.getByRole('list')
    expect(within(steps).getByText('Admin review').closest('li')?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login')
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('shows the server’s reason when the request is refused, and keeps the form', async () => {
    auth.value.signup = vi.fn(() => Promise.reject(new Error('Email already registered')))
    renderAt('/signup')
    fill('omar@horizon.ae', 'longenough', 'longenough')
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Email already registered')
    expect(screen.queryByRole('heading', { name: 'Waiting for approval' })).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send request' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('does not promise an email — nothing sends one', async () => {
    renderAt('/signup')
    fill('o@h.ae', 'longenough', 'longenough')
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await screen.findByRole('heading', { name: 'Waiting for approval' })
    expect(document.body.textContent).not.toMatch(/we.?ll email|you.?ll get an email/i)
  })
})
