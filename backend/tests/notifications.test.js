import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, pool, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import {
  leadRecipients,
  listNotifications,
  markRead,
  notifyDueReminders,
  notifyNewLead,
  notifyQuoteAccepted,
} from '../services/notifications.js';
import { pauseAi } from '../services/aiHandover.js';
import { handleIncomingLeadMessage } from '../controllers/whatsappLead.js';

const tag = String(Date.now()).slice(-7);
const phone = `97253${tag}`;
const ids = {};

async function staff(role, name) {
  const { rows } = await query(
    `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', $2, 'approved') RETURNING id`,
    [`notif-${name}-${tag}@test.local`, role],
  );
  return rows[0].id;
}

const mine = async (adminId) => (await listNotifications(adminId)).notifications.filter((n) => n.lead_id === ids.lead || n.contact_id === ids.contact);

describe('staff notifications', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    ids.admin = await staff('admin', 'admin');
    ids.agent = await staff('agent', 'agent');
    ids.other = await staff('agent', 'other');
    ids.contact = (await query(`INSERT INTO contacts (phone, name) VALUES ($1, 'Rana') RETURNING id`, [phone])).rows[0].id;
    ids.lead = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source) VALUES ($1, 'Istanbul', CURRENT_DATE + 30, CURRENT_DATE + 34, 4, 'web') RETURNING id`,
      [phone],
    )).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM messages WHERE from_number = $1 OR to_number = $1`, [phone]);
    await query(`DELETE FROM conversations WHERE phone = $1`, [phone]);
    await query(`DELETE FROM ai_handover WHERE phone = $1`, [phone]);
    await query(`DELETE FROM leads WHERE id = $1`, [ids.lead]);
    await query(`DELETE FROM contacts WHERE id = $1`, [ids.contact]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[ids.admin, ids.agent, ids.other]]);
    await pool.end();
  });

  it('sends unassigned leads to admins, assigned leads to the agent', async () => {
    assert.ok((await leadRecipients(ids.lead)).includes(ids.admin));
    assert.ok(!(await leadRecipients(ids.lead)).includes(ids.agent));
    await query(`INSERT INTO user_leads (user_id, lead_id) VALUES ($1, $2)`, [ids.agent, ids.lead]);
    assert.deepEqual(await leadRecipients(ids.lead), [ids.agent]);
    const both = await leadRecipients(ids.lead, { withAdmins: true });
    assert.ok(both.includes(ids.agent) && both.includes(ids.admin) && !both.includes(ids.other));
  });

  it('notifies a new lead with its source', async () => {
    await notifyNewLead(ids.lead);
    const [n] = await mine(ids.admin);
    assert.equal(n.kind, 'new_lead');
    assert.deepEqual([n.data.customer, n.data.destination, n.data.source], ['Rana', 'Istanbul', 'web']);
    assert.equal((await mine(ids.other)).length, 0, 'other agents are not told');
  });

  it('groups repeated customer messages while the AI is paused into one notification', async () => {
    await pauseAi(phone, { reason: 'agent_reply' });
    await handleIncomingLeadMessage({ from: phone, text: 'any news?', skipWhatsApp: true });
    await handleIncomingLeadMessage({ from: phone, text: 'hello??', skipWhatsApp: true });
    const waiting = (await mine(ids.agent)).filter((n) => n.kind === 'customer_waiting');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].count, 2);
    assert.equal(waiting[0].data.preview, 'hello??');
  });

  it('notifies quote acceptance to the agent and admins', async () => {
    await notifyQuoteAccepted(ids.lead, { acceptedBy: 'Rana Ahmed' });
    for (const who of [ids.agent, ids.admin]) {
      assert.ok((await mine(who)).some((n) => n.kind === 'quote_accepted' && n.data.customer === 'Rana Ahmed'));
    }
  });

  it('tells the reminder creator once when the time comes', async () => {
    await query(
      `INSERT INTO contact_reminders (contact_id, text, remind_at, created_by) VALUES ($1, 'Call about passports', NOW() - INTERVAL '1 minute', $2)`,
      [ids.contact, ids.agent],
    );
    await notifyDueReminders();
    await notifyDueReminders();
    const due = (await mine(ids.agent)).filter((n) => n.kind === 'reminder_due');
    assert.equal(due.length, 1);
    assert.equal(due[0].data.text, 'Call about passports');
  });

  it('marks read only the employee\'s own notifications', async () => {
    const agentRows = await mine(ids.agent);
    await markRead(ids.other, { ids: agentRows.map((n) => n.id) });
    assert.ok((await mine(ids.agent)).every((n) => n.read_at === null), 'someone else cannot mark them');
    await markRead(ids.agent, { all: true });
    assert.equal((await listNotifications(ids.agent)).unread, 0);
  });
});
