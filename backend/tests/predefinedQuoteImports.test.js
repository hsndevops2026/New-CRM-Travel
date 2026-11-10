import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  approvePredefinedQuoteImport,
  rejectPredefinedQuoteImport,
} from '../services/predefinedQuoteImports.js';

const payload = {
  title: 'AI Imported Dubai Package',
  origin: 'Delhi',
  destination: 'Dubai',
  currency: 'AED',
  total_price: 5000,
  travel_date: '2027-01-10',
  return_date: '2027-01-14',
  adults_count: 2,
  children_count: 0,
  description: 'Reviewed package',
  notes: 'Subject to availability',
  items: [{
    item_type: 'hotel',
    hotel_name: 'Test Palm Hotel',
    title: 'Test Palm Hotel',
    check_in: '2027-01-10',
    check_out: '2027-01-14',
    price: 5000,
    currency: 'AED',
  }],
};

describe('predefined quote PDF import approval', () => {
  const importIds = [];
  const quoteIds = [];

  before(async () => {
    await pingDb();
    await runMigrations();
  });

  after(async () => {
    if (importIds.length) {
      await query(`DELETE FROM predefined_quote_imports WHERE id = ANY($1::uuid[])`, [importIds]);
    }
    if (quoteIds.length) {
      await query(`DELETE FROM predefined_quotes WHERE id = ANY($1::uuid[])`, [quoteIds]);
    }
    await pool.end();
  });

  async function createReviewImport(importPayload = payload) {
    const result = await query(
      `INSERT INTO predefined_quote_imports
         (file_name, file_hash, file_size, status, extracted_payload)
       VALUES ($1, $2, 1024, 'needs_review', $3)
       RETURNING *`,
      ['brochure.pdf', crypto.randomBytes(32).toString('hex'), JSON.stringify(importPayload)],
    );
    importIds.push(result.rows[0].id);
    return result.rows[0];
  }

  it('creates no package until an employee approves the extracted draft', async () => {
    const importRecord = await createReviewImport();
    const before = await query(`SELECT id FROM predefined_quotes WHERE title = $1`, [payload.title]);
    assert.equal(before.rowCount, 0);

    const approved = await approvePredefinedQuoteImport(importRecord.id, { payload });
    quoteIds.push(approved.quote.id);
    assert.equal(approved.importRecord.status, 'approved');
    assert.equal(approved.importRecord.approved_quote_id, approved.quote.id);
    assert.equal(approved.quote.title, payload.title);
    assert.equal(approved.quote.items[0].hotel_name, 'Test Palm Hotel');
  });

  it('can reject a pending AI draft without creating a package', async () => {
    const rejectedPayload = { ...payload, title: 'Rejected AI Package' };
    const importRecord = await createReviewImport(rejectedPayload);
    const rejected = await rejectPredefinedQuoteImport(importRecord.id, null);
    assert.equal(rejected.status, 'rejected');

    const quotes = await query(`SELECT id FROM predefined_quotes WHERE title = $1`, [rejectedPayload.title]);
    assert.equal(quotes.rowCount, 0);
  });

  it('allows only one approval when two employees submit the same draft', async () => {
    const concurrentPayload = { ...payload, title: `Concurrent AI Package ${Date.now()}` };
    const importRecord = await createReviewImport(concurrentPayload);
    const attempts = await Promise.allSettled([
      approvePredefinedQuoteImport(importRecord.id, { payload: concurrentPayload }),
      approvePredefinedQuoteImport(importRecord.id, { payload: concurrentPayload }),
    ]);

    const approved = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    assert.equal(approved.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 409);
    quoteIds.push(approved[0].value.quote.id);

    const quotes = await query(`SELECT id FROM predefined_quotes WHERE title = $1`, [concurrentPayload.title]);
    assert.equal(quotes.rowCount, 1);
  });
});
