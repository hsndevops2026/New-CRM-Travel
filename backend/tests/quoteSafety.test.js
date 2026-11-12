import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { setDraftItems, upsertDraft } from '../services/quoteDrafts.js';
import {
  acceptQuoteVersion,
  createShareToken,
  getVersionById,
  isPastValidity,
  lockQuoteVersion,
  resolveShareToken,
  versionBlock,
} from '../services/quoteVersions.js';
import { sendQuoteVersion } from '../services/quoteDelivery.js';

const tag = String(Date.now()).slice(-7);
let leadId;

const item = (over = {}) => ({ source_type: 'manual', source_id: `i-${Math.random()}`, label: 'Hotel', net_cost: 500, currency: 'USD', ...over });
const lifecycle = async () => (await query(`SELECT lifecycle_status FROM leads WHERE id = $1`, [leadId])).rows[0].lifecycle_status;

describe('quote safety', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    leadId = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Istanbul', CURRENT_DATE + 30, CURRENT_DATE + 35, 5, 'web', 'sent') RETURNING id`,
      [`97253${tag}`],
    )).rows[0].id;
    await upsertDraft(leadId, { currency: 'USD', markup_type: 'percent', markup_value: 10 });
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  });

  it('will not lock a quote with an item in another currency', async () => {
    const draft = await setDraftItems(leadId, [item(), item({ label: 'Flight', currency: 'EUR', net_cost: 200 })]);
    assert.deepEqual(draft.issues.other_currency.map((i) => i.currency), ['EUR']);
    await assert.rejects(lockQuoteVersion(leadId), (err) => err.status === 400 && err.code === 'quote_items_invalid');
  });

  it('will not lock a quote with an item that has no price', async () => {
    const draft = await setDraftItems(leadId, [item(), item({ label: 'Transfer', net_cost: null })]);
    assert.deepEqual(draft.issues.missing_cost.map((i) => i.label), ['Transfer']);
    await assert.rejects(lockQuoteVersion(leadId), { code: 'quote_items_invalid' });
  });

  it('only the latest version can be sent or accepted', async () => {
    await setDraftItems(leadId, [item()]);
    const { version: v1 } = await lockQuoteVersion(leadId);
    const t1 = await createShareToken(v1.id);
    assert.equal(await versionBlock(v1), null);

    const { version: v2 } = await lockQuoteVersion(leadId);
    assert.equal((await versionBlock(await getVersionById(v1.id))).code, 'superseded');
    assert.equal((await resolveShareToken(t1.token)).superseded, true);
    await assert.rejects(acceptQuoteVersion(t1.token, { customerName: 'Old' }), { status: 409 });
    await assert.rejects(
      sendQuoteVersion({ versionId: v1.id, channel: 'whatsapp', recipient: '+972501234567' }),
      { status: 409, code: 'superseded' },
    );

    const t2 = await createShareToken(v2.id);
    assert.equal((await resolveShareToken(t2.token)).superseded, false);
    const results = await Promise.allSettled([
      acceptQuoteVersion(t2.token, { customerName: 'Sara' }),
      acceptQuoteVersion(t2.token, { customerName: 'Sara' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'a double click accepts once');
    assert.equal((await getVersionById(v2.id)).status, 'accepted');
    assert.equal(await lifecycle(), 'accepted', 'goes through the stage rules to accepted, not straight to booked');
    assert.equal((await versionBlock(await getVersionById(v2.id))).code, 'already_accepted');
  });

  it('a quote past its valid-until date cannot be accepted', async () => {
    await query(`UPDATE leads SET lifecycle_status = 'sent' WHERE id = $1`, [leadId]);
    await upsertDraft(leadId, { currency: 'USD', markup_type: 'percent', markup_value: 10, valid_until: '2020-01-01' });
    await setDraftItems(leadId, [item()]);
    const { version } = await lockQuoteVersion(leadId);
    const token = await createShareToken(version.id);
    assert.equal((await resolveShareToken(token.token)).expired, true);
    await assert.rejects(acceptQuoteVersion(token.token, { customerName: 'Late' }), { status: 410 });
    assert.equal((await versionBlock(version)).code, 'expired');
  });

  it('valid-until counts the whole day', () => {
    const now = new Date('2026-12-01T21:00:00Z');
    assert.equal(isPastValidity({ valid_until: '2026-12-01' }, now), false);
    assert.equal(isPastValidity({ valid_until: '2026-11-30' }, now), true);
    assert.equal(isPastValidity({ valid_until: null }, now), false);
  });
});
