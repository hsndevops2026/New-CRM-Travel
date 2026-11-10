import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastProvider'
import { useConfirm } from '../../hooks/useConfirm'
import { useToast } from '../../hooks/useToast'
import Banner from './Banner'
import ConfirmDialog from './ConfirmDialog'
import EmptyState from './EmptyState'
import { Skeleton, TableSkeleton } from './Skeleton'

afterEach(() => vi.useRealTimers())

describe('ConfirmDialog', () => {
  const base = { open: true, title: 'Revoke quote v1?', confirmLabel: 'Revoke v1', onConfirm: () => {}, onCancel: () => {} }

  it('renders nothing while closed', () => {
    render(<ConfirmDialog {...base} open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a labelled, described modal that lands focus on the safe choice', () => {
    render(<ConfirmDialog {...base} description="The link stops working." />)
    const dialog = screen.getByRole('dialog', { name: 'Revoke quote v1?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('confirms and cancels through the buttons, and cancels on Escape or a backdrop click', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { container } = render(<ConfirmDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke v1' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(container.firstElementChild as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not close when the dialog body itself is pressed', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...base} onCancel={onCancel} />)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps Tab inside the dialog', () => {
    render(<ConfirmDialog {...base} />)
    const confirm = screen.getByRole('button', { name: 'Revoke v1' })
    confirm.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('cannot be cancelled mid-request, and shows the busy state on the confirm button', () => {
    render(<ConfirmDialog {...base} busy />)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Revoke v1' }).getAttribute('aria-busy')).toBe('true')
  })
})

function ConfirmHarness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm()
  return (
    <>
      <button type="button" onClick={() => void confirm({ title: 'Delete it?', confirmLabel: 'Delete' }).then(onResult)}>
        ask
      </button>
      {dialog}
    </>
  )
}

describe('useConfirm', () => {
  it('resolves true on confirm and closes', async () => {
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves false on cancel and on Escape', async () => {
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    fireEvent.click(screen.getByText('ask'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByText('ask'))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2))
    expect(onResult).toHaveBeenLastCalledWith(false)
  })

  it('settles an earlier question as "no" when a new one replaces it', async () => {
    const results: boolean[] = []
    function Two() {
      const { confirm, dialog } = useConfirm()
      return (
        <>
          <button type="button" onClick={() => void confirm({ title: 'A?', confirmLabel: 'Yes' }).then((ok) => results.push(ok))}>
            first
          </button>
          <button type="button" onClick={() => void confirm({ title: 'B?', confirmLabel: 'Yes' }).then((ok) => results.push(ok))}>
            second
          </button>
          {dialog}
        </>
      )
    }
    render(<Two />)
    fireEvent.click(screen.getByText('first'))
    fireEvent.click(screen.getByText('second'))
    await waitFor(() => expect(results).toEqual([false]))
    expect(screen.getByRole('dialog', { name: 'B?' })).toBeTruthy()
  })
})

function ToastHarness() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast.show({ message: 'Saved', tone: 'success' })}>ok</button>
      <button type="button" onClick={() => toast.show({ message: 'Could not download', tone: 'error' })}>fail</button>
    </>
  )
}

describe('toasts', () => {
  it('announces success politely and errors assertively', () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('ok'))
    fireEvent.click(screen.getByText('fail'))
    expect(screen.getByRole('status').textContent).toContain('Saved')
    expect(screen.getByRole('alert').textContent).toContain('Could not download')
  })

  it('dismisses on its own — errors later than successes — or by hand', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('ok'))
    fireEvent.click(screen.getByText('fail'))
    act(() => void vi.advanceTimersByTime(4100))
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.getByText('Could not download')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Could not download')).toBeNull()
  })

  it('shows at most four at once, dropping the oldest', () => {
    function Many() {
      const toast = useToast()
      return (
        <button type="button" onClick={() => Array.from({ length: 6 }, (_, i) => toast.show({ message: `n${i}` }))}>
          go
        </button>
      )
    }
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('go'))
    expect(screen.queryByText('n0')).toBeNull()
    expect(screen.queryByText('n1')).toBeNull()
    expect(screen.getByText('n5')).toBeTruthy()
  })

  it('is harmless without a provider', () => {
    render(<ToastHarness />)
    expect(() => fireEvent.click(screen.getByText('ok'))).not.toThrow()
  })
})

describe('Banner', () => {
  it('interrupts for warnings and errors but not for good news', () => {
    const { rerender } = render(<Banner tone="warning" title="Waiting on 2 of 3 dealers" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<Banner tone="danger" title="WhatsApp disconnected" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<Banner tone="success" title="Sarah accepted v2" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the explanation and the action', () => {
    render(
      <Banner tone="warning" title="Waiting" action={<a href="#r">Send reminder</a>}>
        Sent 3 h ago.
      </Banner>,
    )
    expect(screen.getByText('Sent 3 h ago.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Send reminder' })).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('says what happened and offers the next step', () => {
    render(<EmptyState title="No conversations yet" description="New messages appear here." action={<button type="button">Check connection</button>} />)
    expect(screen.getByRole('heading', { name: 'No conversations yet' })).toBeTruthy()
    expect(screen.getByText('New messages appear here.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeTruthy()
  })

  it('hides its decorative icon from assistive tech', () => {
    const { container } = render(<EmptyState title="Nothing" tone="danger" icon={<svg data-testid="i" />} />)
    expect(container.querySelector('[aria-hidden="true"] [data-testid="i"]')).toBeTruthy()
  })
})

describe('Skeleton', () => {
  it('announces loading once, not once per placeholder', () => {
    const { container } = render(<TableSkeleton rows={3} label="Loading leads" />)
    const region = screen.getByRole('status', { name: 'Loading leads' })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(10)
  })

  it('is a decorative block', () => {
    const { container } = render(<Skeleton className="h-3 w-1/4" />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})
