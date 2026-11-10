import OpenAI from 'openai';
import { isDealerReplyMessage } from '../utils/dealerReply.js';
import { openaiConfig } from '../config/openai.js';

const client = openaiConfig.apiKey
  ? new OpenAI({ apiKey: openaiConfig.apiKey })
  : null;

const EMPTY_LEAD = {
  booking_type: null,
  origin: null,
  destination: null,
  travel_date: null,
  return_date: null,
  nights: null,
  adults_count: null,
  children_count: null,
  children_ages: [],
  budget: null,
  hotel_name: null,
  notes: null,
};

function nightsBetween(travelDate, returnDate) {
  if (!travelDate || !returnDate) return null;
  const start = new Date(`${travelDate}T00:00:00Z`);
  const end = new Date(`${returnDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : null;
}

export function requiredFieldsFor(collected = {}) {
  const fields = ['booking_type'];

  if (collected.booking_type === 'flight' || collected.booking_type === 'package') {
    fields.push('origin', 'destination');
  } else if (collected.booking_type === 'hotel') {
    fields.push('destination');
  }

  fields.push('travel_date', 'return_date', 'adults_count', 'children_count');
  return fields;
}

export function mergeCollected(existing = {}, extracted = {}) {
  const merged = { ...EMPTY_LEAD, ...existing };

  for (const [key, value] of Object.entries(extracted || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0 && key !== 'children_ages') continue;
    merged[key] = value;
  }

  const normalizedDates = normalizeTravelDates({
    travel_date: merged.travel_date,
    return_date: merged.return_date,
  });
  merged.travel_date = normalizedDates.travel_date;
  merged.return_date = normalizedDates.return_date;
  merged.nights = nightsBetween(merged.travel_date, merged.return_date);

  if (merged.children_count === 0) {
    merged.children_ages = [];
  }

  if (merged.booking_type === 'flight') {
    merged.hotel_name = null;
  }

  if (merged.booking_type === 'package') {
    // package keeps optional hotel_name preference
  }

  return merged;
}

export function getMissingFields(collected) {
  const missing = [];

  for (const field of requiredFieldsFor(collected)) {
    const value = collected?.[field];
    if (value === null || value === undefined || value === '') {
      missing.push(field);
    }
  }

  const childrenCount = Number(collected?.children_count);
  if (Number.isFinite(childrenCount) && childrenCount > 0) {
    const ages = Array.isArray(collected?.children_ages) ? collected.children_ages : [];
    if (ages.length < childrenCount) {
      missing.push('children_ages');
    }
  }

  return missing;
}

export function parseBookingType(text = '') {
  if (isDealerReplyMessage(text)) return null;

  const value = String(text).trim().toLowerCase();
  if (!value) return null;

  const mentionsHotel = /\b(hotel|hotels|فندق)\b/i.test(value) || /حجز\s*فندق/i.test(value);
  const mentionsFlight =
    /\b(flight|flights|airline|airfare|ticket|طيران|تذكرة)\b/i.test(value);

  if (mentionsHotel && mentionsFlight) return null;
  if (mentionsHotel) return 'hotel';
  if (mentionsFlight) return 'flight';

  if (/^(hotel|hotels|حجز فندق|فندق)$/i.test(value)) return 'hotel';
  if (/^(flight|flights|air|airline|ticket|طيران|تذكرة)$/i.test(value)) return 'flight';

  return null;
}

/** Treat "none" / "no" / "0 kids" etc. as children_count = 0 */
export function parseChildrenCountReply(text = '') {
  const value = String(text).trim().toLowerCase();
  if (!value) return null;

  if (
    /^(none|no|nope|nil|zero|0|لا|بدون|مافي|ما في)$/i.test(value) ||
    /\b(no children|no kids|0 children|0 kids|without children|zero children|بدون أطفال|لا أطفال|لا يوجد أطفال)\b/i.test(
      value,
    )
  ) {
    return 0;
  }

  const labeled = value.match(/^(\d+)\s*(children|child|kids?|طفل|اطفال|أطفال)?$/i);
  if (labeled) return Number(labeled[1]);

  const embedded = value.match(/(\d+)\s*(children|child|kids?|طفل|اطفال|أطفال)/i);
  if (embedded) return Number(embedded[1]);

  return null;
}

function looksLikePlaceOnly(text = '') {
  const value = text.trim();
  if (!value || value.length > 40) return false;
  if (extractDates(value).length) return false;
  if (/\b(adults?|children|child|kids?|hotel|flight|nights?)\b/i.test(value)) return false;
  if (/\b(from|to|مغادرة|إلى|الى)\b/i.test(value) && value.split(/\s+/).length > 3) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * "A to B" route parsing
 *
 * Written for terse messages like "Mumbai to London". It used to run on EVERY
 * message and overwrite the LLM's origin/destination, so any sentence containing
 * the word "to" was corrupted: "I would like to book a hotel in Dubai" became
 * origin "I would like", destination "book a hotel in Dubai". Voice notes are full
 * sentences, so they hit this constantly.
 * ------------------------------------------------------------------ */

const PLACE = "[A-Za-z\\u0600-\\u06FF][A-Za-z\\u0600-\\u06FF .'-]{1,30}";
const ROUTE_RE = new RegExp(`(?:from\\s+)?(${PLACE}?)\\s+(?:to|→|إلى|الى)\\s+(${PLACE})`, 'i');
const BARE_ROUTE_RE = new RegExp(
  `^\\s*(?:from\\s+|من\\s+)?${PLACE}?\\s+(?:to|→|إلى|الى)\\s+${PLACE}\\s*[.!?؟]?\\s*$`,
  'i',
);

// Words that mean the captured text is part of a sentence, not a place name.
const NOT_A_PLACE = new RegExp(
  '\\b(would|like|want|wanted|need|needs|book|booking|looking|plan|planning|travel|travelling|traveling|trip|go|going|stay|staying|hotel|hotels|flight|flights|ticket|tickets|package|please|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|twentieth|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|today|tomorrow|adults?|children|child|kids?|nights?|days?)\\b',
  'i',
);

// JavaScript's \b only knows ASCII letters, so Arabic words need whitespace boundaries.
const NOT_A_PLACE_AR = /(?:^|\s)(?:أريد|اريد|ابغى|أبغى|احجز|أحجز|حجز|فندق|فنادق|طيران|رحلة|تذكرة|باقة)(?=\s|$)/;

function isPlausiblePlace(value = '') {
  const text = String(value).trim();
  if (!text || /\d/.test(text) || /[,;:!?]/.test(text)) return false;
  if (text.split(/\s+/).length > 4) return false;
  return !NOT_A_PLACE.test(text) && !NOT_A_PLACE_AR.test(text);
}

/**
 * Finds an "A to B" route in a message, or null when it is not one.
 * `bare` is true when the whole message is just the route ("Mumbai to London").
 */
export function parseRoute(text = '') {
  const match = String(text).match(ROUTE_RE);
  if (!match) return null;
  const origin = match[1].trim().replace(/^(from|من)\s+/i, '');
  const destination = match[2]
    .trim()
    .replace(/\s+(on|with|for|,|\d|and).*$/i, '')
    .replace(/[.\s]+$/, '');
  if (!isPlausiblePlace(origin) || !isPlausiblePlace(destination)) return null;
  return { origin, destination, bare: BARE_ROUTE_RE.test(String(text).trim()) };
}

export function applyFieldAwareFixes(text, existing, extracted) {
  const missingBefore = getMissingFields(existing);
  const next = missingBefore[0];
  const fixed = { ...extracted };

  const bookingType = parseBookingType(text);
  if (bookingType) fixed.booking_type = bookingType;

  const route = parseRoute(text);
  if (route) {
    if (route.bare) {
      // The whole message is "A to B": unambiguous, and terse input is where the
      // LLM is least reliable about which side is which.
      fixed.origin = route.origin;
      fixed.destination = route.destination;
    } else {
      // Inside a longer sentence the LLM understands context; only fill what it missed.
      if (!fixed.origin) fixed.origin = route.origin;
      if (!fixed.destination) fixed.destination = route.destination;
    }
  }

  if (next === 'children_count') {
    const count = parseChildrenCountReply(text);
    if (count !== null) {
      fixed.children_count = count;
      if (count === 0) fixed.children_ages = [];
    }
  }

  if (next === 'adults_count') {
    const onlyNumber = text.trim().match(/^\d+$/);
    if (onlyNumber) fixed.adults_count = Number(onlyNumber[0]);
  }

  if ((next === 'origin' || next === 'destination') && looksLikePlaceOnly(text)) {
    fixed[next] = text.trim();
  }

  const zeroKids = parseChildrenCountReply(text);
  if (zeroKids === 0 && (existing.children_count == null && fixed.children_count == null)) {
    fixed.children_count = 0;
    fixed.children_ages = [];
  }

  return fixed;
}

function isGreetingLocal(text = '') {
  const value = text.trim().toLowerCase();
  if (!value) return false;
  return /^(hi|hello|hey|hola|salam|assalam|as-?salam|good\s*(morning|afternoon|evening)|start|book|مرحبا|السلام|اهلا|أهلا|هلا|صباح|مساء)/i.test(
    value,
  );
}

function nextQuestion(missing, language = 'en', collected = {}) {
  const ar = language === 'ar';
  const type = collected.booking_type;

  const map = {
    booking_type: ar
      ? 'هل تريد حجز فندق أم حجز طيران؟\nأرسل: فندق أو طيران'
      : 'Do you need a hotel booking or a flight booking?\nReply with: hotel or flight',
    origin: ar
      ? 'من أي مدينة ستسافر؟ (مدينة المغادرة)'
      : 'Which city are you flying from? (departure city)',
    destination:
      type === 'flight'
        ? ar
          ? 'إلى أي مدينة تريد السفر؟ (مدينة الوصول)'
          : 'Which city do you want to fly to? (arrival city)'
        : ar
          ? 'ما هي وجهة الفندق؟ (مدينة أو دولة)'
          : 'What is the hotel destination (city or country)?',
    travel_date:
      type === 'flight'
        ? ar
          ? 'ما هو تاريخ المغادرة؟ (مثال: 2026-09-10)'
          : 'What is the departure date? (e.g. 2026-09-10)'
        : ar
          ? 'ما هو تاريخ تسجيل الوصول؟ (مثال: 2026-09-10)'
          : 'What is the check-in date? (e.g. 2026-09-10)',
    return_date:
      type === 'flight'
        ? ar
          ? 'ما هو تاريخ العودة؟ (مثال: 2026-09-17)'
          : 'What is the return date? (e.g. 2026-09-17)'
        : ar
          ? 'ما هو تاريخ المغادرة من الفندق؟ (مثال: 2026-09-17)'
          : 'What is the check-out date? (e.g. 2026-09-17)',
    adults_count: ar
      ? 'كم عدد البالغين؟'
      : 'How many adults will be traveling?',
    children_count: ar
      ? 'كم عدد الأطفال؟ (اكتب 0 إن لم يوجد)'
      : 'How many children? (send 0 if none)',
    children_ages: ar
      ? 'ما أعمار الأطفال؟ (مثال: 5, 8)'
      : 'Please send the age of each child (e.g. 5, 8).',
  };

  return map[missing[0]] || (ar
    ? 'من فضلك أكمل البيانات المطلوبة.'
    : 'Please provide the remaining details.');
}

function welcomeMessage(language = 'en') {
  if (language === 'ar') {
    return (
      'مرحباً بك 👋\n' +
      'هل تريد حجز فندق أم حجز طيران؟\n' +
      'أرسل: فندق أو طيران'
    );
  }

  return (
    'Welcome 👋\n' +
    'Do you need a hotel booking or a flight booking?\n' +
    'Reply with: hotel or flight'
  );
}

function detailsPrompt(language, bookingType) {
  if (language === 'ar') {
    if (bookingType === 'flight') {
      return (
        'ممتاز، حجز طيران ✈️\n' +
        'أرسل لنا:\n' +
        '1) مدينة المغادرة\n' +
        '2) مدينة الوصول\n' +
        '3) تاريخ المغادرة وتاريخ العودة\n' +
        '4) عدد البالغين\n' +
        '5) عدد الأطفال وأعمارهم\n' +
        '6) أي ملاحظات (اختياري)'
      );
    }
    return (
      'ممتاز، حجز فندق 🏨\n' +
      'أرسل لنا:\n' +
      '1) الوجهة\n' +
      '2) تاريخ الوصول وتاريخ المغادرة\n' +
      '3) عدد البالغين\n' +
      '4) عدد الأطفال وأعمارهم\n' +
      '5) اسم الفندق (اختياري)\n' +
      '6) أي ملاحظات (اختياري)'
    );
  }

  if (bookingType === 'flight') {
    return (
      'Great — flight booking ✈️\n' +
      'Please send:\n' +
      '1) Departure city\n' +
      '2) Arrival city\n' +
      '3) Departure date and return date\n' +
      '4) Number of adults\n' +
      '5) Number of children and their ages\n' +
      '6) Any notes (optional)'
    );
  }

  return (
    'Great — hotel booking 🏨\n' +
    'Please send:\n' +
    '1) Destination\n' +
    '2) Check-in and check-out dates\n' +
    '3) Number of adults\n' +
    '4) Number of children and their ages\n' +
    '5) Hotel name (optional)\n' +
    '6) Any notes (optional)'
  );
}

function buildSummary(merged) {
  const type = merged.booking_type || 'hotel';
  const route =
    type === 'flight' && merged.origin
      ? `${merged.origin} → ${merged.destination}`
      : merged.destination;

  return `${type.toUpperCase()}: ${route}, ${merged.travel_date} → ${merged.return_date}, ${merged.nights} nights, ${merged.adults_count} adults, ${merged.children_count} children`;
}

function buildReply({ complete, isGreeting, missingBefore, missing, language, merged, justChoseType }) {
  if (complete) {
    return language === 'ar'
      ? 'شكراً لك. سيتواصل معك مندوبنا قريباً.'
      : 'Our agent will contact you soon.';
  }

  if (isGreeting && !merged.booking_type) {
    return welcomeMessage(language);
  }

  if (justChoseType) {
    return detailsPrompt(language, merged.booking_type);
  }

  if (!merged.booking_type) {
    return nextQuestion(['booking_type'], language, merged);
  }

  return nextQuestion(missing, language, merged);
}

/**
 * Use OpenAI to extract/normalize travel lead fields from free text.
 */
export async function processUserMessage({ text, collected, languageHint }) {
  if (isDealerReplyMessage(text)) {
    return {
      complete: false,
      missing: [],
      collected: mergeCollected(collected),
      reply: '',
      language: detectLanguage(text, languageHint),
      summary: null,
      skip_lead_intake: true,
    };
  }

  const existing = mergeCollected(collected);
  const greeting = isGreetingLocal(text);
  const missingBefore = getMissingFields(existing);

  if (!client) {
    console.warn('OPENAI_API_KEY missing — using local fallback parser');
    return localProcess({ text, existing, greeting, languageHint, missingBefore });
  }

  const system = `You are a travel lead intake assistant for WhatsApp.
Today's date is ${todayIso()} (use this as "today").
Extract and normalize booking details from the user's message (Arabic or English).
Return STRICT JSON only with this shape:
{
  "language": "en" | "ar",
  "is_greeting": boolean,
  "extracted": {
    "booking_type": "hotel" | "flight" | "package" | null,
    "origin": string|null,
    "destination": string|null,
    "travel_date": "YYYY-MM-DD"|null,
    "return_date": "YYYY-MM-DD"|null,
    "adults_count": number|null,
    "children_count": number|null,
    "children_ages": number[],
    "budget": string|null,
    "hotel_name": string|null,
    "notes": string|null
  },
  "summary": string|null
}
Rules:
- First priority is booking_type: hotel, flight, or package (flight + hotel together).
- For flights, origin = departure city, destination = arrival city.
- For packages, origin = departure city, destination = trip city; user wants both flights and hotel.
- For hotels, destination = hotel city/country; origin usually null; hotel_name optional.
- Prefer ISO dates YYYY-MM-DD.
- If the user omits the year (e.g. "15 Aug" or "15 aug to 16 aug"), use the current year (${todayIso().slice(0, 4)}). If that date is already in the past relative to today, use next year instead. Never invent old years like 2023.
- Travel dates must be today or in the future.
- If user says none/no/zero/0/no children for kids, set children_count to 0 and children_ages to [].
- Do not invent values.
- is_greeting true for hi/hello/مرحبا.
- summary only when lead looks complete.`;

  const userPayload = {
    existing_collected: existing,
    latest_user_message: text,
    language_hint: languageHint || null,
    currently_missing: missingBefore,
  };

  try {
    const completion = await client.chat.completions.create({
      model: openaiConfig.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const extracted = applyFieldAwareFixes(text, existing, parsed.extracted || {});
    const merged = mergeCollected(existing, extracted);
    const missing = getMissingFields(merged);
    const language = parsed.language === 'ar' || languageHint === 'ar' ? 'ar' : 'en';
    const isGreeting = Boolean(parsed.is_greeting) || greeting;
    const complete = missing.length === 0;
    const justChoseType = !existing.booking_type && Boolean(merged.booking_type);

    return {
      language,
      isGreeting,
      collected: merged,
      missing,
      complete,
      summary: parsed.summary || (complete ? buildSummary(merged) : null),
      reply: buildReply({
        complete,
        isGreeting,
        missingBefore,
        missing,
        language,
        merged,
        justChoseType,
      }),
    };
  } catch (error) {
    console.error('OpenAI processing failed, using fallback:', error.message);
    return localProcess({ text, existing, greeting, languageHint, missingBefore });
  }
}

function detectLanguage(text = '', hint) {
  if (hint === 'ar' || hint === 'en') return hint;
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Calendar "today" as YYYY-MM-DD (UTC). */
export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isValidYmd(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function formatYmd(year, month, day) {
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Resolve month/day to the soonest date on/after minIso (usually today).
 * Fixes yearless messages and wrong years like 2023.
 */
export function coerceFutureDateParts(month, day, minIso = todayIso()) {
  const minYear = Number(String(minIso).slice(0, 4));
  for (let year = minYear; year <= minYear + 1; year += 1) {
    const iso = formatYmd(year, month, day);
    if (iso && iso >= minIso) return iso;
  }
  return formatYmd(minYear + 1, month, day);
}

/**
 * If an ISO date is in the past, roll month/day forward to the next valid
 * future occurrence (fixes yearless parses and stale years like 2023).
 */
export function coerceFutureIsoDate(value, minIso = todayIso()) {
  const iso = String(value || '').slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidYmd(year, month, day)) return null;

  if (iso >= minIso) return iso;
  return coerceFutureDateParts(month, day, minIso);
}

/**
 * Normalize travel/return dates so they are not stuck in the past (e.g. 2023).
 */
export function normalizeTravelDates(
  { travel_date: travelDate, return_date: returnDate } = {},
  minIso = todayIso(),
) {
  let travel = coerceFutureIsoDate(travelDate, minIso);
  let ret = coerceFutureIsoDate(returnDate, minIso);

  if (travel && ret && ret < travel) {
    const match = ret.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      ret = coerceFutureDateParts(Number(match[2]), Number(match[3]), travel);
    }
  }

  return {
    travel_date: travel || (travelDate ? String(travelDate).slice(0, 10) : null),
    return_date: ret || (returnDate ? String(returnDate).slice(0, 10) : null),
  };
}

function parseMonthName(name) {
  return MONTHS[String(name || '').toLowerCase()] || null;
}

function toIsoDate(value, minIso = todayIso()) {
  if (!value) return null;
  const raw = String(value).trim();

  const iso = raw.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const formatted = formatYmd(year, month, day);
    return coerceFutureIsoDate(formatted, minIso);
  }

  const dayMonthYear = raw.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d{2})\b/i,
  );
  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const month = parseMonthName(dayMonthYear[2]);
    const year = Number(dayMonthYear[3]);
    return coerceFutureIsoDate(formatYmd(year, month, day), minIso);
  }

  const monthDayYear = raw.match(
    /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i,
  );
  if (monthDayYear) {
    const month = parseMonthName(monthDayYear[1]);
    const day = Number(monthDayYear[2]);
    const year = Number(monthDayYear[3]);
    return coerceFutureIsoDate(formatYmd(year, month, day), minIso);
  }

  const dayMonth = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/i);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = parseMonthName(dayMonth[2]);
    if (month) return coerceFutureDateParts(month, day, minIso);
  }

  const monthDay = raw.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (monthDay) {
    const month = parseMonthName(monthDay[1]);
    const day = Number(monthDay[2]);
    if (month) return coerceFutureDateParts(month, day, minIso);
  }

  return null;
}

function extractDates(text, minIso = todayIso()) {
  const dates = [];
  const push = (iso) => {
    if (iso && !dates.includes(iso)) dates.push(iso);
  };

  const isoMatches = [...String(text).matchAll(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/g)];
  for (const match of isoMatches) {
    push(
      coerceFutureIsoDate(
        formatYmd(Number(match[1]), Number(match[2]), Number(match[3])),
        minIso,
      ),
    );
  }

  const withYear = [
    ...String(text).matchAll(
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2})\b/gi,
    ),
    ...String(text).matchAll(
      /\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+20\d{2})\b/gi,
    ),
  ];
  for (const match of withYear) {
    push(toIsoDate(match[1], minIso));
  }

  // Yearless: "15 aug", "aug 15", "15th August"
  const yearless = [
    ...String(text).matchAll(
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b/gi,
    ),
    ...String(text).matchAll(
      /\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
    ),
  ];
  for (const match of yearless) {
    // Skip if this span already included a year match
    if (/\b20\d{2}\b/.test(match[0])) continue;
    push(toIsoDate(match[1], minIso));
  }

  return dates;
}

function localProcess({ text, existing, greeting, languageHint, missingBefore }) {
  if (isDealerReplyMessage(text)) {
    return {
      complete: false,
      missing: [],
      collected: existing,
      reply: '',
      language: detectLanguage(text, languageHint),
      summary: null,
      skip_lead_intake: true,
    };
  }

  const language = detectLanguage(text, languageHint);
  const extracted = { ...EMPTY_LEAD };
  const dates = extractDates(text);
  const priorMissing = missingBefore || getMissingFields(existing);

  const bookingType = parseBookingType(text);
  if (bookingType) extracted.booking_type = bookingType;

  if (dates.length >= 2) {
    extracted.travel_date = dates[0];
    extracted.return_date = dates[1];
  } else if (dates.length === 1) {
    if (priorMissing[0] === 'return_date' || (existing.travel_date && !existing.return_date)) {
      extracted.return_date = dates[0];
    } else {
      extracted.travel_date = dates[0];
    }
  }

  const adultsMatch = text.match(/(\d+)\s*(adults?|بالغ|بالغين)/i);
  if (adultsMatch) extracted.adults_count = Number(adultsMatch[1]);

  const parsedChildren = parseChildrenCountReply(text);
  if (parsedChildren !== null) {
    extracted.children_count = parsedChildren;
    if (parsedChildren === 0) extracted.children_ages = [];
  }

  const agesMatch = text.match(/ages?\s*:?\s*([0-9,\s]+)/i) || text.match(/أعمار\s*:?\s*([0-9،,\s]+)/i);
  if (agesMatch) {
    extracted.children_ages = agesMatch[1]
      .split(/[،,]/)
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n));
  }

  Object.assign(extracted, applyFieldAwareFixes(text, existing, extracted));

  const onlyNumber = text.trim().match(/^\d+$/);
  if (onlyNumber && priorMissing[0]) {
    const n = Number(onlyNumber[0]);
    if (priorMissing[0] === 'adults_count') extracted.adults_count = n;
    if (priorMissing[0] === 'children_count') {
      extracted.children_count = n;
      if (n === 0) extracted.children_ages = [];
    }
  }

  if (
    (priorMissing[0] === 'destination' || priorMissing[0] === 'origin') &&
    text.trim() &&
    !greeting &&
    !onlyNumber &&
    dates.length === 0 &&
    !bookingType
  ) {
    extracted[priorMissing[0]] = text.trim();
  }

  const fromTo = text.match(
    /(?:from|مغادرة|من)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s]{1,30}?)\s+(?:to|إلى|الى)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s]{1,30})/i,
  );
  if (fromTo) {
    extracted.origin = fromTo[1].trim();
    extracted.destination = fromTo[2].trim().replace(/\s+(on|with|for|,).*$/i, '');
  }

  const destinationMatch = text.match(
    /(?:destination|dest|to|مدينة|وجهة)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s]{1,40})/i,
  );
  if (destinationMatch && !extracted.destination) {
    extracted.destination = destinationMatch[1].trim().replace(/\s+(and|from|on|with).*$/i, '');
  }

  if (priorMissing[0] === 'children_ages') {
    const ages = text
      .split(/[،,]/)
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n));
    if (ages.length) extracted.children_ages = ages;
  }

  const merged = mergeCollected(existing, extracted);
  const missing = getMissingFields(merged);
  const complete = missing.length === 0;
  const justChoseType = !existing.booking_type && Boolean(merged.booking_type);

  return {
    language,
    isGreeting: greeting,
    collected: merged,
    missing,
    complete,
    summary: complete ? buildSummary(merged) : null,
    reply: buildReply({
      complete,
      isGreeting: greeting,
      missingBefore: priorMissing,
      missing,
      language,
      merged,
      justChoseType,
    }),
  };
}
