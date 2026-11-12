import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  createTravellerLink,
  currentTripForPhone,
  flagTravellerMessage,
  getTravellerForm,
  listTravellers,
  passportIssues,
  saveTravellers,
  sendTravellerLink,
  submitTravellerForm,
} from '../services/travellers.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
const phone = `97257${tag}`;
let leadId;
let adminId;

describe('travellers', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    adminId = (await query(
      `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', 'admin', 'approved') RETURNING id`,
      [`trav-${tag}@test.local`],
    )).rows[0].id;
    leadId = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, adults_count, children_count, source, lifecycle_status)
       VALUES ($1, 'Tbilisi', '2027-03-10', '2027-03-15', 5, 2, 1, 'web', 'booked') RETURNING id`,
      [phone],
    )).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    await query(`DELETE FROM messages WHERE to_number = $1`, [phone]);
    await query(`DELETE FROM notifications WHERE admin_id = $1`, [adminId]);
    await query(`DELETE FROM admins WHERE id = $1`, [adminId]);
  });

  it('checks passports against the trip dates and the six-month rule', () => {
    const trip = { travelDate: '2027-03-10', returnDate: '2027-03-15' };
    const ok = { passport_number: 'A1', passport_expiry: '2028-01-01', date_of_birth: '1990-01-01' };
    assert.deepEqual(passportIssues(ok, trip), []);
    assert.deepEqual(passportIssues({ ...ok, passport_expiry: '2027-02-01' }, trip), ['expired']);
    assert.deepEqual(passportIssues({ ...ok, passport_expiry: '2027-03-12' }, trip), ['expires_during_trip']);
    assert.deepEqual(passportIssues({ ...ok, passport_expiry: '2027-08-01' }, trip), ['under_six_months']);
    assert.deepEqual(passportIssues({ full_name: 'X' }, trip), ['missing_passport', 'missing_birth_date']);
  });

  it('staff save the list and see the problems', async () => {
    const result = await saveTravellers(leadId, [
      { full_name: '  Omar   Haddad ', passport_number: 'p123', passport_expiry: '2027-05-01', date_of_birth: '1985-04-02' },
      { full_name: 'Lina Haddad', passport_number: 'P456', passport_expiry: '2030-01-01', date_of_birth: '1988-07-09' },
    ]);
    assert.equal(result.travellers[0].full_name, 'Omar Haddad');
    assert.equal(result.travellers[0].passport_number, 'P123');
    assert.deepEqual(result.travellers[0].issues, ['under_six_months']);
    assert.deepEqual(result.travellers[1].issues, []);
    assert.deepEqual(result.expected, { adults: 2, children: 1 });
    await assert.rejects(saveTravellers(leadId, [{ full_name: '' }]), { status: 400 });
    await assert.rejects(saveTravellers(leadId, [{ full_name: 'A', passport_expiry: '31/12/2030' }]), { status: 400 });
    assert.equal((await listTravellers(leadId)).travellers.length, 2, 'a bad save changes nothing');
  });

  it('the customer fills the form through the link, and staff are told about problems', async () => {
    const { token, url } = await createTravellerLink(leadId, { actorId: adminId });
    assert.ok(url.endsWith(`/travellers/${token}`));
    const form = await getTravellerForm(token);
    assert.equal(form.destination, 'Tbilisi');
    assert.equal(form.travellers.length, 2);
    assert.equal(form.travellers[0].issues, undefined, 'no internal fields on the public form');
    const result = await submitTravellerForm(token, [
      ...form.travellers,
      { full_name: 'Sami Haddad', is_child: true, passport_number: 'C1', passport_expiry: '2027-01-01', date_of_birth: '2018-02-02' },
    ]);
    assert.deepEqual(result, { saved: 3, problems: 2 });
    const note = (await listNotifications(adminId)).notifications.find((n) => n.kind === 'travellers_submitted' && n.lead_id === leadId);
    assert.equal(note.data.problems, 2);
    await assert.rejects(getTravellerForm('not-a-real-token-at-all-xx'), { status: 404 });
  });

  it('sends the link on WhatsApp in the customer language', async () => {
    const outbox = [];
    const { url } = await sendTravellerLink(leadId, { actorId: adminId, send: async (to, text) => outbox.push({ to, text }) });
    assert.equal(outbox[0].to, phone);
    assert.ok(outbox[0].text.includes(url));
    assert.match(outbox[0].text, /جواز السفر/);
  });

  it('a message from a customer who is travelling today alerts the lead owner', async () => {
    assert.equal((await currentTripForPhone(phone, '2027-03-12'))?.id, leadId);
    assert.equal(await currentTripForPhone(phone, '2027-04-01'), null);
    await query(`UPDATE leads SET travel_date = CURRENT_DATE - 1, return_date = CURRENT_DATE + 2 WHERE id = $1`, [leadId]);
    assert.equal(await flagTravellerMessage(phone, 'Lost my bag at the airport'), true);
    const note = (await listNotifications(adminId)).notifications.find((n) => n.kind === 'traveller_message' && n.lead_id === leadId);
    assert.equal(note.data.preview, 'Lost my bag at the airport');
  });
});
