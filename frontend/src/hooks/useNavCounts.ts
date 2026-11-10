import { useEffect, useState } from 'react'
import { fetchNavCounts, type NavCounts } from '../lib/navCounts'

const REFRESH_MS = 30_000

/**
 * The sidebar's numbers. They are a convenience, never a requirement: if the request fails
 * the badges simply stay hidden rather than showing an error in the chrome of every page.
 */
export function useNavCounts(enabled = true) {
  const [counts, setCounts] = useState<NavCounts | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const load = () => {
      fetchNavCounts(controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setCounts(next)
        })
        .catch(() => {
          /* keep showing the last good numbers */
        })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    const onRemindersChanged = () => load()
    window.addEventListener('reminders:changed', onRemindersChanged)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('reminders:changed', onRemindersChanged)
    }
  }, [enabled])

  return counts
}
