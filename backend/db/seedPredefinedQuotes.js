import { query } from '../config/database.js';
import { createPredefinedQuote } from '../services/predefinedQuotes.js';

export const DEMO_QUOTE_TITLE = '[Demo] Dubai 7-night stay';

const COVER =
  'https://images.unsplash.com/photo-1512453979798-5ea933d271a5?auto=format&fit=crop&w=1600&q=80';

export function demoDubaiQuoteInput() {
  return {
    title: DEMO_QUOTE_TITLE,
    origin: 'DXB',
    destination: 'Dubai',
    travel_date: '2026-11-01',
    return_date: '2026-11-08',
    adults_count: 2,
    children_count: 1,
    currency: 'USD',
    description:
      'A 7-night Dubai stay split across three hotels: Palm Jumeirah for the waterpark, a Jumeirah Beach sea-view room, then two nights in the desert. Family of 2 adults and 1 child (age 8). Breakfast included throughout; Atlantis is half board.',
    notes:
      'Rates are indicative for 1–8 Nov 2026, 1 family room unless noted. Non-refundable after 18 Oct. Desert transfer (private 4x4) is included on 6 Nov. Passport copies needed 72 hours before check-in at Al Maha.',
    cover_image_url: COVER,
    items: [
      {
        item_type: 'hotel',
        hotel_name: 'Atlantis The Palm',
        city: 'Dubai',
        country: 'United Arab Emirates',
        category: '5 star',
        room_name: 'Ocean King Room, Imperial Club',
        board_name: 'Half board',
        check_in: '2026-11-01',
        check_out: '2026-11-04',
        nights: 3,
        price: 1860,
        currency: 'USD',
        image_url:
          'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80',
        description:
          'Palm Jumeirah. Imperial Club lounge access, Aquaventure & The Lost Chambers included. Check-in from 15:00, late checkout 13:00 on 4 Nov. King bed + rollaway for the child. Sea-facing.',
      },
      {
        item_type: 'hotel',
        hotel_name: 'Jumeirah Beach Hotel',
        city: 'Dubai',
        country: 'United Arab Emirates',
        category: '5 star',
        room_name: 'Deluxe Sea View, 1 King + sofa bed',
        board_name: 'Breakfast',
        check_in: '2026-11-04',
        check_out: '2026-11-06',
        nights: 2,
        price: 920,
        currency: 'USD',
        image_url:
          'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
        description:
          'Jumeirah Beach. Direct beach access, Wild Wadi tickets included. 15-minute transfer from Atlantis on 4 Nov (private car, included). King bed with sofa bed for the child. Breakfast at La Parrilla terrace.',
      },
      {
        item_type: 'hotel',
        hotel_name: 'Al Maha Desert Resort & Spa',
        city: 'Dubai',
        country: 'United Arab Emirates',
        category: '5 star',
        room_name: 'Bedouin Suite, desert conservation view',
        board_name: 'All inclusive',
        check_in: '2026-11-06',
        check_out: '2026-11-08',
        nights: 2,
        price: 1540,
        currency: 'USD',
        image_url:
          'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=80',
        description:
          'Dubai Desert Conservation Reserve. Private pool suite, two desert activities per day (camel, wildlife drive). All meals and selected house beverages. Private 4x4 pickup from Jumeirah Beach Hotel at 14:00 on 6 Nov. Checkout 12:00, transfer back to DXB on 8 Nov not included.',
      },
    ],
  };
}

export const DEMO_NYC_QUOTE_TITLE = '[Demo] New York 6-night package';

const NYC_COVER =
  'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?auto=format&fit=crop&w=1600&q=80';

export function demoNewYorkQuoteInput() {
  return {
    title: DEMO_NYC_QUOTE_TITLE,
    origin: 'DXB',
    destination: 'New York',
    travel_date: '2026-12-12',
    return_date: '2026-12-18',
    adults_count: 2,
    children_count: 0,
    currency: 'USD',
    description:
      'End-to-end New York package for 2 adults: Emirates DXB ↔ JFK, 3 nights Midtown at The Langham Fifth Avenue, then 3 nights at 1 Hotel Brooklyn Bridge. Breakfast included at both hotels. Private airport and hotel transfers included.',
    notes:
      'Indicative rates for 12–18 Dec 2026, 1 king room. Non-refundable after 20 Nov. JFK arrivals hall pickup on 12 Dec (flight EK201). Checkout 12:00 on 18 Dec with transfer to JFK for EK202. NYC hotel tax included.',
    cover_image_url: NYC_COVER,
    items: [
      {
        item_type: 'flight',
        airline: 'Emirates',
        flight_number: 'EK201',
        departure_airport: 'DXB',
        arrival_airport: 'JFK',
        departure_city: 'Dubai',
        arrival_city: 'New York',
        departure_time: '2026-12-12T08:30:00',
        arrival_time: '2026-12-12T14:15:00',
        duration: '14h 45m',
        stops: 0,
        direction: 'outbound',
        price: 980,
        currency: 'USD',
        description: 'Nonstop Emirates business-saver / economy flex. 2 checked bags. Meals and Wi-Fi included.',
      },
      {
        item_type: 'hotel',
        hotel_name: 'The Langham, New York, Fifth Avenue',
        city: 'New York',
        country: 'United States',
        category: '5 star',
        room_name: 'Superior King, Fifth Avenue view',
        board_name: 'Breakfast',
        check_in: '2026-12-12',
        check_out: '2026-12-15',
        nights: 3,
        price: 1680,
        currency: 'USD',
        image_url:
          'https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=1200&q=80',
        description:
          'Midtown Manhattan, opposite the Empire State Building. King bed, rain shower, Langham Club breakfast. Check-in from 15:00 after JFK transfer (private car, included). Walking distance to Bryant Park and Macy’s.',
      },
      {
        item_type: 'hotel',
        hotel_name: '1 Hotel Brooklyn Bridge',
        city: 'New York',
        country: 'United States',
        category: '5 star',
        room_name: 'Skyline King, Manhattan view',
        board_name: 'Breakfast',
        check_in: '2026-12-15',
        check_out: '2026-12-18',
        nights: 3,
        price: 1425,
        currency: 'USD',
        image_url:
          'https://images.unsplash.com/photo-1534430480872-3498386e7856?auto=format&fit=crop&w=1200&q=80',
        description:
          'DUMBO, Brooklyn. Skyline king with Manhattan views, rooftop hydropool, farm-to-table breakfast. 20-minute private transfer from The Langham on 15 Dec (included). Walk the Brooklyn Bridge; subway to SoHo in 10 minutes.',
      },
      {
        item_type: 'flight',
        airline: 'Emirates',
        flight_number: 'EK202',
        departure_airport: 'JFK',
        arrival_airport: 'DXB',
        departure_city: 'New York',
        arrival_city: 'Dubai',
        departure_time: '2026-12-18T22:00:00',
        arrival_time: '2026-12-19T20:05:00',
        duration: '13h 05m',
        stops: 0,
        direction: 'return',
        price: 980,
        currency: 'USD',
        description: 'Nonstop overnight return. Same cabin as outbound. Hotel-to-JFK transfer at 18:30 included.',
      },
    ],
  };
}

export async function seedDemoPredefinedQuotes() {
  const demos = [demoDubaiQuoteInput, demoNewYorkQuoteInput];
  const created = [];

  for (const build of demos) {
    const input = build();
    const existing = await query(`SELECT id FROM predefined_quotes WHERE title = $1 LIMIT 1`, [
      input.title,
    ]);
    if (existing.rows[0]) continue;
    const quote = await createPredefinedQuote(input);
    console.log(`Seeded demo predefined quote: ${quote.title}`);
    created.push(quote);
  }

  return { seeded: created.length > 0, quotes: created };
}
