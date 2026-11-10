import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LeadWorkspaceTabs from './LeadWorkspaceTabs'

describe('LeadWorkspaceTabs', () => {
  it('lists the five steps in order and marks the current one', () => {
    render(<LeadWorkspaceTabs step="build" onSelect={() => {}} />)
    const nav = screen.getByRole('navigation', { name: 'Lead workspace steps' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.textContent?.replace(/^\d+/, '').trim())).toEqual(['Source', 'Dealers', 'Market', 'Build', 'Send'])
    expect(within(nav).getByRole('button', { name: /Build/ }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: /Source/ }).getAttribute('aria-current')).toBeNull()
  })

  it('numbers the steps', () => {
    render(<LeadWorkspaceTabs step="source" onSelect={() => {}} />)
    const send = screen.getByRole('button', { name: /Send/ })
    expect(send.textContent).toContain('5')
  })

  it('reports the chosen step', () => {
    const onSelect = vi.fn()
    render(<LeadWorkspaceTabs step="source" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Dealers/ }))
    expect(onSelect).toHaveBeenCalledWith('dealers')
  })

  it('shows a chip only on the steps that have something to say', () => {
    render(
      <LeadWorkspaceTabs
        step="source"
        onSelect={() => {}}
        badges={{ source: { label: '14', tone: 'neutral' }, dealers: { label: '1/3 replied', tone: 'warning' } }}
      />,
    )
    expect(screen.getByRole('button', { name: /Source.*14/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Dealers.*1\/3 replied/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Market/ }).textContent).not.toMatch(/\d\/\d|replied/)
  })
})
