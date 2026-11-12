import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { quoteNeedsApproval, updateAgencySettings, getAgencySettings } from '../services/agencySettings.js';
import { setDraftItems, upsertDraft } from '../services/quoteDrafts.js';
import {
  reviseQuotePrice,
  acceptQuoteVersion,
  createShareToken,
  listPendingApprovals,
  lockQuoteVersion,
  requestQuoteApproval,
  reviewQuoteVersion,
  versionBlock,
  getVersionById,
} from '../services/quoteVersions.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
let leadId;
let saved;
const who = {};

async function staff(role, name) {
  const { rows } = await query(
    `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', $2, 'approved') RETURNING id, email, role`,
    [`qa-${name}-${tag}@test.local`, role],
  );
  return rows[0];
}

describe('manager approval of quotes', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    saved = await getAgencySettings();
    who.boss = await staff('admin', 'boss');
    who.agent = await staff('agent', 'agent');
    leadId = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Batumi', CURRENT_DATE + 30, CURRENT_DATE + 34, 4, 'web', 'sent') RETURNING id`,
      [`97254${tag}`],
    )).rows[0].id;
    await upsertDraft(leadId, { currency: 'USD', markup_type: 'percent', markup_value: 5 });
    await setDraftItems(leadId, [{ source_type: 'manual', source_id: 'h', label: 'Hotel', net_cost: 1000, currency: 'USD' }]);
  });

  after(async () => {
    await updateAgencySettings({
      quote_approval_mode: saved.quote_approval_mode || 'agents',
      quote_approval_min_margin_type: saved.quote_approval_min_margin_type || 'percent',
      quote_approval_min_margin: saved.quote_approval_min_margin ?? 10,
    });
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM notifications WHERE admin_id = ANY($1::uuid[])`, [[who.boss.id, who.agent.id]]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[who.boss.id, who.agent.id]]);
  });

  it('decides who needs approval', () => {
    assert.equal(quoteNeedsApproval({ quote_approval_mode: 'agents' }, { role: 'admin' }), false);
    assert.equal(quoteNeedsApproval({ quote_approval_mode: 'agents' }, { role: 'agent', marginPct: 40 }), true);
    assert.equal(quoteNeedsApproval({ quote_approval_mode: 'off' }, { role: 'agent' }), false);
    const low = { quote_approval_mode: 'below_margin', quote_approval_min_margin: 10 };
    assert.equal(quoteNeedsApproval(low, { role: 'agent', marginPct: 4.76 }), true);
    assert.equal(quoteNeedsApproval(low, { role: 'agent', marginPct: 15 }), false);
  });

  it("an agent's quote waits for the manager and can't be sent or accepted", async () => {
    await updateAgencySettings({ quote_approval_mode: 'agents' });
    const { version } = await lockQuoteVersion(leadId, { actorId: who.agent.id, actorRole: 'agent' });
    assert.equal(version.approval_status, 'pending');
    assert.equal((await versionBlock(version)).code, 'approval_pending');
    const token = await createShareToken(version.id);
    await assert.rejects(acceptQuoteVersion(token.token, { customerName: 'X' }), { status: 409 });

    await requestQuoteApproval(version, { requestedByEmail: who.agent.email });
    const note = (await listNotifications(who.boss.id)).notifications.find((n) => n.kind === 'quote_approval_needed' && n.data.version_id === version.id);
    assert.ok(note, 'the manager is notified');
    assert.ok((await listPendingApprovals()).some((p) => p.id === version.id));

    await assert.rejects(reviewQuoteVersion(version.id, { decision: 'rejected', note: '', reviewer: who.boss }), { status: 400 });
    const rejected = await reviewQuoteVersion(version.id, { decision: 'rejected', note: 'Margin too low', reviewer: who.boss });
    assert.equal(rejected.review_note, 'Margin too low');
    assert.equal((await versionBlock(rejected)).code, 'approval_rejected');
    const back = (await listNotifications(who.agent.id)).notifications.find((n) => n.kind === 'quote_reviewed' && n.data.version_id === version.id);
    assert.equal(back.data.decision, 'rejected');
    await assert.rejects(reviewQuoteVersion(version.id, { decision: 'approved', reviewer: who.boss }), { status: 409 });
  });

  it('once approved it can be sent and accepted', async () => {
    const { version } = await lockQuoteVersion(leadId, { actorId: who.agent.id, actorRole: 'agent' });
    const approved = await reviewQuoteVersion(version.id, { decision: 'approved', reviewer: who.boss });
    assert.equal(approved.approval_status, 'approved');
    assert.equal(await versionBlock(await getVersionById(version.id)), null);
    const token = await createShareToken(version.id);
    assert.deepEqual(await acceptQuoteVersion(token.token, { customerName: 'Rana' }), { accepted: true, version_id: version.id });
  });

  it('only low-margin quotes wait in below_margin mode; managers never wait', async () => {
    await updateAgencySettings({ quote_approval_mode: 'below_margin', quote_approval_min_margin: 10 });
    await query(`UPDATE leads SET lifecycle_status = 'sent' WHERE id = $1`, [leadId]);
    const low = await lockQuoteVersion(leadId, { actorId: who.agent.id, actorRole: 'agent' });
    assert.equal(low.version.approval_status, 'pending', '5% markup is under 10%');
    await upsertDraft(leadId, { currency: 'USD', markup_type: 'percent', markup_value: 25 });
    const high = await lockQuoteVersion(leadId, { actorId: who.agent.id, actorRole: 'agent' });
    assert.equal(high.version.approval_status, 'not_required');
    const mine = await lockQuoteVersion(leadId, { actorId: who.boss.id, actorRole: 'admin' });
    assert.equal(mine.version.approval_status, 'not_required');
    await assert.rejects(updateAgencySettings({ quote_approval_mode: 'sometimes' }), { status: 400 });
  });

  it('the minimum can be a profit amount instead of a percentage', async () => {
    const fixed = { quote_approval_mode: 'below_margin', quote_approval_min_margin_type: 'fixed', quote_approval_min_margin: 100 };
    assert.equal(quoteNeedsApproval(fixed, { role: 'agent', marginPct: 50, marginAmount: 80 }), true);
    assert.equal(quoteNeedsApproval(fixed, { role: 'agent', marginPct: 5, marginAmount: 150 }), false);
    await updateAgencySettings({ quote_approval_min_margin_type: 'fixed', quote_approval_min_margin: 2500 });
    assert.equal(Number((await getAgencySettings()).quote_approval_min_margin), 2500);
    await assert.rejects(updateAgencySettings({ quote_approval_min_margin_type: 'percent', quote_approval_min_margin: 150 }), { status: 400 });
  });

  it('a new price after negotiation makes a new version with the same items', async () => {
    await updateAgencySettings({ quote_approval_mode: 'below_margin', quote_approval_min_margin_type: 'fixed', quote_approval_min_margin: 100 });
    const { version, snapshot } = await reviseQuotePrice(leadId, { sellingPrice: 1150, notes: 'Customer asked for a discount', actorId: who.agent.id, actorRole: 'agent' });
    assert.equal(Number(version.selling_price), 1150);
    assert.equal(snapshot.items.length, 1);
    assert.equal(version.approval_status, 'not_required', 'profit 150 is above the 100 floor');
    const lower = await reviseQuotePrice(leadId, { sellingPrice: 1050, actorId: who.agent.id, actorRole: 'agent' });
    assert.equal(lower.version.approval_status, 'pending', 'profit 50 is under the floor');
    assert.equal((await versionBlock(await getVersionById(version.id))).code, 'superseded');
    await assert.rejects(reviseQuotePrice(leadId, { sellingPrice: 900, actorRole: 'agent' }), { code: 'below_cost' });
    await assert.rejects(reviseQuotePrice(leadId, { sellingPrice: 'cheap', actorRole: 'agent' }), { status: 400 });
  });
});
