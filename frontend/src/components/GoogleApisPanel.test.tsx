import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import GoogleApisPanel from './GoogleApisPanel'
import * as places from '../lib/places'

vi.mock('../lib/places', async () => {
  const actual = await vi.importActual<typeof places>('../lib/places')
  return {
    ...actual,
    searchAirports: vi.fn(),
    searchHotelPlaces: vi.fn(),
    searchImages: vi.fn(),
    searchFlightQuotes: vi.fn(),
  }
})

const mocked = places as unknown as {
  searchAirports: ReturnType<typeof vi.fn>
  searchHotelPlaces: ReturnType<typeof vi.fn>
  searchImages: ReturnType<typeof vi.fn>
  searchFlightQuotes: ReturnType<typeof vi.fn>
}

describe('GoogleApisPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the flight autocomplete and lists airports with distances', async () => {
    mocked.searchAirports.mockResolvedValue({
      query: 'dubai',
      count: 1,
      suggestions: [
        {
          id: '/m/01f08r',
          name: 'Dubai - United Arab Emirates',
          type: 'city',
          description: 'City in the United Arab Emirates',
          position: 1,
          airports: [
            { id: 'DXB', name: 'Dubai Intl', city: 'Dubai', city_id: null, distance: '6 mi', distance_value: 6 },
          ],
        },
      ],
    })

    render(<GoogleApisPanel />)
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => expect(mocked.searchAirports).toHaveBeenCalledWith('dubai'))
    expect(await screen.findByText('Dubai - United Arab Emirates')).toBeTruthy()
    expect(screen.getByText('DXB · 6 mi')).toBeTruthy()
  })

  it('switches to flight search and requests the google provider', async () => {
    mocked.searchFlightQuotes.mockResolvedValue({
      provider: 'google_flights',
      from: { id: 'DXB', name: 'DXB', code: 'DXB', metro: false, airport_spread_mi: null, nearby_airports: [] },
      to: { id: 'LHR', name: 'LHR', code: 'LHR', metro: false, airport_spread_mi: null, nearby_airports: [] },
      search: { trip_type: 'one_way', metro_search: false, travel_date: '2026-11-10', return_date: null },
      count: 1,
      quotes: [
        {
          id: 'q1',
          price: 250,
          currency: 'USD',
          outbound: {
            airline: 'ITA',
            airline_logo: null,
            flight_number: 'AZ 857',
            departure_airport: 'DXB',
            departure_city: 'Dubai',
            departure_time: '2026-11-10 01:50',
            arrival_airport: 'LHR',
            arrival_city: 'London',
            arrival_time: '2026-11-10 09:40',
            duration: '11h 50m',
            stops: 1,
            layovers: [],
          },
          inbound: null,
          outbound_only: false,
          cabin_class: 'Economy',
          provider: 'google_flights',
        },
      ],
    })

    render(<GoogleApisPanel />)
    fireEvent.click(screen.getByText('Flight search'))
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() =>
      expect(mocked.searchFlightQuotes).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google', origin: 'DXB', destination: 'LHR' }),
      ),
    )
    expect(await screen.findByText('USD 250')).toBeTruthy()
    expect(screen.getByText('DXB → LHR')).toBeTruthy()
  })

  it('surfaces an API failure instead of rendering an empty result', async () => {
    mocked.searchImages.mockRejectedValue(
      new Error('SerpApi search quota reached. Top up the plan or wait for the quota to reset.'),
    )

    render(<GoogleApisPanel />)
    fireEvent.click(screen.getByText('Image search'))
    fireEvent.click(screen.getByText('Run'))

    expect(await screen.findByText(/SerpApi search quota reached/)).toBeTruthy()
  })
})
