/**
 * Flight provider selection.
 *
 * Booking.com (RapidAPI) and Google Flights (SerpApi) return the same quote
 * shape, so the pipeline can use either. FLIGHTS_PROVIDER controls which:
 *
 *   auto     (default) — Booking.com first, Google Flights if it fails
 *   booking            — Booking.com only (behaviour before SerpApi existed)
 *   google             — Google Flights only
 *
 * In 'auto' the fallback only engages when SERPAPI_KEY is set, so an
 * unconfigured deployment behaves exactly as it did before.
 */

import { searchFlightQuotes } from './flights.js';
import { searchGoogleFlightQuotes } from './googleFlights.js';
import { isSerpApiConfigured } from '../config/serpapi.js';

function configuredProvider() {
  return String(process.env.FLIGHTS_PROVIDER || 'auto').toLowerCase();
}

export async function searchFlightQuotesWithFallback(params = {}) {
  const provider = configuredProvider();

  if (provider === 'google') {
    return { ...(await searchGoogleFlightQuotes(params)), provider: 'google_flights' };
  }

  if (provider === 'booking') {
    return { ...(await searchFlightQuotes(params)), provider: 'booking.com' };
  }

  try {
    return { ...(await searchFlightQuotes(params)), provider: 'booking.com' };
  } catch (error) {
    if (!isSerpApiConfigured()) throw error;

    console.warn(
      `[flights] Booking.com failed (${error.message}) — falling back to Google Flights`,
    );
    try {
      return {
        ...(await searchGoogleFlightQuotes(params)),
        provider: 'google_flights',
        fallback_from: 'booking.com',
        fallback_reason: error.message,
      };
    } catch (fallbackError) {
      // Surface the original failure; the fallback error is secondary context.
      fallbackError.message = `Booking.com: ${error.message} · Google Flights: ${fallbackError.message}`;
      throw fallbackError;
    }
  }
}
