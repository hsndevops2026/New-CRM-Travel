import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildQuotePdfBuffer, quoteFacts, quoteSubtitle } from '../services/predefinedQuotePdf.js';
import { buildVersionPdfBuffer, itemLines, snapshotFacts } from '../services/quotationPdf.js';
import { dateRangeCompact, readableOn, tint } from '../services/pdfTheme.js';

const agency = {
  agency_name: 'Horizon Travel', primary_color: '#0f766e', phone: '+971 4 555 0188', email: 'hello@horizon.ae',
  quotation_footer: 'Prices are indicative.', logo_url: null,
};

const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
const isPdf = (buffer) => buffer.subarray(0, 5).toString() === '%PDF-';

const hotel = (over = {}) => ({ item_type: 'hotel', hotel_name: 'Bosphorus Grand', city: 'Istanbul', country: 'Turkey', price: 720, currency: 'USD', ...over });
const flight = (over = {}) => ({ item_type: 'flight', airline: 'Turkish Airlines', flight_number: 'TK761', departure_airport: 'DXB', arrival_airport: 'IST', direction: 'outbound', price: 640, currency: 'USD', ...over });
const quote = (over = {}) => ({
  title: 'Istanbul Winter Family', quote_type: 'package', destination: 'Istanbul', origin: 'Dubai', currency: 'USD', total_price: 2298,
  travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1, availability_mode: 'fixed',
  items: [hotel(), flight()], ...over,
});

describe('library quote PDF', () => {
  it('produces a PDF', async () => {
    const pdf = await buildQuotePdfBuffer(quote(), agency);
    assert.ok(isPdf(pdf));
    assert.ok(pdf.length > 5_000);
    assert.equal(pageCount(pdf), 1);
  });

  it('copes with Arabic, Turkish and symbols in every text field', async () => {
    const pdf = await buildQuotePdfBuffer(
      quote({
        title: 'ميفنبيك ريزورت طابا',
        description: 'إقامة فاخرة في طابا — Beşiktaş ★★★★★ with sea view',
        notes: 'ملاحظات: الإفطار مشمول',
        items: [hotel({ hotel_name: 'ميفنبيك ريزورت', city: 'طابا', category: '5★', room_name: 'ستاندرد روم', description: 'İstanbul ğ ş ı' })],
      }),
      agency,
    );
    assert.ok(isPdf(pdf));
  });

  it('starts a new page rather than cutting a card in two, and numbers every page', async () => {
    const many = Array.from({ length: 14 }, (_, i) => hotel({ hotel_name: `Hotel number ${i + 1}`, description: 'A long description of what is nice about this hotel. '.repeat(3) }));
    const pdf = await buildQuotePdfBuffer(quote({ items: many }), agency);
    const pages = pageCount(pdf);
    assert.ok(pages >= 3, `expected several pages, got ${pages}`);
    assert.ok(isPdf(pdf));
  });

  it('survives a cover image that cannot be downloaded', async () => {
    const pdf = await buildQuotePdfBuffer(
      quote({ cover_image_url: 'http://127.0.0.1:1/missing.jpg', items: [hotel({ image_url: 'http://127.0.0.1:1/hotel.jpg' })] }),
      agency,
    );
    assert.ok(isPdf(pdf));
  });

  it('copes with a bare quote: no description, notes, prices or dates', async () => {
    const pdf = await buildQuotePdfBuffer(
      { title: 'Bare', quote_type: 'hotel', items: [{ item_type: 'hotel', hotel_name: 'Plain Inn' }] },
      {},
    );
    assert.ok(isPdf(pdf));
  });

  it('describes a period package by its months, not dates', () => {
    const facts = quoteFacts(quote({ availability_mode: 'period', available_months: [1, 2, 10], travel_date: null, return_date: null }));
    const when = facts.find((f) => f.label === 'Available');
    assert.equal(when.value, 'January, February, October');
    assert.ok(!facts.some((f) => f.label === 'Dates'));
  });

  it('shows a fixed package’s dates compactly and its route as a route', () => {
    const facts = quoteFacts(quote());
    assert.equal(facts.find((f) => f.label === 'Dates').value, '12–18 Dec 2026');
    assert.equal(facts.find((f) => f.label === 'Route').value, 'Dubai → Istanbul');
    assert.equal(facts.find((f) => f.label === 'Travellers').value, '2 adults, 1 child');
    assert.equal(quoteSubtitle(quote()), 'Flight + Hotel quotation  ·  Istanbul');
  });
});

describe('customer quote PDF', () => {
  const snapshot = (over = {}) => ({
    title: 'Istanbul family winter break', version_number: 2, currency: 'USD', valid_until: '2026-11-25', notes: 'Breakfast daily.',
    lead: { destination: 'Istanbul', origin: 'Dubai', travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1, customer_name: 'Sarah Ahmed' },
    items: [{ label: 'Bosphorus Grand Hotel · 4★', description: 'Beşiktaş', net_cost: 720, meta: { hotel_name: 'Bosphorus Grand Hotel', cancellation_policy: 'Free cancellation until 5 Dec' } }],
    pricing: { selling_price: 2298, net_total: 1000, markup_amount: 1298 },
    ...over,
  });

  it('produces a PDF, as a buffer ready to attach', async () => {
    const pdf = await buildVersionPdfBuffer(snapshot(), agency);
    assert.ok(isPdf(pdf));
    assert.ok(pdf.length > 5_000);
  });

  it('copes with Arabic item names and many items', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ label: i % 2 ? 'ميفنبيك ريزورت طابا' : `Hotel ${i}`, description: 'x '.repeat(80), meta: { room_type: 'ستاندرد روم' } }));
    const pdf = await buildVersionPdfBuffer(snapshot({ items }), agency);
    assert.ok(isPdf(pdf));
    assert.ok(pageCount(pdf) >= 2);
  });

  it('works with no items and no lead details', async () => {
    const pdf = await buildVersionPdfBuffer({ title: 'Minimal', pricing: { selling_price: 500 }, items: [] }, agency);
    assert.ok(isPdf(pdf));
  });

  it('lists only customer-facing facts for an item, never repeating the heading', () => {
    const lines = itemLines({
      label: 'Bosphorus Grand Hotel · 4★',
      net_cost: 720,
      meta: { hotel_name: 'Bosphorus Grand Hotel', room_type: 'Family room', board_name: 'Breakfast', airline: 'Turkish Airlines', cancellation_policy: 'Free cancellation until 5 Dec', internal_note: 'dealer margin 12%' },
    });
    assert.deepEqual(lines.map((l) => l.text), ['Family room  ·  Breakfast', 'Turkish Airlines', 'Free cancellation until 5 Dec']);
    assert.equal(lines.find((l) => l.good).text, 'Free cancellation until 5 Dec');
    assert.ok(!JSON.stringify(lines).includes('dealer'));
  });

  it('gives the customer’s trip as facts', () => {
    const facts = snapshotFacts(snapshot());
    assert.equal(facts.find((f) => f.label === 'Dates').value, '12–18 Dec 2026');
    assert.equal(facts.find((f) => f.label === 'Duration').value, '6 nights');
  });
});

describe('theme helpers', () => {
  it('shortens date ranges when they share a month or a year', () => {
    assert.equal(dateRangeCompact('2026-12-12', '2026-12-18'), '12–18 Dec 2026');
    assert.equal(dateRangeCompact('2026-11-28', '2026-12-03'), '28 Nov – 3 Dec 2026');
    assert.equal(dateRangeCompact('2026-12-28', '2027-01-03'), '28 Dec 2026 → 3 Jan 2027');
    assert.equal(dateRangeCompact('2026-12-12', '2026-12-12'), '12 Dec 2026');
  });

  it('picks text that can be read on the brand colour, light or dark', () => {
    assert.equal(readableOn('#0f766e'), '#FFFFFF');
    assert.equal(readableOn('#facc15'), '#0F172A');
    assert.equal(readableOn('not a colour'), '#FFFFFF');
  });

  it('tints towards white', () => {
    assert.equal(tint('#000000', 0.5), '#808080');
    assert.equal(tint('#0f766e', 1), '#ffffff');
    assert.equal(tint('#0f766e', 0), '#0f766e');
  });
});

describe('page layout', () => {
  it('moves a card to the next page when it would not fit, instead of splitting it', async () => {
    const { Page, createDocument, PAGE } = await import('../services/pdfTheme.js');
    const doc = createDocument({ title: 't' });
    const page = await Page.start(doc, agency, { label: 'Test' });
    let drawnAt = null;

    page.y = PAGE.height - PAGE.footer - 60; // 60pt of room left
    page.card({ measure: () => 100, draw: (x, y) => { drawnAt = y; } });

    assert.equal(doc.bufferedPageRange().count, 2, 'a second page was started');
    assert.ok(drawnAt < 100, `the card sits at the top of the new page (y=${drawnAt})`);
    doc.end();
  });

  it('keeps a card that fits on the page it started on', async () => {
    const { Page, createDocument, PAGE } = await import('../services/pdfTheme.js');
    const doc = createDocument({ title: 't' });
    const page = await Page.start(doc, agency, { label: 'Test' });
    page.y = PAGE.height - PAGE.footer - 200;
    page.card({ measure: () => 100, draw: () => {} });
    assert.equal(doc.bufferedPageRange().count, 1);
    doc.end();
  });

  it('finishes a multi-page document, footers included, as a complete PDF', async () => {
    const { Page, createDocument, PAGE } = await import('../services/pdfTheme.js');
    const doc = createDocument({ title: 't' });
    const page = await Page.start(doc, agency, { label: 'Test' });
    page.y = PAGE.height - PAGE.footer - 60;
    page.card({ measure: () => 100, draw: () => {} });
    assert.equal(doc.bufferedPageRange().count, 2);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));
    page.finish();
    await done;
    const pdf = Buffer.concat(chunks);
    assert.ok(isPdf(pdf));
    assert.equal(pageCount(pdf), 2);
  });
});

describe('download responses', () => {
  const fakeResponse = async () => {
    const { PassThrough } = await import('node:stream');
    const res = new PassThrough();
    res.headers = {};
    res.setHeader = (name, value) => { res.headers[name] = value; };
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    const finished = new Promise((resolve) => res.on('end', resolve));
    return { res, chunks, finished };
  };

  it('sends the library quote as an attachment named after it', async () => {
    const { pipeQuotePdf } = await import('../services/predefinedQuotePdf.js');
    const { res, chunks, finished } = await fakeResponse();
    await pipeQuotePdf(quote({ title: 'Dubai Family Package' }), res, agency);
    await finished;
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.match(res.headers['Content-Disposition'], /attachment; filename="dubai-family-package\.pdf"/);
    assert.ok(isPdf(Buffer.concat(chunks)));
  });

  it('sends the customer’s quote as an attachment too', async () => {
    const { pipeVersionPdf } = await import('../services/quotationPdf.js');
    const { res, chunks, finished } = await fakeResponse();
    await pipeVersionPdf({ title: 'T', version_number: 3, pricing: { selling_price: 100 }, items: [] }, res, agency);
    await finished;
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.match(res.headers['Content-Disposition'], /attachment; filename="quote-v3-\d+\.pdf"/);
    assert.ok(isPdf(Buffer.concat(chunks)));
  });
});
