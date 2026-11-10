import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Button from './Button'
import FilterPills from './FilterPills'
import LifecycleBadge from './LifecycleBadge'
import SegmentedControl from './SegmentedControl'
import { HighlightBadge, SourceBadge } from './SourceBadge'
import StatusBadge from './StatusBadge'

describe('LifecycleBadge', () => {
  it('names every stage the way the design does', () => {
    const expected: Record<string, string> = {
      intake: 'Intake', sourcing: 'Sourcing', awaiting_dealers: 'Awaiting dealers',
      comparing: 'Comparing', drafting: 'Drafting', ready_to_send: 'Ready to send',
      sent: 'Sent', accepted: 'Accepted', booked: 'Booked', lost: 'Lost', archived: 'Archived',
    }
    for (const [status, label] of Object.entries(expected)) {
      const { unmount } = render(<LifecycleBadge status={status} />)
      expect(screen.getByText(label)).toBeTruthy()
      unmount()
    }
  })

  it('treats a missing stage as intake, and shows an unknown stage under its own name', () => {
    const { rerender } = render(<LifecycleBadge status={null} />)
    expect(screen.getByText('Intake')).toBeTruthy()
    // A stage the backend adds later must stay visible, not be mislabelled "Intake".
    rerender(<LifecycleBadge status="something_new" />)
    expect(screen.getByText('Something new')).toBeTruthy()
    expect(screen.queryByText('Intake')).toBeNull()
  })

  it('never relies on colour alone: every badge has an icon or a dot', () => {
    for (const status of ['intake', 'sourcing', 'awaiting_dealers', 'comparing', 'drafting', 'ready_to_send', 'sent', 'accepted', 'booked', 'lost']) {
      const { container, unmount } = render(<LifecycleBadge status={status} />)
      expect(container.querySelector('[aria-hidden="true"]'), status).toBeTruthy()
      unmount()
    }
  })

  it('colours a failed or finished stage distinctly', () => {
    const { container: lost } = render(<LifecycleBadge status="lost" />)
    expect(lost.firstElementChild?.className).toContain('text-danger-fg')
    const { container: booked } = render(<LifecycleBadge status="booked" />)
    expect(booked.firstElementChild?.className).toContain('bg-shop-accent')
  })
})

describe('StatusBadge', () => {
  it('capitalises the first letter of a raw status without touching a cased label', () => {
    render(<><StatusBadge label="pending approval" /><StatusBadge label="Awaiting dealers" /></>)
    expect(screen.getByText('Pending approval')).toBeTruthy()
    expect(screen.getByText('Awaiting dealers')).toBeTruthy()
  })

  it('leaves version tags lower-case: "v2 locked", not "V2 locked"', () => {
    render(<StatusBadge label="v2 locked" />)
    expect(screen.getByText('v2 locked')).toBeTruthy()
  })

  it('still accepts the original tones', () => {
    for (const tone of ['neutral', 'success', 'warning', 'danger', 'info'] as const) {
      const { unmount } = render(<StatusBadge label={tone} tone={tone} />)
      unmount()
    }
  })
})

describe('SourceBadge / HighlightBadge', () => {
  it('labels where an option came from', () => {
    render(
      <>
        <SourceBadge source="dealer" /><SourceBadge source="flight_api" /><SourceBadge source="hotel_api" />
        <SourceBadge source="package" /><SourceBadge source="market" />
      </>,
    )
    for (const label of ['Dealer', 'Flight API', 'Hotel API', 'Package', 'Market ref.']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('numbers the lowest-price rank', () => {
    render(<><HighlightBadge kind="lowest" rank={2} /><HighlightBadge kind="best_value" /><HighlightBadge kind="ai_pick" /></>)
    expect(screen.getByText('Lowest #2')).toBeTruthy()
    expect(screen.getByText('Best value')).toBeTruthy()
    expect(screen.getByText('AI pick')).toBeTruthy()
  })
})

describe('Button', () => {
  it('fires onClick normally', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('blocks clicks and announces busy while loading, but keeps the label so width does not jump', () => {
    const onClick = vi.fn()
    render(<Button variant="primary" loading onClick={onClick}>Send quote</Button>)
    const button = screen.getByRole('button', { name: /Send quote/ })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.textContent).toContain('Send quote')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('goes grey when disabled, whatever its variant', () => {
    render(<Button variant="primary" disabled>Create version</Button>)
    const button = screen.getByRole('button', { name: 'Create version' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.className).toContain('text-slate-400')
    expect(button.className).not.toContain('bg-shop-accent')
  })

  it('makes danger a solid red button', () => {
    render(<Button variant="danger">Delete lead</Button>)
    expect(screen.getByRole('button').className).toContain('bg-danger')
  })

  it('renders an icon-only button that is reachable by its aria-label', () => {
    render(<Button iconOnly aria-label="More actions" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy()
  })
})

describe('FilterPills', () => {
  it('marks the active pill as pressed and shows counts', () => {
    const onChange = vi.fn()
    render(
      <FilterPills
        ariaLabel="Conversation type"
        value="all"
        onChange={onChange}
        items={[{ id: 'all', label: 'All', count: 48 }, { id: 'dealers', label: 'Dealers', count: 11 }]}
      />,
    )
    expect(screen.getByRole('button', { name: /All\s*48/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Dealers\s*11/ }))
    expect(onChange).toHaveBeenCalledWith('dealers')
  })
})

describe('SegmentedControl', () => {
  const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]

  it('wraps around with the arrow keys and keeps one tab stop', () => {
    const onChange = vi.fn()
    render(<SegmentedControl ariaLabel="Test" value="c" onChange={onChange} items={items} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '0'])
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('c')
  })
})
