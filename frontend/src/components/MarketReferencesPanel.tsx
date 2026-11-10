import { useEffect, useState } from 'react'
import { apiJson } from '../lib/api'
import type { Lead } from '../lib/leads'

type Result = {
  id: string; title: string; provider: string; kind: string; price: number | null; currency: string
  price_text?: string | null; price_basis?: string | null
  seller?: string | null; rating?: number | null; review_count?: number | null
  url?: string | null; property_token?: string | null; place_id?: string | null; description?: string | null
}
type SearchResponse = { results: Result[]; suggestions?: { value: string }[]; airports?: unknown[] }
type Detail = { reviews?: { author: string | null; rating: number | null; text: string | null }[]; place?: { name: string | null; description: string | null; address: string | null; hotels: { name: string }[] } }
type AirportGroup = { departure?: { airport?: { id?: string; name?: string }; city?: string }[]; arrival?: { airport?: { id?: string; name?: string }; city?: string }[] }
const providerName: Record<string, string> = { hotelbeds: 'Hotelbeds', 'booking.com': 'Booking.com', airbnb: 'Airbnb', google_flights: 'Google · SerpApi' }

export default function MarketReferencesPanel({ lead }: { lead: Lead }) {
  const [kind, setKind] = useState<'hotel' | 'flight'>(lead.booking_type === 'flight' ? 'flight' : 'hotel')
  const [provider, setProvider] = useState('google')
  const [query, setQuery] = useState(lead.hotel_name || lead.destination || '')
  const [origin, setOrigin] = useState(lead.origin || '')
  const [travelDate, setTravelDate] = useState(String(lead.travel_date || '').slice(0, 10))
  const [returnDate, setReturnDate] = useState(String(lead.return_date || '').slice(0, 10))
  const [saved, setSaved] = useState<Result[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [airports, setAirports] = useState<AirportGroup[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiJson<{ quotes: Record<string, unknown>[] }>(`/api/leads/${lead.id}/${kind === 'hotel' ? 'hotel-quotes' : 'quotes'}`)
      .then(({ quotes }) => {
        if (!active) return
        setSaved((quotes || []).map((row) => {
          const outbound = (row.outbound || {}) as Record<string, unknown>
          const source = kind === 'hotel' ? String(row.provider || 'hotelbeds') : lead.quote_search?.flight_provider || 'booking.com'
          return {
            id: String(row.id), title: String(kind === 'hotel' ? row.hotel_name || 'Hotel' : outbound.airline || outbound.carrier || 'Flight'),
            provider: providerName[source] || source, kind, price: typeof row.price === 'number' ? row.price : null,
            currency: String(row.currency || 'USD'), rating: typeof row.review_score === 'number' ? row.review_score : null,
            review_count: typeof row.review_count === 'number' ? row.review_count : null,
            description: String(kind === 'hotel' ? row.room_name || row.board_name || '' : ''),
          }
        }))
      }).catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not load saved references') })
    return () => { active = false }
  }, [kind, lead.id, lead.quote_search?.flight_provider])

  async function search() {
    setLoading(true); setSearched(true); setError(null); setDetail(null)
    try {
      const data = await apiJson<SearchResponse>(`/api/leads/${lead.id}/market-search`, { method: 'POST', body: JSON.stringify({ kind, provider, query, origin, travel_date: travelDate, return_date: returnDate, limit: 10 }) })
      setResults(data.results || []); setSuggestions((data.suggestions || []).map((s) => s.value)); setAirports((data.airports || []) as AirportGroup[])
    } catch (err) { setResults([]); setError(err instanceof Error ? err.message : 'Search failed') }
    finally { setLoading(false) }
  }

  async function suggest() {
    setError(null)
    try {
      const data = await apiJson<{ suggestions: { value: string }[] }>(`/api/market/autocomplete?q=${encodeURIComponent(query)}`)
      setSuggestions(data.suggestions.map((s) => s.value))
    } catch (err) { setError(err instanceof Error ? err.message : 'Suggestions failed') }
  }

  async function openDetail(item: Result) {
    setError(null); setDetail(null)
    try {
      const path = item.property_token ? `market-reviews?property_token=${encodeURIComponent(item.property_token)}` : `market-place?place_id=${encodeURIComponent(item.place_id || '')}`
      setDetail(await apiJson<Detail>(`/api/leads/${lead.id}/${path}`))
    } catch (err) { setError(err instanceof Error ? err.message : 'Details failed') }
  }

  const cards = (items: Result[]) => items.map((item) => <article key={`${item.provider}:${item.id}`} className="rounded-xl border border-shop-border bg-white p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><strong className="text-sm">{item.title}</strong><span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">{item.provider}</span>
        {item.seller && <span className="ml-2 text-xs text-shop-muted">Listed by {item.seller}</span>}
        {item.description && <p className="text-xs text-shop-muted">{item.description}</p>}
        {item.rating != null && <p className="text-xs">★ {item.rating}{item.review_count != null ? ` · ${item.review_count} reviews` : ''}</p>}
      </div><div className="text-right"><strong className="block text-sm">{item.price != null ? `${item.currency} ${item.price.toLocaleString()}` : item.price_text || 'Price unavailable'}</strong>{(item.price != null || item.price_text) && item.price_basis && <span className="text-xs text-shop-muted">{item.price_basis}</span>}</div>
    </div>
    <div className="mt-2 flex gap-3 text-xs">
      {(item.property_token || item.place_id) && <button type="button" onClick={() => void openDetail(item)} className="font-semibold text-shop-accent">{item.property_token ? 'Google reviews' : 'Tripadvisor place'}</button>}
      {item.url?.startsWith('https://') && <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-shop-accent">Open listing</a>}
    </div>
  </article>)

  return <div className="space-y-4">
    <section className="rounded-xl border border-shop-border bg-white p-4">
      <h2 className="text-base font-semibold">Market references</h2>
      <p className="mt-1 text-sm text-shop-muted">Search current results for this lead. Confirm availability before quoting a price.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <select aria-label="Search type" value={kind} onChange={(e) => { setKind(e.target.value as 'hotel' | 'flight'); setProvider('google'); setResults([]); setSearched(false) }} className="rounded-lg border border-shop-border p-2 text-sm"><option value="hotel">Hotels</option><option value="flight">Flights</option></select>
        <select aria-label="Market source" value={provider} onChange={(e) => { setProvider(e.target.value); setResults([]); setSearched(false) }} className="rounded-lg border border-shop-border p-2 text-sm">
          <option value="google">Google · SerpApi</option>{kind === 'hotel' && <><option value="hotelbeds">Hotelbeds</option><option value="booking">Booking.com</option><option value="airbnb">Airbnb</option><option value="tripadvisor">Tripadvisor · SerpApi</option></>}
        </select>
        {kind === 'flight' && <input aria-label="Origin" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Origin" className="min-w-32 flex-1 rounded-lg border border-shop-border p-2 text-sm" />}
        <input aria-label="Destination or hotel" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Destination or hotel" className="min-w-40 flex-[2] rounded-lg border border-shop-border p-2 text-sm" />
        <button type="button" onClick={() => void suggest()} disabled={!query.trim() || loading} className="rounded-lg border border-shop-border px-3 py-2 text-sm">Suggestions</button>
        <button type="button" onClick={() => void search()} disabled={!query.trim() || loading} className="rounded-lg bg-shop-accent px-4 py-2 text-sm font-semibold text-white">{loading ? 'Searching…' : 'Search market'}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-shop-muted">{kind === 'hotel' ? 'Check-in' : 'Departure'}<input type="date" value={travelDate} onChange={(event) => setTravelDate(event.target.value)} className="mt-1 block rounded-lg border border-shop-border bg-white px-3 py-2 text-sm text-shop-ink" /></label>
        <label className="text-xs font-medium text-shop-muted">{kind === 'hotel' ? 'Check-out' : 'Return (optional)'}<input type="date" value={returnDate} min={travelDate || undefined} onChange={(event) => setReturnDate(event.target.value)} className="mt-1 block rounded-lg border border-shop-border bg-white px-3 py-2 text-sm text-shop-ink" /></label>
        <span className="pb-2 text-xs text-shop-muted">{lead.adults_count} adult{lead.adults_count === 1 ? '' : 's'} · {lead.children_count} child{lead.children_count === 1 ? '' : 'ren'}</span>
      </div>
      {suggestions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{suggestions.map((s) => <button type="button" key={s} onClick={() => { setQuery(s); setSuggestions([]) }} className="rounded-full bg-shop-bg px-2 py-1 text-xs">{s}</button>)}</div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
    {results.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">Live search · {results.length} results</h3>{cards(results)}</section>}
    {searched && !loading && !error && results.length === 0 && <div role="status" className="rounded-xl border border-shop-border bg-white p-5 text-sm text-shop-muted">No results found for this search. Try a nearby destination, different dates, or another source.</div>}
    {airports.length > 0 && <details className="rounded-xl border border-shop-border bg-white p-3 text-sm"><summary className="cursor-pointer font-semibold">Google Flights airports</summary>{airports.map((group, index) => <p key={index} className="mt-2 text-xs">{(group.departure || []).map((a) => `${a.airport?.id || ''} ${a.city || a.airport?.name || ''}`).join(', ')} → {(group.arrival || []).map((a) => `${a.airport?.id || ''} ${a.city || a.airport?.name || ''}`).join(', ')}</p>)}</details>}
    {detail && <section className="rounded-xl border border-shop-border bg-white p-4"><h3 className="mb-2 text-sm font-semibold">Property details</h3>{detail.place && <div className="text-sm"><strong>{detail.place.name}</strong><p>{detail.place.address}</p><p>{detail.place.description}</p>{detail.place.hotels?.map((h) => <p key={h.name}>{h.name}</p>)}</div>}{detail.reviews?.map((r, i) => <div key={i} className="border-t border-shop-border py-2 text-sm"><strong>{r.author || 'Guest'} · ★ {r.rating ?? '—'}</strong><p>{r.text}</p></div>)}</section>}
    <section className="space-y-2"><h3 className="text-sm font-semibold">Saved API references · {saved.length}</h3>{saved.length ? cards(saved) : <p className="text-sm text-shop-muted">No saved API results yet.</p>}</section>
  </div>
}
