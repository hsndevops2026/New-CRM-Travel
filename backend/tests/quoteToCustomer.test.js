import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createPredefinedQuote, deletePredefinedQuote } from '../services/predefinedQuotes.js';
import { customerQuoteMessage, normalizeCustomerPhone, sendQuoteToCustomer } from '../services/quoteToCustomer.js';
import { formatPackageOfferMessage } from '../services/packageOffer.js';

describe('normalizeCustomerPhone', () => {
  it('accepts any common way of writing an international number', () => {
    assert.equal(normalizeCustomerPhone('+971 50 123 4567'), '+971501234567');
    assert.equal(normalizeCustomerPhone('971501234567'), '+971501234567');
    assert.equal(normalizeCustomerPhone('(971) 50-123-4567'), '+971501234567');
  });

  it('rejects things that cannot be a phone number, with a 400', () => {
    for (const bad of ['', '   ', 'abc', '12345', '1'.repeat(16), null, undefined]) {
      assert.throws(() => normalizeCustomerPhone(bad), (error) => error.status === 400, String(bad));
    }
  });
});

describe('sendQuoteToCustomer', () => {
  let quote;

  before(async () => {
    await pingDb();
    await runMigrations();
    quote = await createPredefinedQuote({
      title: 'Customer send test package',
      destination: 'Istanbul',
      currency: 'USD',
      total_price: 1940,
      travel_date: '2026-12-12',
      return_date: '2026-12-18',
      items: [{ item_type: 'hotel', title: 'Bosphorus Grand Hotel', hotel_name: 'Bosphorus Grand Hotel', price: 1940, nights: 6 }],
    });
  });

  after(async () => {
    await deletePredefinedQuote(quote.id);
    await query('SELECT 1');
    await pool.end();
  });

  it('sends the package as an offer to the number it was given', async () => {
    const sent = [];
    const result = await sendQuoteToCustomer(
      { quoteId: quote.id, phone: '+971 50 123 4567' },
      { send: async (to, text) => sent.push({ to, text }) },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '+971501234567');
    assert.match(sent[0].text, /Customer send test package/);
    assert.match(sent[0].text, /Bosphorus Grand Hotel/);
    assert.equal(result.to, '+971501234567');
  });

  it('never asks the customer to reply YES or NO — nobody is waiting on that answer', async () => {
    const sent = [];
    await sendQuoteToCustomer({ quoteId: quote.id, phone: '971501234567' }, { send: async (to, text) => sent.push(text) });
    assert.doesNotMatch(sent[0], /Reply YES|search .* as usual/i);
    // …while the offer shown in answer to a request still does.
    assert.match(formatPackageOfferMessage(quote), /Reply YES/);
  });

  it('puts the agent’s note first when there is one, and skips a blank one', () => {
    const withNote = customerQuoteMessage(quote, '  Hi Sarah, as discussed:  ');
    assert.ok(withNote.startsWith('Hi Sarah, as discussed:\n\n'));
    assert.ok(!customerQuoteMessage(quote, '   ').startsWith('\n'));
  });

  it('sends nothing for a bad number or a quote that does not exist', async () => {
    let calls = 0;
    const send = async () => { calls += 1; };
    await assert.rejects(sendQuoteToCustomer({ quoteId: quote.id, phone: '123' }, { send }), (e) => e.status === 400);
    await assert.rejects(
      sendQuoteToCustomer({ quoteId: '00000000-0000-0000-0000-000000000000', phone: '971501234567' }, { send }),
      (e) => e.status === 404,
    );
    assert.equal(calls, 0);
  });

  it('lets a WhatsApp failure reach the caller instead of reporting success', async () => {
    await assert.rejects(
      sendQuoteToCustomer({ quoteId: quote.id, phone: '971501234567' }, { send: async () => { throw new Error('session disconnected'); } }),
      /session disconnected/,
    );
  });
});
