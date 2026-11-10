import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LanguageProvider, t } from './i18n'
import ar from '../locales/ar.json'
import en from '../locales/en.json'
import AppLayout from '../layouts/AppLayout'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ admin: { id: 'language-test', email: 'staff@example.invalid', role: 'admin' }, logout: vi.fn() }),
}))
vi.mock('../hooks/useNavCounts', () => ({ useNavCounts: () => null }))
vi.mock('./agencySettings', () => ({
  fetchAgencySettings: () => Promise.resolve({ agency_name: 'Test agency' }),
}))

function layout(userId: string) {
  return <MemoryRouter><LanguageProvider userId={userId}><AppLayout /></LanguageProvider></MemoryRouter>
}

describe('staff interface languages', () => {
  it('has Arabic for every English key', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    expect(Object.values(ar).every((value) => value.trim().length > 0)).toBe(true)
  })

  it('starts in Arabic, switches the layout, and remembers the choice per user', async () => {
    localStorage.clear()
    const first = render(layout('first-user'))
    await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'rtl'))
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    const nav = screen.getAllByRole('navigation', { name: 'التنقّل الرئيسي' })[0]
    expect(within(nav).getByRole('link', { name: 'صندوق الوارد' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'لغة الواجهة' }), { target: { value: 'en' } })
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' })[0]).toBeInTheDocument()
    first.unmount()
    const second = render(layout('second-user'))
    await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'rtl'))
    second.unmount()
    render(layout('first-user'))
    await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'ltr'))
    expect(t('Sign in')).toBe('Sign in')
  })

  it('works when localStorage is unavailable', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
    try {
      render(layout('no-storage'))
      await waitFor(() => expect(document.documentElement).toHaveAttribute('dir', 'rtl'))
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } })
      expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})
