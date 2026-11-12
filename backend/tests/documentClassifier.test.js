import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocumentTitle,
  canClassify,
  classifyUploadedDocument,
  isFetchableUpload,
  normalizeClassification,
} from '../services/documentClassifier.js';

const URL_OK = 'https://res.cloudinary.com/demo/raw/upload/v1/booking/ticket.pdf';

function fakeAi(output, calls = []) {
  return {
    responses: {
      create: async (args) => {
        calls.push(args);
        return { status: 'completed', output_text: JSON.stringify(output) };
      },
    },
  };
}
const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4').buffer });

test('names a flight ticket after airline, flight number, route and date', () => {
  const title = buildDocumentTitle({
    document_type: 'flight_ticket', provider: 'Turkish Airlines', reference: 'TK 789',
    destination: 'IST-TLV', start_date: '2026-12-01', end_date: null,
  });
  assert.equal(title, 'تذكرة طيران - Turkish Airlines TK 789 - IST-TLV - 2026-12-01');
});

test('names a hotel voucher with the stay dates and a program with its destination', () => {
  assert.equal(
    buildDocumentTitle({ document_type: 'hotel_voucher', provider: 'Hilton Istanbul', start_date: '2026-12-01', end_date: '2026-12-06' }),
    'حجز فندق - Hilton Istanbul - 2026-12-01 → 2026-12-06',
  );
  assert.equal(buildDocumentTitle({ document_type: 'trip_program', destination: 'تركيا' }), 'برنامج الرحلة - تركيا');
});

test('an unknown document keeps the name the agent gave it', () => {
  assert.equal(buildDocumentTitle({ document_type: 'other' }, 'scan 001'), 'scan 001');
  assert.equal(buildDocumentTitle({ document_type: 'weird' }, ''), 'مستند');
});

test('cleans model output: bad dates dropped, path characters removed', () => {
  const c = normalizeClassification({ document_type: 'visa', traveler_name: 'Ali/..\\Omar', start_date: '1 Dec', end_date: '2026-12-31' });
  assert.equal(c.traveler_name, 'Ali .. Omar');
  assert.equal(c.start_date, null);
  assert.equal(c.end_date, '2026-12-31');
});

test('only our Cloudinary uploads are fetched', () => {
  assert.equal(isFetchableUpload(URL_OK), true);
  assert.equal(isFetchableUpload('https://evil.example.com/a.pdf'), false);
  assert.equal(isFetchableUpload('http://res.cloudinary.com/demo/a.pdf'), false);
  assert.equal(isFetchableUpload('http://169.254.169.254/'), false);
});

test('PDFs and images are read; other types are not', () => {
  assert.equal(canClassify('application/pdf'), true);
  assert.equal(canClassify('image/jpeg'), true);
  assert.equal(canClassify('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
});

test('classifies a PDF through the model', async () => {
  const calls = [];
  const info = await classifyUploadedDocument({
    fileUrl: URL_OK, mimeType: 'application/pdf', fileName: 'ticket.pdf',
    ai: fakeAi({ document_type: 'flight_ticket', traveler_name: 'Sara', destination: 'TLV-IST', provider: 'Pegasus', reference: 'PC 781', start_date: '2026-12-01', end_date: null }, calls),
    fetchImpl: fakeFetch,
  });
  assert.equal(info.document_type, 'flight_ticket');
  assert.equal(calls[0].input[0].content[0].type, 'input_file');
});

test('returns null (keep original name) when the model fails or the URL is foreign', async () => {
  const broken = { responses: { create: async () => { throw new Error('down'); } } };
  assert.equal(await classifyUploadedDocument({ fileUrl: URL_OK, mimeType: 'application/pdf', ai: broken, fetchImpl: fakeFetch }), null);
  assert.equal(await classifyUploadedDocument({ fileUrl: 'https://x.com/a.pdf', mimeType: 'application/pdf', ai: fakeAi({}), fetchImpl: fakeFetch }), null);
  assert.equal(await classifyUploadedDocument({ fileUrl: URL_OK, mimeType: 'application/pdf', ai: null }), null);
});
