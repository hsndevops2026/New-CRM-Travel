import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  approvePredefinedQuoteImport,
  detectBrochureKind,
  documentText,
  findExistingPackage,
  importPredefinedQuoteBrochure,
  spreadsheetToText,
} from '../services/predefinedQuoteImports.js';
import { createPredefinedQuote } from '../services/predefinedQuotes.js';
import { emailBodyText } from '../routes/predefinedQuotes.js';

const xlsx = fs.readFileSync(new URL('./fixtures/hilton-rates.xlsx', import.meta.url));

function hotelPackage({ title, hotel, destination = 'Sharm El Sheikh', checkIn = '2027-01-01', checkOut = '2027-01-07', price = 899, mode }) {
  return {
    title,
    destination,
    availability_mode: mode,
    available_months: mode === 'period' ? [1] : undefined,
    travel_date: mode === 'period' ? null : checkIn,
    return_date: mode === 'period' ? null : checkOut,
    currency: 'USD',
    total_price: price,
    items: [{ item_type: 'hotel', hotel_name: hotel, check_in: checkIn, check_out: checkOut, price }],
  };
}

describe('reading more file types', () => {
  it('recognises Excel, CSV and plain text', () => {
    assert.equal(detectBrochureKind(xlsx, { fileName: 'Hilton Jan.XLSX' }), 'xlsx');
    assert.equal(
      detectBrochureKind(xlsx, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      'xlsx',
    );
    assert.equal(detectBrochureKind(Buffer.from('hotel,price\nHilton,899\n'), { fileName: 'rates.csv' }), 'csv');
    assert.equal(detectBrochureKind(Buffer.from('New prices for January'), { contentType: 'text/plain' }), 'text');
  });

  it('a zip that is not named as Excel is still refused', () => {
    assert.throws(() => detectBrochureKind(xlsx, { fileName: 'brochure.docx' }), (error) => error.status === 400);
  });

  it('asks for .xlsx when given the old .xls format', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    assert.throws(() => detectBrochureKind(ole, { fileName: 'rates.xls' }), /save it as \.xlsx/);
  });

  it('turns every sheet into rows of cells, dates as days, empty rows dropped', async () => {
    const text = await spreadsheetToText(xlsx);
    assert.match(text, /## Sheet: Jan 2027/);
    assert.match(text, /Hilton Sharm Dreams \| Double \| All inclusive \| 2027-01-01 \| 2027-01-07 \| 899/);
    assert.match(text, /هيلتون شرم \| غرفة عائلية/);
    assert.match(text, /## Sheet: Notes\nPrices per person/);
    assert.doesNotMatch(text, /\n\n\n/);
  });

  it('refuses a broken spreadsheet with a clear message', async () => {
    await assert.rejects(spreadsheetToText(Buffer.from('PK\x03\x04garbage')), /Could not read this Excel file/);
  });

  it('strips a byte-order mark and cuts very long text with a warning', async () => {
    const small = await documentText(Buffer.from('﻿hotel,price'), 'csv');
    assert.equal(small.text, 'hotel,price');
    const long = await documentText(Buffer.from('x'.repeat(200_000)), 'text');
    assert.equal(long.truncated, true);
    assert.equal(long.text.length, 160_000);
  });

  it('reads the visible text of an HTML email, table cells kept apart', () => {
    const text = emailBodyText({
      html: '<style>p{}</style><p>Dear partner,</p><table><tr><td>Hilton</td><td>899&nbsp;USD</td></tr></table>',
    });
    assert.match(text, /Dear partner,/);
    assert.match(text, /Hilton \| 899 USD/);
    assert.doesNotMatch(text, /p\{\}/);
    assert.equal(emailBodyText({ text: 'plain wins', html: '<b>x</b>' }), 'plain wins');
  });
});

describe('matching an import to the package it updates', () => {
  const library = [
    { id: 'jan', ...hotelPackage({ title: 'Hilton Sharm - January', hotel: 'Hilton Sharm Dreams' }) },
    { id: 'rixos', ...hotelPackage({ title: 'Rixos week', hotel: 'Rixos Sharm' }) },
    { id: 'dubai', ...hotelPackage({ title: 'Hilton Dubai', hotel: 'Hilton Sharm Dreams', destination: 'Dubai' }) },
  ];

  it('same hotel, overlapping dates → the existing package', () => {
    const next = hotelPackage({ title: 'Hilton Sharm Dreams Jan 2027', hotel: 'hilton sharm  dreams', checkIn: '2027-01-03', checkOut: '2027-01-10', price: 949 });
    assert.equal(findExistingPackage(next, library)?.id, 'jan');
  });

  it('same title → the existing package, whatever the dates', () => {
    const next = hotelPackage({ title: 'Rixos Week', hotel: 'Rixos Premium', checkIn: '2027-03-01', checkOut: '2027-03-07' });
    assert.equal(findExistingPackage(next, library)?.id, 'rixos');
  });

  it('same hotel for other weeks stays a new package', () => {
    const later = hotelPackage({ title: 'Hilton March', hotel: 'Hilton Sharm Dreams', checkIn: '2027-03-01', checkOut: '2027-03-07' });
    assert.equal(findExistingPackage(later, library), null);
  });

  it('a package sold by month matches any dates of the same hotel', () => {
    const monthly = [{ id: 'm', ...hotelPackage({ title: 'Hilton monthly', hotel: 'Hilton Sharm Dreams', mode: 'period' }) }];
    const later = hotelPackage({ title: 'Hilton March', hotel: 'Hilton Sharm Dreams', checkIn: '2027-03-01', checkOut: '2027-03-07' });
    assert.equal(findExistingPackage(later, monthly)?.id, 'm');
  });

  it('another destination never matches, and a tie suggests nothing', () => {
    const next = hotelPackage({ title: 'x', hotel: 'Hilton Sharm Dreams', destination: 'Dubai' });
    assert.equal(findExistingPackage(next, library)?.id, 'dubai');
    const twins = [library[0], { ...library[0], id: 'copy' }];
    assert.equal(findExistingPackage(hotelPackage({ title: 'y', hotel: 'Hilton Sharm Dreams' }), twins), null);
  });
});

describe('importing an Excel rate sheet end to end', () => {
  const quoteIds = [];
  const hashes = [];

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (hashes.length) await query('DELETE FROM predefined_quote_imports WHERE file_hash = ANY($1)', [hashes]);
    if (quoteIds.length) await query('DELETE FROM predefined_quotes WHERE id = ANY($1::uuid[])', [quoteIds]);
    await pool.end();
  });

  function fakeAi(extracted) {
    const seen = [];
    return {
      seen,
      responses: {
        create: async (request) => {
          seen.push(request.input[0].content[0]);
          if (request.text.format.name === 'brochure_outline') {
            return { status: 'completed', output_text: JSON.stringify({ offers: [], warnings: [] }) };
          }
          return { status: 'completed', output_text: JSON.stringify({ package: extracted, warnings: [] }) };
        },
      },
    };
  }

  it('reads the sheet as text and points the import at the package it updates', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const existing = await createPredefinedQuote(hotelPackage({ title: `Hilton test ${tag}`, hotel: `Hilton ${tag}` }));
    quoteIds.push(existing.id);

    // The fixture is the same every run, so clear any earlier read of it first.
    const buffer = Buffer.concat([xlsx]);
    hashes.push(crypto.createHash('sha256').update(buffer).digest('hex'));
    await query('DELETE FROM predefined_quote_imports WHERE file_hash = $1', [hashes[0]]);

    const extracted = {
      ...hotelPackage({ title: `Hilton ${tag} January`, hotel: `Hilton ${tag}`, price: 949 }),
      origin: null, description: null, cover_image_url: null, notes: null, nights: 6,
      adults_count: 2, children_count: 0,
    };
    delete extracted.availability_mode;
    delete extracted.available_months;
    const ai = fakeAi(extracted);

    const result = await importPredefinedQuoteBrochure({ buffer, fileName: 'Hilton Jan.xlsx', ai });
    const record = result.importRecords[0];

    assert.equal(ai.seen[0].type, 'input_text');
    assert.match(ai.seen[0].text, /Hilton Sharm Dreams \| Double/);
    assert.equal(record.target_quote_id, existing.id);
    assert.ok(!record.warnings.some((w) => /verify OCR/.test(w)), 'no "image" warning for a spreadsheet');

    // The reviewer chose "Create a new package": null must not fall back to the match.
    const asNew = await approvePredefinedQuoteImport(record.id, { payload: record.extracted_payload, targetQuoteId: null });
    quoteIds.push(asNew.quote.id);
    assert.notEqual(asNew.quote.id, existing.id);
  });

  it('approving with no choice updates the matched package', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const existing = await createPredefinedQuote(hotelPackage({ title: `Hilton up ${tag}`, hotel: `Hilton ${tag}` }));
    quoteIds.push(existing.id);
    const buffer = Buffer.from(`hotel,check in,check out,price\nHilton ${tag},2027-01-01,2027-01-07,949\n`);
    hashes.push(crypto.createHash('sha256').update(buffer).digest('hex'));

    const extracted = {
      ...hotelPackage({ title: `Hilton ${tag} new prices`, hotel: `Hilton ${tag}`, price: 949 }),
      origin: null, description: null, cover_image_url: null, notes: null, nights: 6,
      adults_count: 2, children_count: 0,
    };
    delete extracted.availability_mode;
    delete extracted.available_months;
    const result = await importPredefinedQuoteBrochure({ buffer, fileName: 'rates.csv', ai: fakeAi(extracted) });
    const record = result.importRecords[0];
    assert.equal(record.target_quote_id, existing.id);

    const updated = await approvePredefinedQuoteImport(record.id, { payload: record.extracted_payload });
    assert.equal(updated.quote.id, existing.id);
    assert.equal(Number(updated.quote.total_price), 949);
  });
});
