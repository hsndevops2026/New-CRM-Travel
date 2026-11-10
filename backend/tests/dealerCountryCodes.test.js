import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  createDealerCountryCode,
  deleteDealerCountryCode,
  listDealerCountryCodes,
  updateDealerCountryCode,
} from '../services/dealerCountryCodes.js';
import { upsertDealer } from '../services/dealers.js';

describe('dealer country codes', () => {
  let countryCodeId;
  let dealerId;

  before(async () => {
    await pingDb();
    await runMigrations();
    await query(`DELETE FROM dealers WHERE phone LIKE '888%'`);
    await query(`DELETE FROM dealer_country_codes WHERE dial_code = '888'`);
  });

  after(async () => {
    if (dealerId) await query(`DELETE FROM dealers WHERE id = $1`, [dealerId]);
    if (countryCodeId) await query(`DELETE FROM dealer_country_codes WHERE id = $1`, [countryCodeId]);
    await pool.end();
  });

  it('creates, lists, and updates a country code', async () => {
    const created = await createDealerCountryCode({
      name: 'Test Country',
      iso_code: 'tc',
      dial_code: '+888',
    });
    countryCodeId = created.id;
    assert.equal(created.dial_code, '888');
    assert.equal(created.iso_code, 'TC');

    const listed = await listDealerCountryCodes();
    assert.ok(listed.some((item) => item.id === countryCodeId));

    const updated = await updateDealerCountryCode(countryCodeId, {
      name: 'Updated Test Country',
      iso_code: 'UT',
      dial_code: '888',
    });
    assert.equal(updated.name, 'Updated Test Country');
  });

  it('does not delete a calling code used by a dealer', async () => {
    const dealer = await upsertDealer({
      name: 'Country code test dealer',
      phone: '88812345678',
    });
    dealerId = dealer.id;

    await assert.rejects(
      () => deleteDealerCountryCode(countryCodeId),
      (error) => error.status === 409 && /used by a dealer/i.test(error.message),
    );

    await query(`DELETE FROM dealers WHERE id = $1`, [dealerId]);
    dealerId = null;
    const deleted = await deleteDealerCountryCode(countryCodeId);
    assert.equal(deleted.id, countryCodeId);
    countryCodeId = null;
  });
});
