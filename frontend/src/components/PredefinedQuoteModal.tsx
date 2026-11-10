import { t as translate, useI18n } from '../lib/i18n'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import ImageUpload from './ImageUpload'
import Button from './ui/Button'
import ModalDrawer from './ui/ModalDrawer'
import { useConfirm } from '../hooks/useConfirm'
import {
  MONTH_NAMES,
  createPredefinedQuote,
  deriveQuoteType,
  emptyFlightItem,
  emptyHotelItem,
  emptyReturnFlightItem,
  hasReturnFlight,
  itemsForQuoteType,
  quoteTypeLabel,
  updatePredefinedQuote,
  type AvailabilityMode,
  type PredefinedQuote,
  type PredefinedQuoteInput,
  type PredefinedQuoteItem,
  type QuoteType,
} from '../lib/predefinedQuotes'

type DraftItem = PredefinedQuoteItem & { key: string }

type Draft = {
  title: string
  origin: string
  destination: string
  availability_mode: AvailabilityMode
  available_months: number[]
  travel_date: string
  return_date: string
  adults_count: string
  children_count: string
  children_ages: string[]
  currency: string
  total_price: string
  description: string
  notes: string
  cover_image_url: string
  items: DraftItem[]
}

const ADULT_OPTIONS = Array.from({ length: 9 }, (_, i) => i + 1)
const CHILD_COUNT_OPTIONS = Array.from({ length: 7 }, (_, i) => i)
const CHILD_AGE_OPTIONS = Array.from({ length: 18 }, (_, i) => i)

function agesForCount(count: number, previous: string[] = []): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => previous[i] ?? '')
}

type Props = {
  open: boolean
  quote?: PredefinedQuote | null
  initialQuote?: PredefinedQuoteInput | null
  draftKey?: string
  title?: string
  submitLabel?: string
  onSubmitInput?: (input: PredefinedQuoteInput) => Promise<PredefinedQuote>
  onClose: () => void
  onSaved: (quote: PredefinedQuote) => void
}

const QUOTE_TYPE_OPTIONS: { value: QuoteType; label: string; hint: string }[] = [
  { value: 'hotel', label: 'Hotel quote', hint: 'One or more hotel stays' },
  { value: 'flight', label: 'Flight quote', hint: 'Outbound, optional return' },
  { value: 'package', label: 'Flight + Hotel', hint: 'Flights and hotel stays together' },
]

function newKey() {
  return crypto.randomUUID()
}

function withKeys(items: PredefinedQuoteItem[]): DraftItem[] {
  return items.map((item) => ({ ...item, key: item.id || newKey() }))
}

function emptyDraft(type: QuoteType = 'hotel'): Draft {
  return {
    title: '',
    origin: '',
    destination: '',
    availability_mode: 'fixed',
    available_months: [],
    travel_date: '',
    return_date: '',
    adults_count: '2',
    children_count: '0',
    children_ages: [],
    currency: 'USD',
    total_price: '',
    description: '',
    notes: '',
    cover_image_url: '',
    items: withKeys(itemsForQuoteType(type)),
  }
}

function toDraft(quote?: Partial<PredefinedQuote> | PredefinedQuoteInput | null): Draft {
  if (!quote) return emptyDraft('hotel')
  const childrenCount = Number(quote.children_count ?? 0) || 0
  const existingAges = Array.isArray(quote.children_ages)
    ? quote.children_ages.map((age) => String(age))
    : []
  return {
    title: quote.title || '',
    origin: quote.origin || '',
    destination: quote.destination || '',
    availability_mode: quote.availability_mode === 'period' ? 'period' : 'fixed',
    available_months: Array.isArray(quote.available_months) ? quote.available_months.map(Number) : [],
    travel_date: String(quote.travel_date || '').slice(0, 10),
    return_date: String(quote.return_date || '').slice(0, 10),
    adults_count: String(quote.adults_count ?? 2),
    children_count: String(childrenCount),
    children_ages: agesForCount(childrenCount, existingAges),
    currency: quote.currency || 'USD',
    total_price: quote.total_price == null ? '' : String(quote.total_price),
    description: quote.description || '',
    notes: quote.notes || '',
    cover_image_url: quote.cover_image_url || '',
    items: (quote.items || []).map((item) => ({
      ...item,
      key: item.id || newKey(),
      price: item.price ?? null,
      city: item.city || '',
      country: item.country || '',
    })),
  }
}

function optionalNumber(value: string | number | null | undefined) {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isNaN(number) ? null : number
}

function dateKey(value: string | null | undefined) {
  const text = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function syncTravelWindow(items: DraftItem[], travelDate: string, returnDate: string) {
  const hotels = items.filter((item) => item.item_type === 'hotel')
  const checkIns = hotels.map((item) => dateKey(item.check_in)).filter(Boolean).sort()
  const checkOuts = hotels.map((item) => dateKey(item.check_out)).filter(Boolean).sort()
  return {
    travel_date: travelDate || checkIns[0] || '',
    return_date: returnDate || checkOuts[checkOuts.length - 1] || '',
  }
}

function itemHasContent(item: DraftItem) {
  if (item.item_type === 'hotel') {
    return Boolean(
      item.hotel_name?.trim() ||
        item.city?.trim() ||
        item.country?.trim() ||
        item.check_in ||
        item.check_out ||
        item.price != null ||
        item.room_name?.trim() ||
        item.description?.trim(),
    )
  }
  return Boolean(
    item.airline?.trim() ||
      item.flight_number?.trim() ||
      item.departure_airport?.trim() ||
      item.arrival_airport?.trim() ||
      item.departure_city?.trim() ||
      item.arrival_city?.trim() ||
      item.price != null ||
      item.description?.trim(),
  )
}

function toPayload(draft: Draft): PredefinedQuoteInput {
  const window = syncTravelWindow(draft.items, draft.travel_date, draft.return_date)
  const hotels = draft.items.filter((item) => item.item_type === 'hotel')
  const destination =
    draft.destination.trim() || hotels.find((item) => item.city?.trim())?.city?.trim() || ''

  return {
    title: draft.title.trim(),
    origin: draft.origin.trim(),
    destination,
    availability_mode: draft.availability_mode,
    // Months only count for a period package, dates only for a fixed one.
    available_months: draft.availability_mode === 'period' ? draft.available_months : [],
    travel_date: draft.availability_mode === 'period' ? '' : window.travel_date,
    return_date: draft.availability_mode === 'period' ? '' : window.return_date,
    adults_count: Number(draft.adults_count) || 0,
    children_count: Number(draft.children_count) || 0,
    children_ages: draft.children_ages
      .map((age) => Number(age))
      .filter((age) => Number.isFinite(age)),
    currency: draft.currency.trim() || 'USD',
    total_price: optionalNumber(draft.total_price),
    description: draft.description.trim(),
    notes: draft.notes.trim(),
    cover_image_url: draft.cover_image_url,
    items: draft.items.map((item) => ({
      ...item,
      price: optionalNumber(item.price),
      nights: optionalNumber(item.nights),
      stops: optionalNumber(item.stops),
      city: item.city?.trim() || null,
      country: item.country?.trim() || null,
    })),
  }
}

function validateDraft(draft: Draft, quoteType: QuoteType): string | null {
  if (!draft.title.trim()) return 'Give this quote a title'
  if (!draft.items.length) return 'Add at least one hotel or flight'

  const childCount = Number(draft.children_count) || 0
  if (childCount > 0) {
    const missingAge = draft.children_ages
      .slice(0, childCount)
      .findIndex((age) => age === '' || !Number.isFinite(Number(age)))
    if (missingAge !== -1) return translate("Choose an age for child {value0}", { value0: translate(String(missingAge + 1)) })
  }

  const hotels = draft.items.filter((item) => item.item_type === 'hotel')
  const flights = draft.items.filter((item) => item.item_type === 'flight')

  if (quoteType === 'hotel' || quoteType === 'package') {
    if (!hotels.length) return 'Add at least one hotel stay'
    for (const [index, hotel] of hotels.entries()) {
      const label = translate("Hotel {value0}", { value0: translate(String(index + 1)) })
      if (!hotel.hotel_name?.trim()) return translate("{value0} needs a hotel name", { value0: translate(String(label)) })
      if (!hotel.city?.trim()) return translate("{value0} needs a city", { value0: translate(String(label)) })
      if (!hotel.country?.trim()) return translate("{value0} needs a country", { value0: translate(String(label)) })
      // A period package is for whole months, so its stays need no particular dates.
      if (draft.availability_mode === 'fixed') {
        const checkIn = dateKey(hotel.check_in)
        const checkOut = dateKey(hotel.check_out)
        if (!checkIn) return translate("{value0} needs a check-in date", { value0: translate(String(label)) })
        if (!checkOut) return translate("{value0} needs a check-out date", { value0: translate(String(label)) })
        if (checkOut <= checkIn) return translate("{value0} check-out must be after check-in", { value0: translate(String(label)) })
      }
    }
  }

  if (quoteType === 'flight' || quoteType === 'package') {
    if (!draft.origin.trim()) return 'Origin is required for flight quotes'
    if (!draft.destination.trim()) return 'Destination is required for flight quotes'
    if (!flights.length) return 'Add at least one flight'
    const outbound = flights.find((item) => item.direction !== 'return')
    if (!outbound) return 'Add an outbound flight'
    for (const [index, flight] of flights.entries()) {
      const label = flight.direction === 'return' ? 'Return flight' : translate("Flight {value0}", { value0: translate(String(index + 1)) })
      if (!flight.airline?.trim() && !flight.departure_airport?.trim() && !flight.departure_city?.trim()) {
        return translate("{value0} needs an airline or route", { value0: translate(String(label)) })
      }
    }
  }

  if (draft.availability_mode === 'period') {
    if (!draft.available_months.length) return 'Choose at least one month this package is available in'
    return null
  }

  const window = syncTravelWindow(draft.items, draft.travel_date, draft.return_date)
  if (window.travel_date && window.return_date && window.return_date < window.travel_date) {
    return 'Return date must be on or after travel date'
  }

  return null
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  useI18n()
  return (
    <label className={`grid gap-1 text-sm ${className}`}>
      <span className="font-medium">{translate(label)}</span>
      {children}
    </label>
  )
}

const inputClass = 'min-h-11 rounded-lg border border-shop-border px-3 py-2'
const compactSelectClass = `${inputClass} w-full`

function HotelFields({
  item,
  index,
  canRemove,
  period,
  onPatch,
  onRemove,
}: {
  item: DraftItem
  index: number
  canRemove: boolean
  /** Period packages are for whole months, so a stay has a length, not dates. */
  period: boolean
  onPatch: (patch: Partial<PredefinedQuoteItem>) => void
  onRemove: () => void
}) {
  useI18n()
  return (
    <article className="rounded-xl border border-shop-border bg-shop-bg/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{translate("Hotel")}{' '}{index + 1}</div>
        {canRemove && (
          <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={onRemove}>
            {translate("Remove")}</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={translate("Hotel name")} className="sm:col-span-2">
          <input
            required
            className={inputClass}
            value={item.hotel_name || ''}
            onChange={(e) => onPatch({ hotel_name: e.target.value })}
          />
        </Field>
        <Field label={translate("City")}>
          <input
            required
            className={inputClass}
            placeholder={translate("New York")}
            value={item.city || ''}
            onChange={(e) => onPatch({ city: e.target.value })}
          />
        </Field>
        <Field label={translate("Country")}>
          <input
            required
            className={inputClass}
            placeholder={translate("United States")}
            value={item.country || ''}
            onChange={(e) => onPatch({ country: e.target.value })}
          />
        </Field>
        <Field label={translate("Category")}>
          <input
            className={inputClass}
            placeholder={translate("5 star")}
            value={item.category || ''}
            onChange={(e) => onPatch({ category: e.target.value })}
          />
        </Field>
        <Field label={translate("Room")}>
          <input
            className={inputClass}
            value={item.room_name || ''}
            onChange={(e) => onPatch({ room_name: e.target.value })}
          />
        </Field>
        <Field label={translate("Board")}>
          <input
            className={inputClass}
            placeholder={translate("Breakfast")}
            value={item.board_name || ''}
            onChange={(e) => onPatch({ board_name: e.target.value })}
          />
        </Field>
        <Field label={translate("Price")}>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={item.price ?? ''}
            onChange={(e) => onPatch({ price: optionalNumber(e.target.value) })}
          />
        </Field>
        {period ? (
          <Field label={translate("Nights")} className="sm:col-span-2">
            <input
              type="number"
              min={1}
              className={inputClass}
              placeholder={translate("e.g. 7")}
              value={item.nights ?? ''}
              onChange={(e) => onPatch({ nights: optionalNumber(e.target.value) })}
            />
          </Field>
        ) : (
          <>
            <Field label={translate("Check-in")}>
              <input
                type="date"
                required
                className={inputClass}
                value={String(item.check_in || '').slice(0, 10)}
                onChange={(e) => onPatch({ check_in: e.target.value })}
              />
            </Field>
            <Field label={translate("Check-out")}>
              <input
                type="date"
                required
                className={inputClass}
                value={String(item.check_out || '').slice(0, 10)}
                onChange={(e) => onPatch({ check_out: e.target.value })}
              />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <ImageUpload label={translate("Hotel image")} value={item.image_url} onChange={(url) => onPatch({ image_url: url })} />
          <p className="mt-1.5 text-xs text-shop-muted">
            {translate("Leave blank to auto-fetch Google photos for this hotel and place when you save.")}</p>
          {Array.isArray(item.extra?.gallery_urls) && item.extra.gallery_urls.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto">
              {item.extra.gallery_urls.slice(0, 8).map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="size-12 shrink-0 rounded-md object-cover ring-1 ring-shop-border"
                />
              ))}
            </div>
          )}
        </div>
        <Field label={translate("Notes")} className="sm:col-span-2">
          <textarea
            rows={2}
            className="rounded-lg border border-shop-border px-3 py-2"
            value={item.description || ''}
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </Field>
      </div>
    </article>
  )
}

function FlightFields({
  item,
  label,
  onPatch,
}: {
  item: DraftItem
  label: string
  onPatch: (patch: Partial<PredefinedQuoteItem>) => void
}) {
  useI18n()
  return (
    <article className="rounded-xl border border-shop-border bg-shop-bg/40 p-4">
      <div className="mb-3 text-sm font-semibold">{translate(label)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={translate("Airline")}>
          <input
            className={inputClass}
            value={item.airline || ''}
            onChange={(e) => onPatch({ airline: e.target.value })}
          />
        </Field>
        <Field label={translate("Flight number")}>
          <input
            className={inputClass}
            placeholder="EK 512"
            value={item.flight_number || ''}
            onChange={(e) => onPatch({ flight_number: e.target.value })}
          />
        </Field>
        <Field label={translate("Price")}>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={item.price ?? ''}
            onChange={(e) => onPatch({ price: optionalNumber(e.target.value) })}
          />
        </Field>
        <Field label={translate("From airport")}>
          <input
            className={inputClass}
            placeholder="DXB"
            value={item.departure_airport || ''}
            onChange={(e) => onPatch({ departure_airport: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={translate("To airport")}>
          <input
            className={inputClass}
            placeholder="JFK"
            value={item.arrival_airport || ''}
            onChange={(e) => onPatch({ arrival_airport: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={translate("From city")}>
          <input
            className={inputClass}
            value={item.departure_city || ''}
            onChange={(e) => onPatch({ departure_city: e.target.value })}
          />
        </Field>
        <Field label={translate("To city")}>
          <input
            className={inputClass}
            value={item.arrival_city || ''}
            onChange={(e) => onPatch({ arrival_city: e.target.value })}
          />
        </Field>
        <Field label={translate("Depart time")}>
          <input
            className={inputClass}
            placeholder="10:30"
            value={item.departure_time || ''}
            onChange={(e) => onPatch({ departure_time: e.target.value })}
          />
        </Field>
        <Field label={translate("Arrive time")}>
          <input
            className={inputClass}
            placeholder="22:15"
            value={item.arrival_time || ''}
            onChange={(e) => onPatch({ arrival_time: e.target.value })}
          />
        </Field>
        <Field label={translate("Duration")}>
          <input
            className={inputClass}
            placeholder="7h 45m"
            value={item.duration || ''}
            onChange={(e) => onPatch({ duration: e.target.value })}
          />
        </Field>
        <Field label={translate("Stops")}>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={item.stops ?? 0}
            onChange={(e) => onPatch({ stops: optionalNumber(e.target.value) })}
          />
        </Field>
        <div className="sm:col-span-2">
          <ImageUpload label={translate("Flight image")} value={item.image_url} onChange={(url) => onPatch({ image_url: url })} />
        </div>
        <Field label={translate("Notes")} className="sm:col-span-2">
          <textarea
            rows={2}
            className="rounded-lg border border-shop-border px-3 py-2"
            value={item.description || ''}
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </Field>
      </div>
    </article>
  )
}

export default function PredefinedQuoteModal({
  open,
  quote,
  initialQuote,
  draftKey,
  title,
  submitLabel,
  onSubmitInput,
  onClose,
  onSaved,
}: Props) {
  useI18n()
  const { confirm, dialog } = useConfirm()
  const sourceQuote = quote || initialQuote
  const sessionKey = open ? (quote?.id ?? draftKey ?? (initialQuote ? 'import' : 'new')) : null
  const [formKey, setFormKey] = useState(sessionKey)
  const [draft, setDraft] = useState<Draft>(() => toDraft(sourceQuote))
  const [selectedType, setSelectedType] = useState<QuoteType>(() =>
    sourceQuote?.items?.length ? deriveQuoteType(sourceQuote.items) : 'hotel',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sessionKey !== formKey) {
    setFormKey(sessionKey)
    const next = toDraft(sourceQuote)
    setDraft(next)
    setSelectedType(next.items.length ? deriveQuoteType(next.items) : 'hotel')
    setError(null)
  }

  const quoteType = useMemo(() => deriveQuoteType(draft.items), [draft.items])
  const hotels = draft.items.filter((item) => item.item_type === 'hotel')
  const flights = draft.items.filter((item) => item.item_type === 'flight')
  const outboundFlight =
    flights.find((item) => item.direction !== 'return') || flights[0] || null
  const returnFlight = flights.find((item) => item.direction === 'return') || null
  const includeReturn = Boolean(returnFlight)
  const showHotels = selectedType === 'hotel' || selectedType === 'package'
  const showFlights = selectedType === 'flight' || selectedType === 'package'
  const showRouteFields = showFlights

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const patchItem = (key: string, patch: Partial<PredefinedQuoteItem>) => {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }))
  }

  const removeItem = (key: string) => {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((item) => item.key !== key) }))
  }

  const changeQuoteType = async (nextType: QuoteType) => {
    if (nextType === selectedType) return
    const removingHotels = nextType === 'flight' && hotels.some(itemHasContent)
    const removingFlights = nextType === 'hotel' && flights.some(itemHasContent)
    if (removingHotels || removingFlights) {
      const parts = [
        removingHotels ? 'hotel stays' : null,
        removingFlights ? 'flights' : null,
      ].filter(Boolean)
      const ok = await confirm({
        title: translate("Switch to {value0}?", { value0: translate(String(quoteTypeLabel(nextType))) }),
        description: translate("This removes the {value0} you entered.", { value0: translate(String(parts.join(' and '))) }),
        confirmLabel: 'Switch and remove',
      })
      if (!ok) return
    }
    applyQuoteType(nextType)
  }

  const applyQuoteType = (nextType: QuoteType) => {
    setSelectedType(nextType)
    setDraft((prev) => {
      const prevHotels = prev.items.filter((item) => item.item_type === 'hotel')
      const prevFlights = prev.items.filter((item) => item.item_type === 'flight')
      const prevOutbound =
        prevFlights.find((item) => item.direction !== 'return') || prevFlights[0] || null
      const prevReturn = prevFlights.find((item) => item.direction === 'return') || null

      if (nextType === 'hotel') {
        return {
          ...prev,
          items: prevHotels.length ? prevHotels : withKeys([emptyHotelItem()]),
        }
      }

      const nextOutbound = prevOutbound
        ? [{ ...prevOutbound, direction: 'outbound' as const }]
        : withKeys([emptyFlightItem({ direction: 'outbound' })])
      const nextReturn = prevReturn ? [prevReturn] : []

      if (nextType === 'flight') {
        return { ...prev, items: [...nextOutbound, ...nextReturn] }
      }

      return {
        ...prev,
        items: [
          ...(prevHotels.length ? prevHotels : withKeys([emptyHotelItem()])),
          ...nextOutbound,
          ...nextReturn,
        ],
      }
    })
    setError(null)
  }

  const toggleReturnFlight = (enabled: boolean) => {
    setDraft((prev) => {
      const withoutReturn = prev.items.filter(
        (item) => !(item.item_type === 'flight' && item.direction === 'return'),
      )
      if (!enabled) return { ...prev, items: withoutReturn }
      if (hasReturnFlight(prev.items)) return prev
      const outbound =
        withoutReturn.find((item) => item.item_type === 'flight' && item.direction !== 'return') ||
        withoutReturn.find((item) => item.item_type === 'flight')
      return {
        ...prev,
        items: [...withoutReturn, { ...emptyReturnFlightItem(outbound), key: newKey() }],
      }
    })
  }

  const addHotel = () => {
    setDraft((prev) => {
      const lastHotel = [...prev.items].reverse().find((item) => item.item_type === 'hotel')
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            ...emptyHotelItem({
              city: lastHotel?.city || '',
              country: lastHotel?.country || '',
              check_in: lastHotel?.check_out || '',
            }),
            key: newKey(),
          },
        ],
      }
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const validationError = validateDraft(draft, selectedType)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = toPayload(draft)
      const saved = onSubmitInput
        ? await onSubmitInput(payload)
        : quote
          ? await updatePredefinedQuote(quote.id, payload)
          : await createPredefinedQuote(payload)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quote')
    } finally {
      setSaving(false)
    }
  }

  const statusLine =
    quoteTypeLabel(selectedType) +
    ' · ' +
    (quoteTypeLabel(quoteType) === quoteTypeLabel(selectedType) ? 'ready to save' : 'choose what to include')

  return (
    <>
      <ModalDrawer
        open={open}
        title={title || (quote ? translate("Edit quote") : translate("Create quote"))}
        subtitle={statusLine}
        onClose={onClose}
        maxWidthClassName="max-w-4xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>
              {translate("Cancel")}</Button>
            <Button type="submit" form="predefined-quote-form" variant="primary" disabled={saving}>
              {saving ? translate("Saving…") : submitLabel || 'Save quote'}
            </Button>
          </div>
        }
      >
        <form id="predefined-quote-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="mb-2 text-sm font-medium">{translate("Quote type")}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {QUOTE_TYPE_OPTIONS.map((option) => {
                const active = selectedType === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void changeQuoteType(option.value)}
                    className={`rounded-xl border px-3 py-3 text-start transition ${
                      active
                        ? 'border-shop-accent bg-shop-accent/5 ring-1 ring-shop-accent'
                        : 'border-shop-border bg-white hover:bg-shop-bg'
                    }`}
                  >
                    <div className="text-sm font-semibold">{translate(option.label)}</div>
                    <div className="mt-0.5 text-xs text-shop-muted">{option.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sm:col-span-2 grid gap-4 sm:grid-cols-[minmax(0,1fr)_5.5rem]">
            <Field label={translate("Title")}>
              <input
                required
                className={inputClass}
                placeholder={translate("Dubai family package")}
                value={draft.title}
                onChange={(e) => setField('title', e.target.value)}
              />
            </Field>
            <Field label={translate("Currency")}>
              <input
                className={inputClass}
                value={draft.currency}
                onChange={(e) => setField('currency', e.target.value.toUpperCase())}
                maxLength={3}
              />
            </Field>
          </div>
          {showRouteFields ? (
            <>
              <Field label={translate("Origin")}>
                <input
                  required
                  className={inputClass}
                  placeholder="DXB"
                  value={draft.origin}
                  onChange={(e) => setField('origin', e.target.value)}
                />
              </Field>
              <Field label={translate("Destination")}>
                <input
                  required
                  className={inputClass}
                  placeholder={translate("New York")}
                  value={draft.destination}
                  onChange={(e) => setField('destination', e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={translate("Destination (optional override)")} className="sm:col-span-2">
              <input
                className={inputClass}
                placeholder={translate("Defaults to first hotel city")}
                value={draft.destination}
                onChange={(e) => setField('destination', e.target.value)}
              />
            </Field>
          )}
          <fieldset className="sm:col-span-2 grid gap-2">
            <legend className="mb-1 text-sm font-medium">{translate("When can this be offered?")}</legend>
            <div role="radiogroup" aria-label={translate("Availability")} className="inline-flex gap-0.5 self-start rounded-[9px] bg-neutral-bg p-[3px]">
              {(
                [
                  ['fixed', translate("Fixed dates")],
                  ['period', translate("Period (months)")],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={draft.availability_mode === mode}
                  onClick={() => setField('availability_mode', mode)}
                  className={`h-9 rounded-md px-3.5 text-[13px] font-semibold max-sm:h-11 ${
                    draft.availability_mode === mode ? 'bg-white text-shop-ink shadow-sm' : 'text-neutral-fg hover:text-shop-ink'
                  }`}
                >
                  {translate(label)}
                </button>
              ))}
            </div>
          </fieldset>
          {draft.availability_mode === 'fixed' ? (
            <>
              <Field label={translate("Travel date")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.travel_date}
                  onChange={(e) => setField('travel_date', e.target.value)}
                />
              </Field>
              <Field label={translate("Return date")}>
                <input
                  type="date"
                  className={inputClass}
                  value={draft.return_date}
                  onChange={(e) => setField('return_date', e.target.value)}
                />
              </Field>
              <p className="sm:col-span-2 text-xs text-shop-muted">
                {showHotels
                  ? translate("Offered to a customer who asks for this destination on exactly these dates. Dates sync from hotel stays when left blank.")
                  : translate("Offered to a customer who asks for this route on exactly these dates.")}
              </p>
            </>
          ) : (
            <div className="sm:col-span-2 grid gap-2">
              <div role="group" aria-label={translate("Months available")} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {MONTH_NAMES.map((name, index) => {
                  const month = index + 1
                  const on = draft.available_months.includes(month)
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setField(
                          'available_months',
                          on ? draft.available_months.filter((m) => m !== month) : [...draft.available_months, month].sort((a, b) => a - b),
                        )
                      }
                      className={`h-10 rounded-lg border text-sm font-semibold ${
                        on ? 'border-shop-accent bg-shop-accent text-white' : 'border-line-strong bg-white text-neutral-fg hover:bg-neutral-bg'
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-shop-muted">
                {translate("Offered to a customer who asks for")}{' '}
                {showHotels ? 'this destination' : 'this route'}{' '}{translate("on any days inside the chosen months — e.g. 10–19 October matches October. A stay that runs into a month you did not choose is not offered.")}</p>
            </div>
          )}
          <div className="sm:col-span-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label={translate("Adults")}>
              <select
                className={compactSelectClass}
                value={draft.adults_count}
                onChange={(e) => setField('adults_count', e.target.value)}
              >
                {ADULT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={translate("Children")}>
              <select
                className={compactSelectClass}
                value={draft.children_count}
                onChange={(e) => {
                  const nextCount = Number(e.target.value) || 0
                  setDraft((prev) => ({
                    ...prev,
                    children_count: String(nextCount),
                    children_ages: agesForCount(nextCount, prev.children_ages),
                  }))
                }}
              >
                {CHILD_COUNT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {Number(draft.children_count) > 0 && (
            <div className="sm:col-span-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {draft.children_ages.map((age, index) => (
                <Field key={index} label={translate("Child {value0} age", { value0: translate(String(index + 1)) })}>
                  <select
                    required
                    className={compactSelectClass}
                    value={age}
                    onChange={(e) => {
                      const value = e.target.value
                      setDraft((prev) => {
                        const nextAges = [...prev.children_ages]
                        nextAges[index] = value
                        return { ...prev, children_ages: nextAges }
                      })
                    }}
                  >
                    <option value="">{translate("Age")}</option>
                    {CHILD_AGE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          )}
          <Field label={translate("Total price override")} className="sm:col-span-2 sm:max-w-xs">
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              placeholder={translate("Leave blank to sum items")}
              value={draft.total_price}
              onChange={(e) => setField('total_price', e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <ImageUpload
              label={translate("Cover image")}
              value={draft.cover_image_url}
              onChange={(url) => setField('cover_image_url', url)}
            />
          </div>
          <Field label={translate("Description")} className="sm:col-span-2">
            <textarea
              rows={3}
              className="rounded-lg border border-shop-border px-3 py-2"
              placeholder={translate("What this package includes")}
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
            />
          </Field>
          <Field label={translate("Notes / terms")} className="sm:col-span-2">
            <textarea
              rows={2}
              className="rounded-lg border border-shop-border px-3 py-2"
              placeholder={translate("Shown on the downloaded quote")}
              value={draft.notes}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </Field>

          {showHotels && (
            <div className="sm:col-span-2 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{translate("Hotels")}</h3>
                  <p className="text-xs text-shop-muted">
                    {translate("Add multiple stays for split dates (e.g. 10–15 Oct, then 15–20 Oct).")}</p>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-shop-border bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-shop-bg"
                  onClick={addHotel}
                >
                  {translate("Add hotel")}</button>
              </div>
              <div className="space-y-3">
                {hotels.map((item, index) => (
                  <HotelFields
                    key={item.key}
                    item={item}
                    index={index}
                    canRemove={hotels.length > 1}
                    period={draft.availability_mode === 'period'}
                    onPatch={(patch) => patchItem(item.key, patch)}
                    onRemove={() => removeItem(item.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {showFlights && (
            <div className="sm:col-span-2 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{translate("Flights")}</h3>
                  <p className="text-xs text-shop-muted">{translate("Outbound is required. Return is optional.")}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-shop-border"
                    checked={includeReturn}
                    onChange={(e) => toggleReturnFlight(e.target.checked)}
                  />
                  <span className="font-medium">{translate("Include return flight")}</span>
                </label>
              </div>
              <div className="space-y-3">
                {outboundFlight && (
                  <FlightFields
                    item={outboundFlight}
                    label={translate("Outbound flight")}
                    onPatch={(patch) => patchItem(outboundFlight.key, { ...patch, direction: 'outbound' })}
                  />
                )}
                {returnFlight && (
                  <FlightFields
                    item={returnFlight}
                    label={translate("Return flight")}
                    onPatch={(patch) => patchItem(returnFlight.key, { ...patch, direction: 'return' })}
                  />
                )}
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="sm:col-span-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">{translate(error)}</div>
          )}
        </form>
      </ModalDrawer>
      {dialog}
    </>
  )
}
