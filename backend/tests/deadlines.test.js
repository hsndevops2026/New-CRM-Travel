import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  addDeadline,
  deadlinesFromSnapshot,
  freeCancellationEnd,
  listDeadlines,
  notifyDeadlines,
  operationsBoard,
  updateDeadline,
} from '../services/deadlines.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
let leadId;
let adminId;
let agentId;

describe('booking deadlines and the weekly board', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    adminId = (await query(`INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1,'x','admin','approved') RETURNING id`, [`dl-a-${tag}@t.local`])).rows[0].id;
    agentId = (await query(`INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1,'x','agent','approved') RETURNING id`, [`dl-g-${tag}@t.local`])).rows[0].id;
    leadId = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source, lifecycle_status)
       VALUES ($1, 'Vienna', CURRENT_DATE + 3, CURRENT_DATE + 8, 5, 'web', 'booked') RETURNING id`,
      [`97260${tag}`],
    )).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM notifications WHERE admin_id = ANY($1::uuid[])`, [[adminId, agentId]]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[adminId, agentId]]);
  });

  it('reads the free-cancellation date from hotel terms', () => {
    assert.equal(freeCancellationEnd('Cancel from 2026-12-05 (fee 120)'), '2026-12-05T00:00:00Z');
    assert.equal(freeCancellationEnd('Non-refundable'), null);
    assert.equal(freeCancellationEnd('Free cancellation'), null);
  });

  it('adds deadlines from an accepted quote once', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const snapshot = { items: [
      { source_id: 'h1', label: 'Hotel Sacher', meta: { cancellation_policy: `Cancel from ${future} (fee 90)` } },
      { source_id: 'h2', label: 'Hostel', meta: { cancellation_policy: 'Non-refundable' } },
    ] };
    assert.equal(await deadlinesFromSnapshot(leadId, snapshot), 1);
    assert.equal(await deadlinesFromSnapshot(leadId, snapshot), 0);
    const list = await listDeadlines(leadId);
    assert.equal(list[0].kind, 'free_cancellation');
    assert.match(list[0].label, /Hotel Sacher/);
  });

  it('warns 48 hours before and once after it passes', async () => {
    const soon = await addDeadline(leadId, { kind: 'option_expiry', label: `Flight option ${tag}`, due_at: new Date(Date.now() + 5 * 3600_000).toISOString() }, { actorId: adminId });
    await notifyDeadlines();
    await notifyDeadlines();
    let notes = (await listNotifications(adminId)).notifications.filter((n) => n.data?.deadline_id === soon.id);
    assert.deepEqual(notes.map((n) => n.kind), ['deadline_soon']);
    await query(`UPDATE booking_deadlines SET due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [soon.id]);
    await notifyDeadlines();
    notes = (await listNotifications(adminId)).notifications.filter((n) => n.data?.deadline_id === soon.id);
    assert.deepEqual(notes.map((n) => n.kind).sort(), ['deadline_passed', 'deadline_soon']);
    const done = await updateDeadline(leadId, soon.id, { status: 'done' });
    assert.ok(done.done_at);
    await assert.rejects(addDeadline(leadId, { label: 'x', due_at: 'tomorrow' }), { status: 400 });
  });

  it('the board shows departures and open deadlines; agents only their own leads', async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    await addDeadline(leadId, { kind: 'supplier_payment', label: 'Pay the hotel', due_at: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    const board = await operationsBoard({ from, to, viewer: { id: adminId, role: 'admin' } });
    assert.ok(board.trips.some((t) => t.id === leadId));
    assert.ok(board.deadlines.some((d) => d.lead_id === leadId));
    const mine = await operationsBoard({ from, to, viewer: { id: agentId, role: 'agent' } });
    assert.ok(!mine.trips.some((t) => t.id === leadId));
    await query(`INSERT INTO user_leads (user_id, lead_id) VALUES ($1, $2)`, [agentId, leadId]);
    assert.ok((await operationsBoard({ from, to, viewer: { id: agentId, role: 'agent' } })).trips.some((t) => t.id === leadId));
    await assert.rejects(operationsBoard({ from: 'x', to, viewer: { role: 'admin' } }), { status: 400 });
  });
});
