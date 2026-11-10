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
import { drawText, measureTextHeight } from './pdfText.js';
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

function nightsText(nights) {
  return nights ? `${nights} night${Number(nights) === 1 ? '' : 's'}` : null;
}

/** What to say about one included item, as short labelled lines. */
export function itemLines(item) {
  const meta = item.meta || {};
  const lines = [];
  // Don't repeat a name the heading already says ("Bosphorus Grand Hotel · 4-star").
  const said = (name) => String(item.label || '').toLowerCase().includes(String(name || '').toLowerCase());
  if (meta.hotel_name && !said(meta.hotel_name)) lines.push({ text: meta.hotel_name });
  const stay = [meta.room_type, meta.board_name].filter(Boolean).join('  ·  ');
  if (stay) lines.push({ text: stay });
  const when = [dateRange(meta.check_in, meta.check_out), nightsText(meta.nights)].filter(Boolean).join('  ·  ');
  if (when) lines.push({ text: when });
  if (meta.airline && !said(meta.airline)) lines.push({ text: meta.airline });
  if (meta.includes) lines.push({ text: `Includes: ${meta.includes}` });
  const cancel = meta.cancellation_policy || meta.cancellation_terms;
  if (cancel) lines.push({ text: cancel, good: true });
  return lines;
}

function drawIncluded(page, item) {
  const { doc } = page;
  const lines = itemLines(item);
  const label = item.label || 'Included';

  page.card({
    measure(inner) {
      const textW = inner - 26;
      let h = measureTextHeight(doc, label, { width: textW, size: 12, font: FONT.semi });
      if (item.description) h += 4 + measureTextHeight(doc, item.description, { width: textW, size: 9.5, font: FONT.regular, lineGap: 0 });
      for (const line of lines) h += 5 + measureTextHeight(doc, line.text, { width: textW - (line.good ? 14 : 0), size: 9.5, font: FONT.regular, lineGap: 0 });
      return h;
    },
    draw(x, y, inner) {
      const textX = x + 26;
      const textW = inner - 26;
      // A check mark in the brand colour: this is part of what the customer gets.
      doc.circle(x + 8, y + 9, 8).fill(page.color);
      doc.moveTo(x + 4.5, y + 9.2).lineTo(x + 7, y + 11.8).lineTo(x + 11.8, y + 6.4).lineWidth(1.6).lineCap('round').lineJoin('round').strokeColor('#FFFFFF').stroke();

      let cursor = y;
      cursor += drawText(doc, label, textX, cursor, { width: textW, size: 12, font: FONT.semi, color: INK });
      if (item.description) {
        cursor += 4;
        cursor += drawText(doc, item.description, textX, cursor, { width: textW, size: 9.5, font: FONT.regular, color: MUTED, lineGap: 0 });
      }
      for (const line of lines) {
        cursor += 5;
        const indent = line.good ? 14 : 0;
        if (line.good) {
          doc.moveTo(textX + 1, cursor + 6.5).lineTo(textX + 4, cursor + 9.5).lineTo(textX + 9.5, cursor + 3.5).lineWidth(1.3).lineCap('round').lineJoin('round').strokeColor(GREEN).stroke();
        }
        cursor += drawText(doc, line.text, textX + indent, cursor, {
          width: textW - indent, size: 9.5, font: line.good ? FONT.semi : FONT.regular, color: line.good ? GREEN : BODY, lineGap: 0,
        });
      }
    },
  });
}

export function snapshotFacts(snapshot) {
  const lead = snapshot.lead || {};
  const route = lead.origin && lead.destination ? `${lead.origin} → ${lead.destination}` : lead.destination;
  return [
    { label: lead.origin ? 'Route' : 'Destination', value: route },
    {
      label: 'Dates',
      value: lead.travel_date && lead.return_date
        ? dateRangeCompact(lead.travel_date, lead.return_date)
        : dateRange(lead.travel_date, lead.return_date),
    },
    { label: 'Duration', value: nightsText(lead.nights) },
    { label: 'Travellers', value: lead.adults_count != null ? travellers(lead.adults_count, lead.children_count) : null },
  ];
}

async function renderQuotationPdf(rawSnapshot, doc, agency) {
  const snapshot = publicQuoteSnapshot(rawSnapshot);
  const lead = snapshot.lead || {};
  const currency = snapshot.currency || 'USD';
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const customer = lead.customer_name || lead.contact_name;
  const title = snapshot.title || 'Travel quote';

  const page = await Page.start(doc, agency, {
    runningTitle: title,
    label: snapshot.version_number ? `Quote v${snapshot.version_number}` : 'Quotation',
    issued: formatDate(new Date().toISOString()),
  });

  page.hero(title, customer ? `Prepared for ${customer}` : 'Your travel quotation');
  page.facts(snapshotFacts(snapshot));

  if (items.length) {
    page.section("What's included");
    for (const item of items) drawIncluded(page, item);
    page.gap(6);
  }

  const travellerText = lead.adults_count != null ? travellers(lead.adults_count, lead.children_count) : null;
  page.priceBlock({
    amount: money(snapshot.pricing?.selling_price, currency),
    caption: [
      travellerText && `For ${travellerText}`,
      snapshot.valid_until && `Valid until ${formatDate(snapshot.valid_until)}`,
    ].filter(Boolean).join('  ·  '),
  });

  page.note('Notes', snapshot.notes);
  page.note('Terms', page.brand.quotation_footer, { fill: '#F8FAFC', stroke: '#E2E8F0' });
  page.contact();
  page.finish();
}

// ── public API ────────────────────────────────────────────────────────────────

/** Pipe a quotation PDF directly to an HTTP response. */
export async function pipeVersionPdf(snapshot, res, agency) {
  const filename = `quote-v${snapshot.version_number || 1}-${Date.now()}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = createDocument({ title: snapshot.title, author: agency?.agency_name });
  doc.pipe(res);
  await renderQuotationPdf(snapshot, doc, agency);
}

/** Render to a Buffer (for email attachments). */
export function buildVersionPdfBuffer(snapshot, agency) {
  return new Promise((resolve, reject) => {
    const doc = createDocument({ title: snapshot.title, author: agency?.agency_name });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderQuotationPdf(snapshot, doc, agency).catch(reject);
  });
}
