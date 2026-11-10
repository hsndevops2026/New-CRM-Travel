import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StagePath from './StagePath'

describe('StagePath', () => {
  it('shows all nine stages of a lead’s life, including drafting and accepted', () => {
    render(<StagePath current="comparing" />)
    for (const label of [
      'Intake', 'Sourcing', 'Awaiting dealers', 'Comparing', 'Drafting', 'Ready', 'Sent', 'Accepted', 'Booked',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('marks the current stage and reports a click on another one', () => {
    const onSelect = vi.fn()
    render(<StagePath current="awaiting_dealers" onSelect={onSelect} />)

    expect(screen.getByText('Awaiting dealers').closest('[aria-current="step"]')).toBeTruthy()
    fireEvent.click(screen.getByText('Comparing'))
    expect(onSelect).toHaveBeenCalledWith('comparing')
  })

  it('does not re-select the stage the lead is already in', () => {
    // Regression: clicking the active stage sent a same-to-same transition,
    // which the API rejected with "Cannot transition from 'sourcing' to 'sourcing'".
    const onSelect = vi.fn()
    render(<StagePath current="sourcing" onSelect={onSelect} />)

    fireEvent.click(screen.getByText('Sourcing'))
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Comparing'))
    expect(onSelect).toHaveBeenCalledWith('comparing')
  })

  it('only offers stages the API accepts from the current one', () => {
    // Regression: every stage was clickable, so clicking "Intake" from 'comparing' returned
    // "Cannot transition lifecycle from 'comparing' to 'intake'".
    const onSelect = vi.fn()
    render(
      <StagePath
        current="comparing"
        allowed={['drafting', 'sourcing', 'archived', 'lost']}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByText('Intake'))
    fireEvent.click(screen.getByText('Sent'))
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Sourcing'))
    expect(onSelect).toHaveBeenCalledWith('sourcing')
    fireEvent.click(screen.getByText('Drafting'))
    expect(onSelect).toHaveBeenCalledWith('drafting')
  })

  it('renders steps the lead cannot move to as plain text, not buttons', () => {
    render(<StagePath current="comparing" allowed={['drafting']} onSelect={() => {}} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Drafting'])
  })

  it('shows a single badge instead of the path for a lost lead, with Reopen', () => {
    const onSelect = vi.fn()
    render(<StagePath current="lost" allowed={['intake']} onSelect={onSelect} />)

    expect(screen.getByText('Lost')).toBeTruthy()
    expect(screen.queryByText('Sourcing')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onSelect).toHaveBeenCalledWith('intake')
  })

  it('offers no Reopen for an archived lead, which the API cannot reopen', () => {
    render(<StagePath current="archived" allowed={[]} onSelect={() => {}} />)
    expect(screen.getByText('Archived')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('is read-only while a change is being saved', () => {
    const onSelect = vi.fn()
    render(<StagePath current="sourcing" onSelect={onSelect} disabled />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
