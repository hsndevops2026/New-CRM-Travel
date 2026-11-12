/**
 * The customer's quotation PDF, rendered from a locked quote version's snapshot.
 * Pipes to an HTTP response or returns a Buffer (for email attachments).
 *
 * snapshot shape:
 *   { title, lead, items, pricing, currency, notes, valid_until, version_number }
 *
 * Only customer-facing details are drawn — `publicQuoteSnapshot` strips costs and markup.
 * It uses the same look as the library package PDF (see pdfTheme.js).
 */

import { publicQuoteSnapshot } from './publicQuote.js';
import { customerLanguage } from './customerLanguage.js';
import { L, dateLabel, dateRangeLabel, nightsLabel, pdfLang, travellersLabel } from './pdfStrings.js';
import { drawText, hasArabic, measureTextHeight } from './pdfText.js';
import {
  BODY,
  FONT,
  INK,
  MUTED,
  Page,
  createDocument,
  dateRange,
  dateRangeCompact,
  formatDate,
  money,
  travellers,
} from './pdfTheme.js';

const GREEN = '#0F766E';

function nightsText(nights, lang = 'en') {
  return nightsLabel(nights, lang);
}

/** What to say about one included item, as short labelled lines. */
export function itemLines(item, lang = 'en') {
  const meta = item.meta || {};
  const lines = [];
  // Don't repeat a name the heading already says ("Bosphorus Grand Hotel · 4-star").
  const said = (name) => String(item.label || '').toLowerCase().includes(String(name || '').toLowerCase());
  if (meta.hotel_name && !said(meta.hotel_name)) lines.push({ text: meta.hotel_name });
  const stay = [meta.room_type, meta.board_name].filter(Boolean).join('  ·  ');
  if (stay) lines.push({ text: stay });
  const when = [lang === 'ar' ? dateRangeLabel(meta.check_in, meta.check_out, lang) : dateRange(meta.check_in, meta.check_out), nightsText(meta.nights, lang)].filter(Boolean).join('  ·  ');
  if (when) lines.push({ text: when });
  if (meta.airline && !said(meta.airline)) lines.push({ text: meta.airline });
  if (meta.includes) lines.push({ text: L(lang, 'includes', { text: meta.includes }) });
  const cancel = meta.cancellation_policy || meta.cancellation_terms;
  if (cancel) lines.push({ text: cancel, good: true });
  return lines;
}

function drawIncluded(page, item) {
  const { doc } = page;
  const lines = itemLines(item, page.lang);
  const label = item.label || L(page.lang, 'included_item');
  const t = (opts) => page.text(opts);

  page.card({
    measure(inner) {
      const textW = inner - 26;
      let h = measureTextHeight(doc, label, t({ width: textW, size: 12, font: FONT.semi }));
      if (item.description) h += 4 + measureTextHeight(doc, item.description, t({ width: textW, size: 9.5, font: FONT.regular, lineGap: 0 }));
      for (const line of lines) h += 5 + measureTextHeight(doc, line.text, t({ width: textW - (line.good ? 14 : 0), size: 9.5, font: FONT.regular, lineGap: 0 }));
      return h;
    },
    draw(x, y, inner) {
      const textW = inner - 26;
      // Check mark on the reading side; text next to it.
      const markX = page.rtl ? x + inner - 16 : x;
      const textX = page.rtl ? x : x + 26;
      // A check mark in the brand colour: this is part of what the customer gets.
      doc.circle(markX + 8, y + 9, 8).fill(page.color);
      doc.moveTo(markX + 4.5, y + 9.2).lineTo(markX + 7, y + 11.8).lineTo(markX + 11.8, y + 6.4).lineWidth(1.6).lineCap('round').lineJoin('round').strokeColor('#FFFFFF').stroke();

      let cursor = y;
      cursor += drawText(doc, label, textX, cursor, t({ width: textW, size: 12, font: FONT.semi, color: INK }));
      if (item.description) {
        cursor += 4;
        cursor += drawText(doc, item.description, textX, cursor, t({ width: textW, size: 9.5, font: FONT.regular, color: MUTED, lineGap: 0 }));
      }
      for (const line of lines) {
        cursor += 5;
        const indent = line.good ? 14 : 0;
        if (line.good) {
          const tickX = page.rtl ? textX + textW - 10 : textX;
          doc.moveTo(tickX + 1, cursor + 6.5).lineTo(tickX + 4, cursor + 9.5).lineTo(tickX + 9.5, cursor + 3.5).lineWidth(1.3).lineCap('round').lineJoin('round').strokeColor(GREEN).stroke();
        }
        cursor += drawText(doc, line.text, page.rtl ? textX : textX + indent, cursor, t({
          width: textW - indent, size: 9.5, font: line.good ? FONT.semi : FONT.regular, color: line.good ? GREEN : BODY, lineGap: 0,
        }));
      }
    },
  });
}

export function snapshotFacts(snapshot, lang = 'en') {
  const lead = snapshot.lead || {};
  const ar = lang === 'ar';
  // Arabic place names read right to left, so the arrow points left between them.
  const arrow = ar && hasArabic(`${lead.origin || ''}${lead.destination || ''}`) ? '←' : '→';
  const route = lead.origin && lead.destination ? `${lead.origin} ${arrow} ${lead.destination}` : lead.destination;
  const dates = ar
    ? dateRangeLabel(lead.travel_date, lead.return_date, lang)
    : lead.travel_date && lead.return_date
      ? dateRangeCompact(lead.travel_date, lead.return_date)
      : dateRange(lead.travel_date, lead.return_date);
  return [
    { label: L(lang, lead.origin ? 'route' : 'destination'), value: route },
    { label: L(lang, 'dates'), value: dates },
    { label: L(lang, 'duration'), value: nightsText(lead.nights, lang) },
    { label: L(lang, 'travellers'), value: lead.adults_count != null ? travellersLabel(lead.adults_count, lead.children_count, lang) : null },
  ];
}

/** The PDF's language: asked for, else the customer's message language. Hebrew comes later, so it falls back to English. */
export async function quotePdfLanguage(rawSnapshot, requested) {
  if (requested === 'ar' || requested === 'en') return requested;
  const phone = rawSnapshot?.lead?.phone;
  try {
    return pdfLang(await customerLanguage(phone));
  } catch {
    return 'ar';
  }
}

async function renderQuotationPdf(rawSnapshot, doc, agency, lang = 'en') {
  const snapshot = publicQuoteSnapshot(rawSnapshot);
  const lead = snapshot.lead || {};
  const currency = snapshot.currency || 'USD';
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const customer = lead.customer_name || lead.contact_name;
  const title = snapshot.title || L(lang, 'travel_quote');
  const date = (value) => (lang === 'ar' ? dateLabel(value, lang) : formatDate(value));

  const page = await Page.start(doc, agency, {
    lang,
    runningTitle: title,
    subtitle: L(lang, 'travel_quotation'),
    label: snapshot.version_number ? L(lang, 'quote_v', { n: snapshot.version_number }) : L(lang, 'quotation'),
    issued: date(new Date().toISOString()),
    labels: {
      contact: (agencyName) => L(lang, 'questions', { agency: agencyName }),
      preparedBy: (agencyName) => L(lang, 'prepared_by', { agency: agencyName }),
      pageOf: (n, count) => L(lang, 'page_of', { n, count }),
      issued: (value) => L(lang, 'issued', { date: value }),
    },
  });

  page.hero(title, customer ? L(lang, 'prepared_for', { name: customer }) : L(lang, 'your_quotation'));
  page.facts(snapshotFacts(snapshot, lang));

  if (items.length) {
    page.section(L(lang, 'included'));
    for (const item of items) drawIncluded(page, item);
    page.gap(6);
  }

  const travellerText = lead.adults_count != null ? travellersLabel(lead.adults_count, lead.children_count, lang) : null;
  page.priceBlock({
    label: L(lang, 'total_price'),
    amount: money(snapshot.pricing?.selling_price, currency),
    caption: [
      travellerText && L(lang, 'for_travellers', { who: travellerText }),
      snapshot.valid_until && L(lang, 'valid_until', { date: date(snapshot.valid_until) }),
    ].filter(Boolean).join('  ·  '),
  });

  page.note(L(lang, 'notes'), snapshot.notes);
  page.note(L(lang, 'terms'), page.brand.quotation_footer, { fill: '#F8FAFC', stroke: '#E2E8F0' });
  page.contact();
  page.finish();
}

// ── public API ────────────────────────────────────────────────────────────────

/** Pipe a quotation PDF directly to an HTTP response. */
export async function pipeVersionPdf(snapshot, res, agency, lang = 'en') {
  const filename = `quote-v${snapshot.version_number || 1}-${Date.now()}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = createDocument({ title: snapshot.title, author: agency?.agency_name });
  doc.pipe(res);
  await renderQuotationPdf(snapshot, doc, agency, lang);
}

/** Render to a Buffer (for email attachments). */
export function buildVersionPdfBuffer(snapshot, agency, lang = 'en') {
  return new Promise((resolve, reject) => {
    const doc = createDocument({ title: snapshot.title, author: agency?.agency_name });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderQuotationPdf(snapshot, doc, agency, lang).catch(reject);
  });
}
