import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { saveTravellers } from '../services/travellers.js';
import { listVisas, notifyVisaRisks, saveVisaRule, updateVisa } from '../services/visas.js';
import { createGroupTrip, getGroupTrip, roomingListCsv, setLeadGroup, setLeadRoom, updateGroupTrip } from '../services/groupTrips.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
const ids = {};

async function lead(phone, adults, children = 0, travelIn = 10) {
  return (await query(
    `INSERT INTO leads (phone, destination, travel_date, return_date, nights, adults_count, children_count, source, lifecycle_status)
     VALUES ($1, 'Makkah', CURRENT_DATE + $4::int, CURRENT_DATE + $4::int + 10, 10, $2, $3, 'web', 'booked') RETURNING id`,
    [phone, adults, children, travelIn],
  )).rows[0].id;
}

describe('visas and group trips', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    ids.admin = (await query(`INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1,'x','admin','approved') RETURNING id`, [`gv-${tag}@t.local`])).rows[0].id;
    ids.a = await lead(`97261${tag}`, 2, 1);
    ids.b = await lead(`97262${tag}`, 2);
    ids.c = await lead(`97263${tag}`, 3);
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [[ids.a, ids.b, ids.c]]);
    if (ids.group) await query(`DELETE FROM group_trips WHERE id = $1`, [ids.group]);
    await query(`DELETE FROM visa_rules WHERE destination_key = $1`, [`makkah ${tag}`]);
    await query(`DELETE FROM notifications WHERE admin_id = $1`, [ids.admin]);
    await query(`DELETE FROM admins WHERE id = $1`, [ids.admin]);
  });

  it('saving the travellers again keeps each one’s visa progress', async () => {
    const first = await saveTravellers(ids.a, [{ full_name: 'Ahmad Omar' }, { full_name: 'Huda Omar' }, { full_name: 'Yusuf Omar', is_child: true }]);
    const ahmad = first.travellers[0];
    await updateVisa(ids.a, ahmad.id, { visa_status: 'applied', visa_notes: 'Submitted at the embassy' });
    const again = await saveTravellers(ids.a, first.travellers.map((t) => ({ ...t, full_name: t.full_name.toUpperCase() })));
    assert.equal(again.travellers[0].id, ahmad.id);
    const visas = await listVisas(ids.a);
    assert.equal(visas.travellers[0].visa_status, 'applied');
    assert.ok(visas.travellers[0].visa_applied_at, 'applied date set');
    assert.equal(visas.travellers[0].full_name, 'AHMAD OMAR');
    await assert.rejects(updateVisa(ids.a, ahmad.id, { visa_status: 'maybe' }), { status: 400 });
  });

  it('keeps the documents each destination asks for', async () => {
    const rule = await saveVisaRule({ destination: `Makkah ${tag}`, documents: 'Passport, photo, vaccination', processing_days: 7 });
    assert.equal(rule.destination_key, `makkah ${tag}`);
    const updated = await saveVisaRule({ destination: `MAKKAH ${tag}`, documents: 'Passport, photo', processing_days: 5 });
    assert.equal(updated.processing_days, 5);
  });

  it('warns once when the trip is close and a visa is not approved', async () => {
    assert.ok((await notifyVisaRisks()) >= 1);
    await notifyVisaRisks();
    const notes = (await listNotifications(ids.admin)).notifications.filter((n) => n.kind === 'visa_pending' && n.lead_id === ids.a);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].data.traveller, 'AHMAD OMAR');
  });

  it('a group fills its seats and refuses to overbook', async () => {
    const group = await createGroupTrip({ title: `Umrah December ${tag}`, destination: 'Makkah', seats_total: 6, price_per_person: 950, currency: 'usd' }, { actorId: ids.admin });
    ids.group = group.id;
    assert.equal(group.currency, 'USD');
    await setLeadGroup(ids.a, group.id, { room: 'Room 1' });
    await setLeadGroup(ids.b, group.id);
    let g = await getGroupTrip(group.id);
    assert.equal(g.seats_used, 5);
    assert.equal(g.seats_left, 1);
    await assert.rejects(setLeadGroup(ids.c, group.id), { status: 409 });
    await updateGroupTrip(group.id, { seats_total: 10 });
    await setLeadGroup(ids.c, group.id);
    await setLeadRoom(group.id, ids.b, 'Room 2');
    g = await getGroupTrip(group.id);
    assert.equal(g.bookings.length, 3);
    assert.equal(g.travellers.length, 3, 'only bookings with travellers filled in');
    await setLeadGroup(ids.c, null);
    assert.equal((await getGroupTrip(group.id)).seats_used, 5);
  });

  it('exports the rooming list as Excel-safe CSV', async () => {
    await saveTravellers(ids.b, [{ full_name: '=HYPERLINK("x")', passport_number: 'P1' }]);
    const csv = await roomingListCsv(ids.group);
    assert.ok(csv.startsWith('﻿Room,Full name'));
    assert.ok(csv.includes('Room 1,AHMAD OMAR'));
    assert.ok(csv.includes(`Room 2,"'=HYPERLINK(""x"")"`), 'formula is neutralised');
  });
});
