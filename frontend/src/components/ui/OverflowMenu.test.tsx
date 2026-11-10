import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OverflowMenu from './OverflowMenu'

describe('OverflowMenu', () => {
  it('can render its menu in a high floating layer outside a clipped container', () => {
    const edit = vi.fn()
    const { container } = render(
      <div style={{ overflow: 'hidden', height: 20 }}>
        <OverflowMenu
          portal
          label="Quote actions"
          items={[{ id: 'edit', label: 'Edit', onClick: edit }]}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Quote actions' }))
    const menu = screen.getByRole('menu')
    expect(container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(menu.className).toContain('z-[120]')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(edit).toHaveBeenCalledOnce()
  })
})
