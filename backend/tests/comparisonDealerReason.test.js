import './support/isolatedRedis.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createLead } from '../services/leads.js';
import { getComparisonItems } from '../services/comparisonNormalizer.js';

const tag = crypto.randomBytes(3).toString('hex');

describe('comparison items from approved dealer replies', () => {
  let lead;
  let dealerId;

  before(async () => {
    await pingDb();
    await runMigrations();
    lead = await createLead({
      phone: `99977${tag}1`,
      collected: {
        booking_type: 'hotel', destination: 'Test City', travel_date: '2027-05-01',
        return_date: '2027-05-04', adults_count: 2, children_count: 0, children_ages: [],
      },
      summary: 'comparison reason test', status: 'new', source: 'crm', skipQuoteFetch: true,
    });
    const dealer = await query(
      `INSERT INTO dealers (name, phone) VALUES ($1, $2) RETURNING id`,
      [`Reason Dealer ${tag}`, `+99977${tag}2`],
    );
    dealerId = dealer.rows[0].id;
    const request = await query(
      `INSERT INTO dealer_requests (lead_id, dealer_id, request_code, status, message_body)
       VALUES ($1, $2, $3, 'replied', 'rates please') RETURNING id`,
      [lead.id, dealerId, `REQ-T${tag}`],
    );
    const reply = (extracted, over) =>
      query(
        `INSERT INTO dealer_responses
           (dealer_request_id, raw_text, extracted, review_status, is_recommended, ai_rank_reason)
         VALUES ($1, 'offer', $2, 'approved', $3, $4)`,
        [request.rows[0].id, JSON.stringify(extracted), over.recommended, over.reason],
      );
    await reply({ hotel_name: 'Recommended Hotel', total_price: 900, currency: 'USD' }, { recommended: true, reason: 'Cheapest complete option.' });
    await reply({ hotel_name: 'Plain Hotel', total_price: 1200, currency: 'USD' }, { recommended: false, reason: null });
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [lead.id]);
    await query(`DELETE FROM dealers WHERE id = $1`, [dealerId]);
    await pool.end();
  });

  it('carries the AI’s reason on a recommended offer so the agent can see why', async () => {
    const { items } = await getComparisonItems(lead.id);
    const dealerItems = items.filter((i) => i.source_type === 'dealer');
    const picked = dealerItems.find((i) => i.label.includes('Recommended Hotel'));
    assert.equal(picked.meta.is_recommended, true);
    assert.equal(picked.meta.ai_rank_reason, 'Cheapest complete option.');
  });

  it('has no reason on an offer the AI did not rank', async () => {
    const { items } = await getComparisonItems(lead.id);
    const plain = items.find((i) => i.label.includes('Plain Hotel'));
    assert.equal(plain.meta.ai_rank_reason, null);
  });
});
