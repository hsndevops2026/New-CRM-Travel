import { t as translate, useI18n } from '../../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import {
  airportOptions,
  hotelOptions,
  searchAirports,
  searchHotelPlaces,
} from '../../lib/places'

type Option = { value: string; label: string; hint: string | null }

type Props = {
  /** 'airport' → Google Flights autocomplete; 'hotel' → Google Hotels autocomplete. */
  mode: 'airport' | 'hotel'
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  className?: string
  id?: string
}

const DEBOUNCE_MS = 250
const MIN_CHARS = 2

/**
 * Typeahead over the SerpApi autocomplete endpoints.
 *
 * Stays a plain text input — a free-typed value is always accepted, since the
 * quoting pipeline resolves names server-side anyway. Suggestions are a
 * convenience for agents, not a required selection.
 */
export default function PlaceAutocomplete({
  mode,
  value,
  onChange,
  placeholder,
  required,
  className = '',
  id,
}: Props) {
  useI18n()
  const [options, setOptions] = useState<Option[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(-1)

  // Suppress the lookup that would otherwise fire right after picking an option.
  const skipNextRef = useRef(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const query = value.trim()
      if (query.length < MIN_CHARS) {
        setOptions([])
        setError(null)
        setOpen(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const next =
          mode === 'airport'
            ? airportOptions((await searchAirports(query, controller.signal)).suggestions)
            : hotelOptions((await searchHotelPlaces(query, controller.signal)).suggestions)

        setOptions(next.slice(0, 8))
        setHighlight(-1)
        setOpen(next.length > 0)
      } catch (err) {
        if (controller.signal.aborted) return
        // Autocomplete is optional polish — never block typing on a failed lookup.
        setOptions([])
        setError(err instanceof Error ? err.message : 'Lookup failed')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, mode])

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const choose = (option: Option) => {
    skipNextRef.current = true
    onChange(option.value)
    setOpen(false)
    setOptions([])
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !options.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((prev) => (prev + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((prev) => (prev <= 0 ? options.length - 1 : prev - 1))
    } else if (event.key === 'Enter' && highlight >= 0) {
      event.preventDefault()
      choose(options[highlight])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        required={required}
        className={className}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setOpen(options.length > 0)}
        onKeyDown={onKeyDown}
      />

      {loading && (
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-shop-muted">
          …
        </span>
      )}

      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-shop-border bg-white py-1 shadow-lg">
          {options.map((option, index) => (
            <li key={`${option.value}-${index}`}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={`flex w-full flex-col items-start px-3 py-2 text-start text-sm ${
                  index === highlight ? 'bg-shop-bg' : ''
                }`}
              >
                <span className="font-medium">{translate(option.label)}</span>
                {option.hint && <span className="text-xs text-shop-muted">{option.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <span className="mt-1 block text-xs text-shop-muted">{translate(error)}</span>}
    </div>
  )
}
