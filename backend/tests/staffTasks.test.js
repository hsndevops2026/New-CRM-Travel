import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'dotenv/config';
import { pingDb, query } from '../config/database.js';
import { runMigrations } from '../db/migrate.js';
import { createTask, deleteTask, listTasks, notifyDueTasks, updateTask } from '../services/staffTasks.js';
import { listNotifications } from '../services/notifications.js';

const tag = String(Date.now()).slice(-7);
const ids = {};
const who = {};

async function staff(role, name) {
  const { rows } = await query(
    `INSERT INTO admins (email, password_hash, role, approval_status) VALUES ($1, 'x', $2, 'approved') RETURNING id, email, role`,
    [`task-${name}-${tag}@test.local`, role],
  );
  return rows[0];
}

const taskNotes = async (adminId, kind) => (await listNotifications(adminId)).notifications
  .filter((n) => n.kind === kind && n.data?.text?.includes(tag));

describe('staff tasks', () => {
  before(async () => {
    await pingDb();
    await runMigrations();
    who.admin = await staff('admin', 'admin');
    who.agent = await staff('agent', 'agent');
    who.other = await staff('agent', 'other');
    ids.lead = (await query(
      `INSERT INTO leads (phone, destination, travel_date, return_date, nights, source) VALUES ($1, 'Antalya', CURRENT_DATE + 20, CURRENT_DATE + 25, 5, 'web') RETURNING id`,
      [`97252${tag}`],
    )).rows[0].id;
  });

  after(async () => {
    await query(`DELETE FROM staff_tasks WHERE title LIKE $1`, [`%${tag}%`]);
    await query(`DELETE FROM notifications WHERE admin_id = ANY($1::uuid[])`, [[who.admin.id, who.agent.id, who.other.id]]);
    await query(`DELETE FROM leads WHERE id = $1`, [ids.lead]);
    await query(`DELETE FROM admins WHERE id = ANY($1::uuid[])`, [[who.admin.id, who.agent.id, who.other.id]]);
  });

  it('a manager gives a task and the employee is notified', async () => {
    const task = await createTask(who.admin, {
      title: `Send hotel voucher ${tag}`, assigned_to: who.agent.id, lead_id: ids.lead,
      due_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    ids.task = task.id;
    assert.equal(task.assigned_to_email, who.agent.email);
    assert.equal(task.lead_destination, 'Antalya');
    const notes = await taskNotes(who.agent.id, 'task_assigned');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].lead_id, ids.lead);
  });

  it('employees only see their own tasks; the manager sees all', async () => {
    assert.ok((await listTasks(who.agent)).some((t) => t.id === ids.task));
    assert.ok(!(await listTasks(who.other)).some((t) => t.id === ids.task));
    assert.ok((await listTasks(who.admin)).some((t) => t.id === ids.task));
    assert.ok((await listTasks(who.admin, { assignee: who.agent.id })).every((t) => t.assigned_to === who.agent.id));
  });

  it('an employee cannot give tasks to others or touch someone else\'s task', async () => {
    await assert.rejects(createTask(who.agent, { title: `x ${tag}`, assigned_to: who.other.id }), { status: 403 });
    await assert.rejects(updateTask(who.other, ids.task, { status: 'done' }), { status: 404 });
    await assert.rejects(updateTask(who.agent, ids.task, { due_at: null }), { status: 403 });
    await assert.rejects(updateTask(who.agent, ids.task, { assigned_to: who.other.id }), { status: 403 });
    await assert.rejects(deleteTask(who.agent, ids.task), { status: 403 });
  });

  it('an employee can add a task for themselves', async () => {
    const own = await createTask(who.agent, { title: `Call supplier ${tag}` });
    assert.equal(own.assigned_to, who.agent.id);
    assert.equal((await taskNotes(who.agent.id, 'task_assigned')).length, 1, 'no notification for own task');
    await deleteTask(who.agent, own.id);
  });

  it('the employee marks it done, and can reopen it', async () => {
    const done = await updateTask(who.agent, ids.task, { status: 'done', notes: 'sent on WhatsApp' });
    assert.equal(done.status, 'done');
    assert.equal(done.done_by_email, who.agent.email);
    assert.ok(done.done_at);
    assert.ok(!(await listTasks(who.agent)).some((t) => t.id === ids.task), 'done tasks leave the open list');
    assert.ok((await listTasks(who.agent, { status: 'done' })).some((t) => t.id === ids.task));
    const reopened = await updateTask(who.agent, ids.task, { status: 'open' });
    assert.equal(reopened.done_at, null);
  });

  it('an overdue open task notifies the assignee once', async () => {
    const late = await createTask(who.admin, {
      title: `Overdue visa check ${tag}`, assigned_to: who.other.id, due_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await notifyDueTasks();
    await notifyDueTasks();
    const due = (await taskNotes(who.other.id, 'task_due')).filter((n) => n.data.task_id === late.id);
    assert.equal(due.length, 1);
  });

  it('reassigning notifies the new person and rejects bad input', async () => {
    const moved = await updateTask(who.admin, ids.task, { assigned_to: who.other.id });
    assert.equal(moved.assigned_to, who.other.id);
    assert.ok((await taskNotes(who.other.id, 'task_assigned')).some((n) => n.data.task_id === ids.task));
    await assert.rejects(createTask(who.admin, { title: '  ' }), { status: 400 });
    await assert.rejects(createTask(who.admin, { title: `t ${tag}`, due_at: 'soon' }), { status: 400 });
    await assert.rejects(updateTask(who.admin, ids.task, { status: 'maybe' }), { status: 400 });
  });

  it('an employee cannot attach a task to a lead they cannot access', async () => {
    await assert.rejects(createTask(who.agent, { title: `peek ${tag}`, lead_id: ids.lead }), { status: 403 });
  });
});
