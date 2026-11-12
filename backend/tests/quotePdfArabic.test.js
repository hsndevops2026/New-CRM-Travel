import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildVersionPdfBuffer, itemLines, quotePdfLanguage, snapshotFacts } from '../services/quotationPdf.js';
import { L, dateRangeLabel, nightsLabel, travellersLabel } from '../services/pdfStrings.js';
import { layoutLines, splitRuns } from '../services/pdfText.js';

const snapshot = {
  title: 'عطلة عائلية في إسطنبول',
  version_number: 2,
  currency: 'USD',
  valid_until: '2026-12-05',
  lead: { customer_name: 'سارة أحمد', origin: 'تل أبيب', destination: 'إسطنبول', travel_date: '2026-12-12', return_date: '2026-12-18', nights: 6, adults_count: 2, children_count: 1 },
  items: [{ label: 'فندق بوسفور', meta: { check_in: '2026-12-12', check_out: '2026-12-18', nights: 6, includes: 'فطور' } }],
  pricing: { selling_price: 2298 },
};

describe('Arabic quote PDF', () => {
  it('uses Arabic labels, dates and counts', () => {
    const facts = snapshotFacts(snapshot, 'ar');
    assert.deepEqual(facts.map((f) => f.label), ['المسار', 'التواريخ', 'المدة', 'المسافرون']);
    assert.equal(facts[0].value, 'تل أبيب ← إسطنبول');
    assert.equal(facts[1].value, '12–18 ديسمبر 2026');
    assert.equal(facts[2].value, '6 ليالٍ');
    assert.equal(facts[3].value, 'بالغان، طفل واحد');
    assert.ok(itemLines(snapshot.items[0], 'ar').some((l) => l.text === 'يشمل: فطور'));
  });

  it('keeps English labels for English customers', () => {
    const facts = snapshotFacts({ ...snapshot, lead: { ...snapshot.lead, origin: 'Tel Aviv', destination: 'Istanbul' } }, 'en');
    assert.equal(facts[0].label, 'Route');
    assert.equal(facts[0].value, 'Tel Aviv → Istanbul');
    assert.equal(facts[3].value, '2 adults, 1 child');
  });

  it('counts and dates read naturally in Arabic', () => {
    assert.equal(nightsLabel(1, 'ar'), 'ليلة واحدة');
    assert.equal(nightsLabel(14, 'ar'), '14 ليلة');
    assert.equal(travellersLabel(3, 0, 'ar'), '3 بالغين');
    assert.equal(dateRangeLabel('2026-11-28', '2026-12-03', 'ar'), '28 نوفمبر 2026 - 3 ديسمبر 2026');
    assert.equal(L('ar', 'page_of', { n: 1, count: 2 }), 'صفحة 1 من 2');
  });

  it('keeps numbers in order between Arabic words', () => {
    const runs = splitRuns('12 ديسمبر 2026 - 18 ديسمبر 2026', 'rtl').map((r) => r.words.join(' '));
    assert.deepEqual(runs, ['12', 'ديسمبر', '2026', '-', '18', 'ديسمبر', '2026']);
    assert.deepEqual(splitRuns('السعر USD 2,298', 'rtl').map((r) => r.words.join(' ')), ['السعر', 'USD 2,298']);
    // On the page, right to left: the first date is at the right edge.
    const line = layoutLines('12 ديسمبر - 18 ديسمبر', 1000, (s) => s.length * 5, 'rtl')[0];
    assert.deepEqual(line.runs.map((r) => r.text), ['ديسمبر', '18', '-', 'ديسمبر', '12']);
  });

  it('renders an Arabic PDF', async () => {
    const buffer = await buildVersionPdfBuffer(snapshot, { agency_name: 'Horizon', primary_color: '#0f766e' }, 'ar');
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
    assert.ok(buffer.length > 5000);
  });

  it('picks the language asked for, else the customer default (Arabic)', async () => {
    assert.equal(await quotePdfLanguage(snapshot, 'en'), 'en');
    assert.equal(await quotePdfLanguage(snapshot, 'ar'), 'ar');
    assert.equal(await quotePdfLanguage({ lead: {} }), 'ar');
  });
});
