import assert from 'node:assert/strict';
import { it } from 'node:test';
import { publicQuoteSnapshot } from '../services/publicQuote.js';

it('keeps customer details and strips internal quote costs and source identifiers', () => {
  const snapshot = publicQuoteSnapshot({
    title: 'Mumbai trip', currency: 'INR', markup_type: 'percent', markup_value: 20,
    lead: { id: 'internal-lead', destination: 'Mumbai', customer_name: 'Asha' },
    items: [{ label: 'Hotel', net_cost: 1000, source_type: 'hotelbeds', source_id: 'secret',
      meta: { room_type: 'Deluxe', supplier_rate: 1000, cancellation_policy: 'Free cancellation' } }],
    pricing: { net_total: 1000, markup_amount: 200, selling_price: 1200 },
  });

  assert.equal(snapshot.pricing.selling_price, 1200);
  assert.equal(snapshot.items[0].meta.room_type, 'Deluxe');
  assert.equal(snapshot.lead.destination, 'Mumbai');
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['net_cost', 'net_total', 'markup', 'source_type', 'source_id', 'supplier_rate', 'internal-lead', 'secret']) {
    assert.equal(serialized.includes(secret), false, `Leaked ${secret}`);
  }
});
