import { displayTotal, listPredefinedQuotes } from './predefinedQuotes.js';

export const PENDING_PACKAGE_ID = '_pending_package_id';
export const PENDING_LEAD_ID = '_pending_lead_id';
export const PENDING_HOTEL_OPTION = '_pending_hotel_option';
export const SELECTED_PACKAGE_ITEM_IDS = '_selected_package_item_ids';

export function normalizePlace(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .trim();
}

export function placeMatches(queryPlace, candidatePlace) {
  const query = normalizePlace(queryPlace);
  const candidate = normalizePlace(candidatePlace);
  if (!query || !candidate) return false;
  if (query === candidate) return true;
  return query.includes(candidate) || candidate.includes(query);
}

export function toDateKey(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * The dates a package covers. Explicit package dates win; otherwise they are read from
 * the items: a hotel's check-in / check-out, and a flight's departure date — the
 * outbound leg opens the window and the `return` leg closes it.
 */
export function quoteTravelWindow(quote = {}) {
  const items = quote.items || [];
  const itemDates = items.map((item) => {
    if (item.item_type === 'flight') {
      const day = toDateKey(item.departure_time);
      return item.direction === 'return'
        ? { check_in: null, check_out: day }
        : { check_in: day, check_out: null };
    }
    return { check_in: toDateKey(item.check_in), check_out: toDateKey(item.check_out) };
  });
  const checkIns = itemDates.map((row) => row.check_in).filter(Boolean).sort();
  const checkOuts = itemDates.map((row) => row.check_out).filter(Boolean).sort();
  return {
    travel_date: toDateKey(quote.travel_date) || checkIns[0] || null,
    return_date: toDateKey(quote.return_date) || checkOuts[checkOuts.length - 1] || null,
  };
}

/**
 * Demand and package must share the same travel date, and the same return date when either
 * side has one. A hotel offered for several lengths of stay (7, 8 or 9 nights from the same
 * day) also matches a return date that is one of its options' check-outs.
 */
export function datesMatch(demand = {}, quote = {}) {
  const wantTravel = toDateKey(demand.travel_date);
  const wantReturn = toDateKey(demand.return_date);
  const pkg = quoteTravelWindow(quote);

  if (!wantTravel || !pkg.travel_date) return false;
  if (wantTravel !== pkg.travel_date) return false;

  if (wantReturn || pkg.return_date) {
    if (!wantReturn || !pkg.return_date) return false;
    if (wantReturn === pkg.return_date) return true;
    return (quote.items || []).some(
      (item) =>
        item.item_type === 'hotel' &&
        toDateKey(item.check_out) === wantReturn &&
        (!toDateKey(item.check_in) || toDateKey(item.check_in) === wantTravel),
    );
  }
  return true;
}

/**
 * Every calendar month (1–12) a trip touches, from its first day to its last.
 * With no return date (one-way) it is just the month it starts in.
 */
export function monthsTouched(travelDate, returnDate) {
  const start = toDateKey(travelDate);
  if (!start) return [];
  const end = toDateKey(returnDate);
  const first = Number(start.slice(5, 7));
  if (!end || end <= start) return [first];
  const months = new Set();
  let year = Number(start.slice(0, 4));
  let month = first;
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  // A trip is at most a few months; the cap just stops a mistyped year running away.
  for (let i = 0; i < 13; i += 1) {
    months.add(month);
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return [...months].sort((a, b) => a - b);
}

/**
 * A "period" package is for whole months (Jan, Feb, Oct). It fits a trip when EVERY month
 * the trip touches is one of them — so 10–19 October matches an "October" package, but
 * 28 Oct – 3 Nov does not (November is not offered) — whatever the exact days.
 */
export function periodMatches(demand = {}, quote = {}) {
  const allowed = new Set((quote.available_months || []).map(Number));
  if (!allowed.size) return false;
  const wanted = monthsTouched(demand.travel_date, demand.return_date);
  return wanted.length > 0 && wanted.every((month) => allowed.has(month));
}

/** Does the package suit the requested dates: exact dates for a fixed package, months for a period one. */
export function availabilityMatches(demand = {}, quote = {}) {
  return quote.availability_mode === 'period' ? periodMatches(demand, quote) : datesMatch(demand, quote);
}

export function parsePackageDecision(text = '') {
  const value = String(text).trim().toLowerCase();
  if (!value) return null;

  if (
    /^(yes|y|yeah|yep|yup|ok|okay|sure|please|deal|book it|take it|i want it|نعم|ايوه|أيوه|موافق|أريد|تمام|حسنا|حسناً)$/i.test(
      value,
    )
  ) {
    return 'yes';
  }

  if (
    /^(no|n|nope|nah|skip|search|usual|لا|لأ|كلا)$/i.test(value) ||
    /^(no thanks|not this|search hotels)$/i.test(value)
  ) {
    return 'no';
  }

  if (/\b(take (it|this)|book (it|this)|i want (it|this package)|نعم)\b/i.test(value)) {
    return 'yes';
  }
  if (/\b(no thanks|not this|search hotels?|لا شكرا)\b/i.test(value)) {
    return 'no';
  }

  return null;
}

function formatDisplayDate(value) {
  if (!value) return null;
  const iso = String(value).slice(0, 10);
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};

/** "Available: January, February, October" — what a period package says instead of dates. */
export function formatMonthList(months, language = 'en') {
  const names = MONTH_NAMES[language === 'ar' ? 'ar' : 'en'];
  const list = [...new Set((months || []).map(Number))]
    .filter((m) => m >= 1 && m <= 12)
    .sort((a, b) => a - b)
    .map((m) => names[m - 1]);
  if (!list.length) return null;
  return `${language === 'ar' ? 'متاحة في' : 'Available'}: ${list.join(language === 'ar' ? '، ' : ', ')}`;
}

function formatMoney(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return `${currency} ${Math.round(Number(amount)).toLocaleString('en-US')}`;
}

function numericBudget(value) {
  if (value == null || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Rows for the same hotel are alternatives the customer picks one of — a different room,
 * board, or length of stay (7, 8 or 9 nights) — so the stay dates are not part of the key.
 */
function hotelGroupKey(item = {}) {
  return [item.hotel_name || item.title, item.city, item.country]
    .map(normalizePlace)
    .filter(Boolean)
    .join('|');
}

function hotelOptionScore(item, demand = {}) {
  const wanted = normalizePlace([demand.hotel_name, demand.notes].filter(Boolean).join(' '));
  const room = normalizePlace(item.room_name);
  const board = normalizePlace(item.board_name);
  const extra = item.extra && typeof item.extra === 'object' ? item.extra : {};
  const guests = Math.max(1, Number(demand.adults_count || 1) + Number(demand.children_count || 0));
  const capacity = Number(extra.max_occupancy ?? extra.occupancy ?? extra.capacity);
  const budget = numericBudget(demand.budget);
  const price = Number(item.price);
  let score = 0;

  const wantIn = toDateKey(demand.travel_date);
  const wantOut = toDateKey(demand.return_date);
  if (wantIn && wantOut && toDateKey(item.check_in) === wantIn && toDateKey(item.check_out) === wantOut) score += 50;
  if (wanted && room && wanted.includes(room)) score += 60;
  if (wanted && board && wanted.includes(board)) score += 40;
  if (Number.isFinite(capacity)) {
    if (capacity === guests) score += 30;
    else if (capacity > guests) score += Math.max(5, 20 - (capacity - guests));
    else score -= 100;
  }
  if (budget != null && Number.isFinite(price)) score += price <= budget ? 15 : -20;
  if (/free cancellation|refundable/i.test(`${item.description || ''} ${JSON.stringify(extra)}`)) score += 5;
  return score;
}

/**
 * A hotel sold for several stay windows (24–31 Dec, 25–29 Dec, … 2–9 Jan) only offers the
 * customer the windows that start on their check-in day. When none does — or the options
 * have no dates, as in a period package — they all stay, for the customer to choose from.
 */
function optionsForCheckIn(options, demand = {}) {
  const checkIn = toDateKey(demand.travel_date);
  if (!checkIn) return options;
  const fitting = options.filter((item) => toDateKey(item.check_in) === checkIn);
  return fitting.length ? fitting : options;
}

/** The nights a hotel's rows cover, [first check-in, last check-out), or null without dates. */
function groupSpan(group) {
  const ins = group.options.map((item) => toDateKey(item.check_in)).filter(Boolean).sort();
  const outs = group.options.map((item) => toDateKey(item.check_out)).filter(Boolean).sort();
  return ins.length && outs.length ? { from: ins[0], to: outs[outs.length - 1] } : null;
}

/**
 * Different hotels offered for the same nights are a choice between them ("stay at Parma,
 * Kent or Piya, 24–31 Dec"), not a stay in all of them. Hotels whose nights overlap are
 * merged into one choice; hotels on consecutive nights (Atlantis 1–4, Jumeirah 4–6) stay
 * separate legs of one trip. Without dates nothing can be told, so nothing is merged.
 */
function mergeOverlappingHotels(groups) {
  const spans = groups.map(groupSpan);
  const parent = groups.map((_, index) => index);
  const root = (index) => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  // Pairwise, so a hotel that bridges two others joins all three into one choice.
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = spans[i];
      const b = spans[j];
      if (a && b && a.from < b.to && b.from < a.to) parent[root(j)] = root(i);
    }
  }
  const merged = new Map();
  groups.forEach((group, index) => {
    const target = merged.get(root(index));
    if (!target) {
      merged.set(root(index), { ...group, options: [...group.options], hotels: [group.hotel_name] });
      return;
    }
    target.key = `${target.key}+${group.key}`;
    target.options.push(...group.options);
    target.hotels.push(group.hotel_name);
  });
  return [...merged.values()].map((group) => (group.hotels.length > 1 ? { ...group, choice: 'hotel' } : group));
}

/**
 * The customer's choices in a package: one group per decision, with its options ranked best
 * fit first. A group is one hotel's alternatives (rooms, boards, lengths of stay), or —
 * when several hotels cover the same nights — the choice between those hotels.
 */
export function hotelOptionGroups(quote = {}, demand = {}) {
  const groups = new Map();
  for (const item of quote.items || []) {
    if (item.item_type !== 'hotel') continue;
    const key = hotelGroupKey(item) || `hotel-${item.id || item.sort_order || groups.size}`;
    const existing = groups.get(key) || {
      key,
      hotel_name: item.hotel_name || item.title || 'Hotel',
      options: [],
    };
    existing.options.push(item);
    groups.set(key, existing);
  }

  return mergeOverlappingHotels([...groups.values()]).map((group) => ({
    ...group,
    options: optionsForCheckIn(group.options, demand)
      .map((item, index) => ({ item, index, score: hotelOptionScore(item, demand) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aPrice = a.item.price == null ? Number.NaN : Number(a.item.price);
        const bPrice = b.item.price == null ? Number.NaN : Number(b.item.price);
        if (Number.isFinite(aPrice) && Number.isFinite(bPrice) && aPrice !== bPrice) return aPrice - bPrice;
        return a.index - b.index;
      })
      .map((row) => row.item),
  }));
}

/** Returns the next hotel whose alternatives still need the customer's decision. */
export function nextHotelOptionChoice(quote, demand = {}, selectedItemIds = []) {
  const selected = new Set((selectedItemIds || []).map(String));
  return hotelOptionGroups(quote, demand).find(
    (group) => group.options.length > 1 && !group.options.some((item) => selected.has(String(item.id))),
  ) || null;
}

/**
 * The option a typed reply picks: its number ("2", "option 2"), its length of stay
 * ("8 nights"), or its room / board name. A number inside other text ("7 nights") is never
 * read as an option number. Null when the reply does not single out one option.
 */
export function parseHotelOptionChoice(text, group) {
  if (!group?.options?.length) return null;
  const value = String(text || '').trim();
  const number = value.match(/^(?:option|choice|no\.?|#)?\s*([1-9]\d?)\s*\.?$/i);
  if (number) return group.options[Number(number[1]) - 1] || null;

  const stay = value.match(/\b(\d{1,2})\s*(?:nights?|n\b|days?|ليال[يٍ]?|ليلة|أيام|ايام)/i);
  if (stay) {
    const nights = Number(stay[1]);
    const byNights = group.options.filter((item) => Number(item.nights) === nights);
    if (byNights.length === 1) return byNights[0];
  }

  const normalized = normalizePlace(value);
  if (!normalized) return null;
  const matches = group.options.filter((item) => {
    const label = normalizePlace([item.room_name, item.board_name, item.title].filter(Boolean).join(' '));
    return label && (label.includes(normalized) || normalized.includes(label));
  });
  return matches.length === 1 ? matches[0] : null;
}

function shortDate(iso, language) {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Do the hotel's options start on different days? Then each label has to say its dates.
 * (Stays that all start the same day — 7, 8 or 9 nights — are told apart by their nights.)
 */
function datesDiffer(group) {
  return new Set((group?.options || []).map((item) => toDateKey(item.check_in))).size > 1;
}

function stayLabel(item, language, withDates) {
  const ar = language === 'ar';
  const from = toDateKey(item.check_in);
  const to = toDateKey(item.check_out);
  const dates = from && to ? `${shortDate(from, language)} → ${shortDate(to, language)}` : null;
  const nights = item.nights ? `${item.nights}${ar ? ' ليال' : ' nights'}` : null;
  if (withDates && dates) return [dates, nights].filter(Boolean).join(' · ');
  return nights || dates;
}

/**
 * "Deluxe Room · Breakfast · 7 nights · USD 1,200" — one option of a hotel, as the customer
 * sees it. When the options start on different days each one carries its dates
 * ("Double Room · 25 Dec → 29 Dec · 4 nights · USD 1,399"), or they would read the same.
 */
export function hotelOptionLabel(item, group, language = 'en') {
  const hotel = group?.choice === 'hotel' ? item.hotel_name || item.title : null;
  const details = [hotel, item.room_name, item.board_name, stayLabel(item, language, datesDiffer(group))]
    .filter(Boolean)
    .join(' · ');
  const price = formatMoney(item.price, item.currency || 'USD');
  return `${details || item.title || group?.hotel_name || 'Option'}${price ? ` · ${price}` : ''}`;
}

export function formatHotelOptionQuestion(group, language = 'en') {
  const ar = language === 'ar';
  const lines =
    group.choice === 'hotel'
      ? [ar ? 'لدينا عدة فنادق لهذه الليالي. أيها تفضل؟' : 'We have several hotels for these nights. Which one would you like?']
      : ar
        ? [`لدى ${group.hotel_name} عدة خيارات. أيها تفضل؟`]
        : [`${group.hotel_name} has multiple options. Which one do you prefer?`];
  group.options.forEach((item, index) => {
    const recommended = index === 0 ? (ar ? ' — الأنسب لك' : ' — recommended for you') : '';
    lines.push(`${index + 1}. ${hotelOptionLabel(item, group, language)}${recommended}`);
  });
  lines.push('');
  lines.push(ar ? 'أرسل رقم الخيار.' : 'Reply with the option number.');
  return lines.join('\n');
}

/* ── WhatsApp polls ──────────────────────────────────────────────────────
 * Wasender can't send buttons, so a choice goes out as a single-answer poll. Each option
 * carries the id it stands for (`value`); a vote is mapped back through that, never by
 * searching packages for the option's text.
 */

export const POLL_MAX_OPTIONS = 12;
const POLL_OPTION_MAX_CHARS = 100;

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Poll options must be distinct — WhatsApp reports votes by option text. Labels that would
 * repeat get their number appended; every label fits WhatsApp's length limit.
 */
export function distinctPollOptions(options) {
  const seen = new Map();
  return options.map((option, index) => {
    let label = clip(String(option.label || '').trim() || `Option ${index + 1}`, POLL_OPTION_MAX_CHARS);
    if (seen.has(label)) label = clip(`${label} (${index + 1})`, POLL_OPTION_MAX_CHARS);
    seen.set(label, true);
    return { label, value: String(option.value) };
  });
}

/**
 * The poll for choosing one of a hotel's options, or null when WhatsApp can't carry it
 * (fewer than 2 or more than 12 options) and the numbered text question is used instead.
 */
export function hotelOptionPoll(group, language = 'en') {
  const options = group?.options || [];
  if (options.length < 2 || options.length > POLL_MAX_OPTIONS) return null;
  const ar = language === 'ar';
  return {
    question:
      group.choice === 'hotel'
        ? ar ? 'اختر فندقاً واحداً:' : 'Which hotel would you like?'
        : ar ? `${group.hotel_name} — اختر خياراً واحداً:` : `${group.hotel_name} — choose one option:`,
    options: distinctPollOptions(
      options.map((item) => ({ label: hotelOptionLabel(item, group, language), value: item.id })),
    ),
  };
}

/** YES / NO on an offered package, as a poll. */
export function packageDecisionPoll(language = 'en', kind = 'hotel') {
  const ar = language === 'ar';
  const search = searchLabel(kind, language);
  return {
    question: ar ? 'هل تريد هذه الباقة؟' : 'Would you like this package?',
    options: [
      { label: ar ? 'نعم، أريد هذه الباقة' : 'Yes, book this package', value: 'yes' },
      { label: ar ? `لا، ابحث عن ${search} أخرى` : `No, search other ${search}`, value: 'no' },
    ],
  };
}

/** Nights and dates of the selected hotel options, for whichever of them the options state. */
function chosenStay(quote, hotels) {
  const stay = {};
  if (hotels.length && hotels.every((item) => Number(item.nights) > 0)) {
    stay.nights = hotels.reduce((sum, item) => sum + Number(item.nights), 0);
  }
  // With flights, the flights set the trip's dates; only a hotel-only stay takes the hotel's.
  const hasFlights = (quote.items || []).some((item) => item.item_type === 'flight');
  if (quote.availability_mode !== 'period' && !hasFlights) {
    const checkIns = hotels.map((item) => toDateKey(item.check_in)).filter(Boolean).sort();
    const checkOuts = hotels.map((item) => toDateKey(item.check_out)).filter(Boolean).sort();
    if (checkIns.length === hotels.length && checkOuts.length === hotels.length) {
      stay.travel_date = checkIns[0];
      stay.return_date = checkOuts[checkOuts.length - 1];
    }
  }
  return stay;
}

/** Produces all flights and exactly one selected option per hotel. */
export function tailorPackageQuote(quote = {}, demand = {}, selectedItemIds = []) {
  const selected = new Set((selectedItemIds || []).map(String));
  const nonHotels = (quote.items || []).filter((item) => item.item_type !== 'hotel');
  const groups = hotelOptionGroups(quote, demand);
  const hotels = groups.map((group) => (
    group.options.find((item) => selected.has(String(item.id))) || group.options[0]
  ));
  const items = [...nonHotels, ...hotels].sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0),
  );
  const hotelCount = (quote.items || []).filter((item) => item.item_type === 'hotel').length;
  const removedAlternatives = hotels.length < hotelCount;
  const allPriced = items.length > 0 && items.every((item) => item.price != null && Number.isFinite(Number(item.price)));
  const totalPrice = removedAlternatives && allPriced
    ? items.reduce((sum, item) => sum + Number(item.price), 0)
    : quote.total_price;
  // The stay is the chosen option's — 7 nights, not the 9 of the longest alternative.
  const stay = removedAlternatives ? chosenStay(quote, hotels) : {};
  return {
    ...quote,
    ...stay,
    items,
    total_price: totalPrice,
    display_total: totalPrice != null ? Number(totalPrice) : displayTotal({ ...quote, items, total_price: null }),
    selected_item_ids: hotels.filter((item) => item.id != null).map((item) => String(item.id)),
  };
}

function hotelLine(item) {
  const name = item.hotel_name || item.title;
  if (!name) return null;
  const extras = [
    item.nights ? `${item.nights}n` : null,
    item.board_name,
    item.room_name,
  ].filter(Boolean);
  return extras.length ? `• ${name} (${extras.join(', ')})` : `• ${name}`;
}

const SEARCH_LABELS = {
  en: { hotel: 'hotels', flight: 'flights', package: 'flights and hotels' },
  ar: { hotel: 'فنادق', flight: 'رحلات', package: 'رحلات وفنادق' },
};

/** What "search as usual" means for this kind of request, in the customer's language. */
export function searchLabel(kind = 'hotel', language = 'en') {
  const labels = SEARCH_LABELS[language === 'ar' ? 'ar' : 'en'];
  return labels[kind] || labels.hotel;
}

function formatFlightTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!match) return text;
  const date = new Date(`${match[1]}T12:00:00`);
  const day = Number.isNaN(date.getTime())
    ? match[1]
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${match[2]}`;
}

function flightLine(item, language) {
  const ar = language === 'ar';
  const airline = [item.airline, item.flight_number].filter(Boolean).join(' ');
  const from = item.departure_airport || item.departure_city;
  const to = item.arrival_airport || item.arrival_city;
  const leg = [
    from ? [from, formatFlightTime(item.departure_time)].filter(Boolean).join(' ') : null,
    to ? [to, formatFlightTime(item.arrival_time)].filter(Boolean).join(' ') : null,
  ]
    .filter(Boolean)
    .join(' → ');
  const stops =
    item.stops == null || item.stops === ''
      ? null
      : Number(item.stops) === 0
        ? ar ? 'مباشرة' : 'nonstop'
        : ar ? `${item.stops} توقف` : `${item.stops} stop${Number(item.stops) === 1 ? '' : 's'}`;
  const extras = [item.duration, stops].filter(Boolean).join(', ');

  const label =
    item.direction === 'return'
      ? ar ? 'العودة' : 'Return'
      : item.direction === 'outbound'
        ? ar ? 'الذهاب' : 'Outbound'
        : null;
  const body = [airline, leg].filter(Boolean).join(' · ') || item.title;
  if (!body) return null;
  return `• ${label ? `${label}: ` : ''}${body}${extras ? ` (${extras})` : ''}`;
}

/**
 * The offer shown to the customer.
 * @param {object} quote the predefined package
 * @param {'en'|'ar'} language
 * @param {{ kind?: 'hotel'|'flight'|'package', question?: boolean }} [options] `kind` is what
 *   the customer asked for, so "NO" is described as searching for that — not always "hotels".
 *   `question: false` leaves off the "reply YES / NO" line, for a quote an agent sends on
 *   their own rather than in answer to a request.
 */
export function formatPackageOfferMessage(quote, language = 'en', { kind = 'hotel', question = true } = {}) {
  const ar = language === 'ar';
  const hotels = (quote.items || []).filter((item) => item.item_type === 'hotel');
  const flights = (quote.items || []).filter((item) => item.item_type === 'flight');
  const flightOnly = flights.length > 0 && hotels.length === 0;
  const total = formatMoney(displayTotal(quote), quote.currency || 'USD');
  const dates =
    quote.availability_mode === 'period'
      ? formatMonthList(quote.available_months, language)
      : [formatDisplayDate(quote.travel_date), formatDisplayDate(quote.return_date)]
          .filter(Boolean)
          .join(' → ');
  // "Nights" means accommodation. A flight-only package has none, even though its dates
  // are 10 days apart, so don't suggest a stay is included.
  const nights =
    quote.nights && !flightOnly ? (ar ? `${quote.nights} ليال` : `${quote.nights} nights`) : null;

  const where = quote.destination || (ar ? 'وجهتك' : 'your destination');
  const lines = ar
    ? [flightOnly ? `لدينا باقة طيران جاهزة إلى ${where}:` : `لدينا باقة جاهزة لـ ${where}:`, '', `*${quote.title}*`]
    : [flightOnly ? `We have a ready flight package for ${where}:` : `We have a ready package for ${where}:`, '', `*${quote.title}*`];

  const meta = [nights, dates, total].filter(Boolean);
  if (meta.length) lines.push(meta.join(' · '));
  if (quote.description) {
    lines.push('');
    lines.push(quote.description);
  }

  const flightLines = flights.map((flight) => flightLine(flight, language)).filter(Boolean);
  if (flightLines.length) {
    lines.push('');
    lines.push(ar ? 'الرحلات:' : 'Flights:');
    lines.push(...flightLines);
  }

  if (hotels.length) {
    lines.push('');
    lines.push(ar ? 'الفنادق:' : 'Hotels:');
    for (const hotel of hotels) {
      const line = hotelLine(hotel);
      if (line) lines.push(line);
    }
  }

  if (question) {
    const search = searchLabel(kind, language);
    lines.push('');
    lines.push(
      ar
        ? `هل تريد هذه الباقة؟ أرسل نعم لأخذها، أو لا للبحث عن ${search} كالمعتاد.`
        : `Would you like this package? Reply YES to take it, or NO to search ${search} as usual.`,
    );
  }

  return lines.join('\n');
}

function destinationScore(destination, quote) {
  if (placeMatches(destination, quote.destination)) {
    return normalizePlace(destination) === normalizePlace(quote.destination) ? 100 : 80;
  }
  if (placeMatches(destination, quote.title)) return 50;
  return 0;
}

const AIRPORT_CODE = /^[a-z]{3}$/;

/**
 * How well `wanted` matches the best of several place names: 100 exact, 80 partial, 0 none.
 * A three-letter airport code only counts as a whole word — "ist" is inside "istanbul" and
 * "listing", but it means Istanbul only when it stands alone ("IST", "Istanbul (IST)").
 */
function bestPlaceScore(wanted, candidates) {
  const want = normalizePlace(wanted);
  if (!want) return 0;
  let best = 0;
  for (const raw of candidates) {
    const candidate = normalizePlace(raw);
    if (!candidate) continue;
    if (candidate === want) return 100;
    if (AIRPORT_CODE.test(candidate) || AIRPORT_CODE.test(want)) {
      if (want.split(' ').includes(candidate) || candidate.split(' ').includes(want)) {
        best = Math.max(best, 80);
      }
      continue;
    }
    if (want.includes(candidate) || candidate.includes(want)) best = Math.max(best, 80);
  }
  return best;
}

/**
 * The flight(s) that make up the OUTBOUND leg. Only these say where a trip starts and
 * ends: a round trip also lists the return flight, which runs the opposite way, and
 * counting it would offer a Mumbai→London package to someone flying London→Mumbai.
 */
function outboundFlights(quote) {
  const flights = (quote.items || []).filter((item) => item.item_type === 'flight');
  const marked = flights.filter((flight) => flight.direction === 'outbound');
  if (marked.length) return marked;
  const unmarked = flights.filter((flight) => !flight.direction);
  return unmarked.length ? [unmarked[0]] : [];
}

/**
 * Route match for a flight request: BOTH where the customer flies from and to must match
 * the package. Returns the combined score, or 0 when either end differs.
 */
export function flightRouteScore(demand = {}, quote = {}) {
  const legs = outboundFlights(quote);
  const from = bestPlaceScore(demand.origin, [
    quote.origin,
    ...legs.flatMap((leg) => [leg.departure_city, leg.departure_airport]),
  ]);
  const to = Math.max(
    bestPlaceScore(demand.destination, [
      quote.destination,
      ...legs.flatMap((leg) => [leg.arrival_city, leg.arrival_airport]),
    ]),
    // A package named for the destination ("Dubai Eid Flights") is a weaker signal.
    bestPlaceScore(demand.destination, [quote.title]) ? 50 : 0,
  );
  return from && to ? from + to : 0;
}

function matchScore(demand, quote) {
  if (!availabilityMatches(demand, quote)) return 0;
  return demand.booking_type === 'flight'
    ? flightRouteScore(demand, quote)
    : destinationScore(demand.destination, quote);
}

/**
 * Finds the predefined package to offer for a completed request, or null.
 *
 *   hotel / package request → hotel and bundle quotes   (matched on destination + dates)
 *   flight request          → flight and bundle quotes  (matched on origin + destination + dates)
 *
 * Dates must match exactly, so a customer is only offered a package that is genuinely
 * for their trip. `options.quotes` lets callers (and tests) supply the candidates.
 */
export async function findMatchingPackage(demand = {}, { quotes: supplied } = {}) {
  const isFlight = demand.booking_type === 'flight';
  if (!String(demand.destination || '').trim()) return null;
  if (isFlight && !String(demand.origin || '').trim()) return null;
  if (!toDateKey(demand.travel_date)) return null;

  const quotes = supplied || (await listPredefinedQuotes({ limit: 500 }));
  const accepted = isFlight ? ['flight', 'package'] : ['hotel', 'package'];

  const scored = quotes
    .filter((quote) => accepted.includes(quote.quote_type))
    .map((quote) => ({ quote, score: matchScore(demand, quote) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Exact dates are a more specific promise than "any day in these months".
      const aFixed = a.quote.availability_mode === 'period' ? 0 : 1;
      const bFixed = b.quote.availability_mode === 'period' ? 0 : 1;
      if (aFixed !== bFixed) return bFixed - aFixed;
      // For equal fits, a pure flight offer beats a flight+hotel bundle.
      if (isFlight) {
        const aPure = a.quote.quote_type === 'flight' ? 1 : 0;
        const bPure = b.quote.quote_type === 'flight' ? 1 : 0;
        if (aPure !== bPure) return bPure - aPure;
      }
      return new Date(b.quote.updated_at || 0) - new Date(a.quote.updated_at || 0);
    });

  return scored[0]?.quote || null;
}

/** @deprecated Renamed — packages are no longer hotel-only. Kept so existing imports work. */
export const findMatchingHotelPackage = findMatchingPackage;

export function withPackageOffer(collected, { packageId, leadId }) {
  return {
    ...collected,
    [PENDING_PACKAGE_ID]: packageId,
    [PENDING_LEAD_ID]: leadId,
  };
}

export function withHotelOptionSelection(collected, { packageId, leadId, selectedItemIds = [] }) {
  return {
    ...withPackageOffer(collected, { packageId, leadId }),
    [PENDING_HOTEL_OPTION]: {
      package_id: packageId,
      lead_id: leadId,
      selected_item_ids: selectedItemIds.map(String),
    },
  };
}

export function pendingHotelOptionSelection(collected = {}) {
  const state = collected[PENDING_HOTEL_OPTION];
  if (!state?.package_id || !state?.lead_id) return null;
  return {
    packageId: state.package_id,
    leadId: state.lead_id,
    selectedItemIds: Array.isArray(state.selected_item_ids) ? state.selected_item_ids.map(String) : [],
  };
}

export function finishHotelOptionSelection(collected, selectedItemIds = []) {
  const next = { ...collected, [SELECTED_PACKAGE_ITEM_IDS]: selectedItemIds.map(String) };
  delete next[PENDING_HOTEL_OPTION];
  return next;
}

export function selectedPackageItemIds(collected = {}) {
  return Array.isArray(collected[SELECTED_PACKAGE_ITEM_IDS])
    ? collected[SELECTED_PACKAGE_ITEM_IDS].map(String)
    : [];
}

export function clearPackageOffer(collected = {}) {
  const next = { ...collected };
  delete next[PENDING_PACKAGE_ID];
  delete next[PENDING_LEAD_ID];
  delete next[PENDING_HOTEL_OPTION];
  delete next[SELECTED_PACKAGE_ITEM_IDS];
  return next;
}

export function pendingPackageOffer(collected = {}) {
  const packageId = collected[PENDING_PACKAGE_ID];
  const leadId = collected[PENDING_LEAD_ID];
  if (!packageId || !leadId) return null;
  return { packageId, leadId };
}
