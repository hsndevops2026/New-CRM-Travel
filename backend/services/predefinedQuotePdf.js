import { displayTotal, quoteFilename } from './predefinedQuotes.js';
import { formatMonthList } from './packageOffer.js';
import { drawText, measureTextHeight } from './pdfText.js';
import {
  BODY,
  CONTENT_W,
  FONT,
  INK,
  LINE,
  MUTED,
  Page,
  createDocument,
  dateRange,
  dateRangeCompact,
  fetchImage,
  formatDate,
  money,
  tint,
  travellers,
} from './pdfTheme.js';

const TYPE_LABEL = { hotel: 'Hotel', flight: 'Flight', package: 'Flight + Hotel' };

/** "2026-12-12T08:35:00" → "12 Dec · 08:35"; anything else is shown as written. */
function dateTime(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!match) return String(value);
  return `${formatDate(match[1])} · ${match[2]}`;
}

function nightsText(nights) {
  return nights ? `${nights} night${Number(nights) === 1 ? '' : 's'}` : null;
}

function stopsText(stops) {
  if (stops == null || stops === '') return null;
  return Number(stops) === 0 ? 'Non-stop' : `${stops} stop${Number(stops) === 1 ? '' : 's'}`;
}

/* ── item cards ────────────────────────────────────────────────────────── */

const IMAGE_W = 118;
const IMAGE_H = 92;
const PRICE_W = 104;

function hotelLines(item) {
  const place = [item.city, item.country].filter(Boolean).join(', ');
  return {
    place: [place, item.category].filter(Boolean).join('  ·  '),
    stay: [item.room_name, item.board_name].filter(Boolean).join('  ·  '),
    when: [dateRange(item.check_in, item.check_out), nightsText(item.nights)].filter(Boolean).join('  ·  '),
  };
}

function drawHotel(page, item, currency, image) {
  const { doc } = page;
  const price = money(item.price, item.currency || currency);
  const name = item.hotel_name || item.title || 'Hotel';
  const lines = hotelLines(item);

  page.card({
    measure(inner) {
      const textW = inner - (image ? IMAGE_W + 14 : 0);
      const nameW = textW - (price ? PRICE_W : 0);
      let h = measureTextHeight(doc, name, { width: nameW, size: 13, font: FONT.semi });
      for (const line of [lines.place, lines.stay, lines.when]) {
        if (line) h += 6 + measureTextHeight(doc, line, { width: textW, size: 9.5, font: FONT.regular });
      }
      if (item.description) h += 8 + measureTextHeight(doc, item.description, { width: textW, size: 9, font: FONT.regular, lineGap: 0 });
      return Math.max(h, image ? IMAGE_H : 0);
    },
    draw(x, y, inner) {
      let textX = x;
      if (image) {
        try {
          doc.save();
          doc.roundedRect(x, y, IMAGE_W, IMAGE_H, 8).clip();
          doc.image(image, x, y, { cover: [IMAGE_W, IMAGE_H], align: 'center', valign: 'center' });
          doc.restore();
        } catch {
          doc.restore();
        }
        textX = x + IMAGE_W + 14;
      }
      const textW = inner - (textX - x);
      const nameW = textW - (price ? PRICE_W : 0);
      let cursor = y;
      cursor += drawText(doc, name, textX, cursor, { width: nameW, size: 13, font: FONT.semi, color: INK });
      if (price) {
        drawText(doc, price, textX + textW - PRICE_W, y, { width: PRICE_W, size: 13, font: FONT.bold, color: INK, align: 'right' });
      }
      for (const [text, color] of [[lines.place, MUTED], [lines.stay, BODY], [lines.when, BODY]]) {
        if (!text) continue;
        cursor += 6;
        cursor += drawText(doc, text, textX, cursor, { width: textW, size: 9.5, font: FONT.regular, color });
      }
      if (item.description) {
        cursor += 8;
        drawText(doc, item.description, textX, cursor, { width: textW, size: 9, font: FONT.regular, color: MUTED, lineGap: 0 });
      }
    },
  });
}

function drawFlight(page, item, currency) {
  const { doc } = page;
  const price = money(item.price, item.currency || currency);
  const direction = item.direction === 'return' ? 'Return' : item.direction === 'outbound' ? 'Outbound' : null;
  const who = [item.airline, item.flight_number].filter(Boolean).join(' ') || item.title || 'Flight';
  const from = item.departure_airport || item.departure_city || '';
  const to = item.arrival_airport || item.arrival_city || '';
  const fromCity = item.departure_airport && item.departure_city ? item.departure_city : '';
  const toCity = item.arrival_airport && item.arrival_city ? item.arrival_city : '';
  const middle = [item.duration, stopsText(item.stops)].filter(Boolean).join('  ·  ');
  const hasRoute = Boolean(from || to);

  page.card({
    measure(inner) {
      let h = 18;
      if (hasRoute) h += 12 + 44;
      if (item.description) h += 8 + measureTextHeight(doc, item.description, { width: inner, size: 9, font: FONT.regular, lineGap: 0 });
      return h;
    },
    draw(x, y, inner) {
      let cursor = y;
      let textX = x;
      if (direction) {
        textX += page.chip(direction, x, cursor - 1) + 8;
      }
      drawText(doc, who, textX, cursor + 1, { width: inner - (textX - x) - (price ? PRICE_W : 0), size: 12, font: FONT.semi, color: INK });
      if (price) drawText(doc, price, x + inner - PRICE_W, cursor, { width: PRICE_W, size: 13, font: FONT.bold, color: INK, align: 'right' });
      cursor += 18;

      if (hasRoute) {
        cursor += 12;
        const side = 150;
        drawText(doc, from || '—', x, cursor, { width: side, size: 20, font: FONT.bold, color: INK });
        drawText(doc, [fromCity, dateTime(item.departure_time)].filter(Boolean).join('  ·  '), x, cursor + 26, { width: side + 40, size: 8.5, font: FONT.regular, color: MUTED });
        drawText(doc, to || '—', x + inner - side, cursor, { width: side, size: 20, font: FONT.bold, color: INK, align: 'right' });
        drawText(doc, [toCity, dateTime(item.arrival_time)].filter(Boolean).join('  ·  '), x + inner - side - 40, cursor + 26, { width: side + 40, size: 8.5, font: FONT.regular, color: MUTED, align: 'right' });

        // The line between them, with the duration above it.
        const lineY = cursor + 12;
        const x1 = x + side * 0.55;
        const x2 = x + inner - side * 0.55;
        doc.moveTo(x1, lineY).lineTo(x2 - 4, lineY).lineWidth(1).strokeColor(tint(page.color, 0.4)).stroke();
        doc.polygon([x2, lineY], [x2 - 6, lineY - 3.5], [x2 - 6, lineY + 3.5]).fill(tint(page.color, 0.4));
        if (middle) drawText(doc, middle, x1, lineY - 14, { width: x2 - x1, size: 8.5, font: FONT.regular, color: MUTED, align: 'center' });
        cursor += 44;
      }
      if (item.description) {
        cursor += 8;
        drawText(doc, item.description, x, cursor, { width: inner, size: 9, font: FONT.regular, color: MUTED, lineGap: 0 });
      }
    },
  });
}

/* ── the document ──────────────────────────────────────────────────────── */

export function quoteSubtitle(quote) {
  const kind = TYPE_LABEL[quote.quote_type];
  return [kind ? `${kind} quotation` : 'Quotation', quote.destination].filter(Boolean).join('  ·  ');
}

export function quoteFacts(quote) {
  const period = quote.availability_mode === 'period';
  const route = quote.origin && quote.destination ? `${quote.origin} → ${quote.destination}` : quote.destination;
  return [
    { label: quote.origin ? 'Route' : 'Destination', value: route },
    {
      label: period ? 'Available' : 'Dates',
      value: period
        ? formatMonthList(quote.available_months)?.replace(/^Available:\s*/, '')
        : quote.travel_date && quote.return_date
          ? dateRangeCompact(quote.travel_date, quote.return_date)
          : dateRange(quote.travel_date, quote.return_date),
    },
    { label: 'Duration', value: nightsText(quote.nights) },
    { label: 'Travellers', value: travellers(quote.adults_count, quote.children_count) },
  ];
}

async function renderQuotePdf(quote, doc, agency) {
  const hotels = (quote.items || []).filter((item) => item.item_type === 'hotel');
  const flights = (quote.items || []).filter((item) => item.item_type === 'flight');
  const currency = quote.currency || 'USD';
  const total = money(displayTotal(quote), currency);

  const page = await Page.start(doc, agency, {
    runningTitle: quote.title,
    label: TYPE_LABEL[quote.quote_type] || 'Quotation',
    issued: formatDate(new Date().toISOString()),
  });

  page.hero(quote.title, quoteSubtitle(quote));
  page.facts(quoteFacts(quote));
  page.paragraph(quote.description);
  page.image(await fetchImage(quote.cover_image_url));

  if (hotels.length) {
    page.section(hotels.length === 1 ? 'Your hotel' : 'Your hotels');
    for (const hotel of hotels) drawHotel(page, hotel, currency, await fetchImage(hotel.image_url));
    page.gap(6);
  }
  if (flights.length) {
    page.section(flights.length === 1 ? 'Your flight' : 'Your flights');
    for (const flight of flights) drawFlight(page, flight, currency);
    page.gap(6);
  }

  const period = quote.availability_mode === 'period';
  page.priceBlock({
    amount: total,
    caption: [
      travellers(quote.adults_count, quote.children_count) && `For ${travellers(quote.adults_count, quote.children_count)}`,
      period ? formatMonthList(quote.available_months) : null,
    ].filter(Boolean).join('  ·  '),
  });

  page.note('Notes', quote.notes);
  page.note('Terms', page.brand.quotation_footer, { fill: '#F8FAFC', stroke: LINE });
  page.contact();
  page.finish();
}

export async function pipeQuotePdf(quote, res, agency) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${quoteFilename(quote)}"`);
  const doc = createDocument({ title: quote.title, author: agency?.agency_name });
  doc.pipe(res);
  await renderQuotePdf(quote, doc, agency);
}

/** The same PDF as a Buffer — for tests and anything that wants to attach it. */
export function buildQuotePdfBuffer(quote, agency) {
  return new Promise((resolve, reject) => {
    const doc = createDocument({ title: quote.title, author: agency?.agency_name });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderQuotePdf(quote, doc, agency).catch(reject);
  });
}

export { CONTENT_W };
