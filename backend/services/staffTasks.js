import { query } from '../config/database.js';
import { notify, safeNotify } from './notifications.js';
import { hasLeadAccess } from './permissions.js';

/**
 * Staff tasks. An admin gives a task to anyone on the team; an agent can add tasks for
 * themselves. The assignee marks it done. Admins see everyone's tasks, agents only their own.
 */

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const SELECT = `
  SELECT t.*, a.email AS assigned_to_email, c.email AS created_by_email, d.email AS done_by_email,
         COALESCE(ct.name, ct2.name) AS customer_name, l.destination AS lead_destination
  FROM staff_tasks t
  JOIN admins a ON a.id = t.assigned_to
  LEFT JOIN admins c ON c.id = t.created_by
  LEFT JOIN admins d ON d.id = t.done_by
  LEFT JOIN leads l ON l.id = t.lead_id
  LEFT JOIN contacts ct ON ct.id = t.contact_id
  LEFT JOIN contacts ct2 ON t.contact_id IS NULL AND ct2.phone = l.phone`;

function cleanTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw httpErr(400, 'title is required');
  return title.slice(0, 300);
}

function cleanNotes(value) {
  const notes = String(value ?? '').trim();
  return notes ? notes.slice(0, 4000) : null;
}

function cleanDue(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpErr(400, 'due_at must be a date');
  return date.toISOString();
}

async function approvedStaff(id) {
  const { rows } = await query(
    `SELECT id FROM admins WHERE id = $1 AND COALESCE(approval_status, 'approved') = 'approved'`,
    [id],
  );
  return rows[0] || null;
}

/** People a task can be given to. */
export async function listAssignees() {
  const { rows } = await query(
    `SELECT id, email, role FROM admins
     WHERE COALESCE(approval_status, 'approved') = 'approved' AND role IN ('admin', 'agent')
     ORDER BY email`,
  );
  return rows;
}

export async function getTask(id) {
  const { rows } = await query(`${SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}

/**
 * @param {{ id: string, role: string }} viewer
 * @param {{ status?: 'open'|'done'|'all', assignee?: string, leadId?: string }} filters
 */
export async function listTasks(viewer, { status = 'open', assignee, leadId } = {}) {
  const where = [];
  const params = [];
  if (viewer.role !== 'admin') {
    params.push(viewer.id);
    where.push(`t.assigned_to = $${params.length}`);
  } else if (assignee) {
    params.push(assignee);
    where.push(`t.assigned_to = $${params.length}`);
  }
  if (status === 'open' || status === 'done') {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (leadId) {
    params.push(leadId);
    where.push(`t.lead_id = $${params.length}`);
  }
  const order = status === 'done'
    ? 't.done_at DESC NULLS LAST'
    : "t.status = 'done', t.due_at ASC NULLS LAST, t.created_at DESC";
  const { rows } = await query(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 500`,
    params,
  );
  return rows;
}

export async function createTask(viewer, input = {}) {
  const assignedTo = input.assigned_to || viewer.id;
  if (viewer.role !== 'admin' && assignedTo !== viewer.id) {
    throw httpErr(403, 'Only a manager can give tasks to other staff');
  }
  if (!(await approvedStaff(assignedTo))) throw httpErr(400, 'Unknown staff member');
  if (input.lead_id && viewer.role !== 'admin' && !(await hasLeadAccess(viewer.id, input.lead_id))) {
    throw httpErr(403, 'You do not have access to this lead');
  }
  const { rows } = await query(
    `INSERT INTO staff_tasks (title, notes, assigned_to, created_by, lead_id, contact_id, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      cleanTitle(input.title),
      cleanNotes(input.notes),
      assignedTo,
      viewer.id,
      input.lead_id || null,
      input.contact_id || null,
      cleanDue(input.due_at),
    ],
  );
  const task = await getTask(rows[0].id);
  if (assignedTo !== viewer.id) {
    await safeNotify(() => notify({
      adminIds: [assignedTo],
      kind: 'task_assigned',
      leadId: task.lead_id,
      contactId: task.contact_id,
      collapse: false,
      data: { task_id: task.id, text: task.title, by: task.created_by_email, due_at: task.due_at },
    }));
  }
  return task;
}

/**
 * Admins can change anything. The assignee can mark it done/open and edit their own
 * notes, but not reassign it or change the title or deadline set by the manager.
 */
export async function updateTask(viewer, id, input = {}) {
  const task = await getTask(id);
  const isAdmin = viewer.role === 'admin';
  if (!task || (!isAdmin && task.assigned_to !== viewer.id)) throw httpErr(404, 'Task not found');
  const selfMade = task.created_by === viewer.id;

  const sets = [];
  const params = [];
  const set = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };

  if (input.status !== undefined) {
    if (!['open', 'done'].includes(input.status)) throw httpErr(400, 'status must be open or done');
    set('status', input.status);
    if (input.status === 'done') {
      sets.push('done_at = NOW()');
      set('done_by', viewer.id);
    } else {
      sets.push('done_at = NULL', 'done_by = NULL');
    }
  }
  if (input.notes !== undefined) set('notes', cleanNotes(input.notes));
  const canEditDetails = isAdmin || selfMade;
  if (input.title !== undefined || input.due_at !== undefined) {
    if (!canEditDetails) throw httpErr(403, 'Only a manager can change this task');
    if (input.title !== undefined) set('title', cleanTitle(input.title));
    if (input.due_at !== undefined) {
      set('due_at', cleanDue(input.due_at));
      sets.push('due_notified_at = NULL');
    }
  }
  let reassignedTo = null;
  if (input.assigned_to !== undefined && input.assigned_to !== task.assigned_to) {
    if (!isAdmin) throw httpErr(403, 'Only a manager can reassign a task');
    if (!(await approvedStaff(input.assigned_to))) throw httpErr(400, 'Unknown staff member');
    set('assigned_to', input.assigned_to);
    sets.push('due_notified_at = NULL');
    reassignedTo = input.assigned_to;
  }
  if (!sets.length) return task;
  params.push(id);
  await query(`UPDATE staff_tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
  const updated = await getTask(id);
  if (reassignedTo && reassignedTo !== viewer.id) {
    await safeNotify(() => notify({
      adminIds: [reassignedTo],
      kind: 'task_assigned',
      leadId: updated.lead_id,
      contactId: updated.contact_id,
      collapse: false,
      data: { task_id: updated.id, text: updated.title, by: viewer.email || updated.created_by_email, due_at: updated.due_at },
    }));
  }
  return updated;
}

export async function deleteTask(viewer, id) {
  const task = await getTask(id);
  if (!task) throw httpErr(404, 'Task not found');
  if (viewer.role !== 'admin' && !(task.assigned_to === viewer.id && task.created_by === viewer.id)) {
    throw httpErr(403, 'Only a manager can delete this task');
  }
  await query(`DELETE FROM staff_tasks WHERE id = $1`, [id]);
  return task;
}

/** Called from the minute sweep: tell the assignee once when an open task's deadline passes. */
export async function notifyDueTasks() {
  const { rows } = await query(
    `UPDATE staff_tasks SET due_notified_at = NOW()
     WHERE id IN (
       SELECT id FROM staff_tasks
       WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= NOW() AND due_notified_at IS NULL
       ORDER BY due_at LIMIT 200 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, title, assigned_to, lead_id, contact_id, due_at`,
  );
  for (const task of rows) {
    await safeNotify(() => notify({
      adminIds: [task.assigned_to],
      kind: 'task_due',
      leadId: task.lead_id,
      contactId: task.contact_id,
      collapse: false,
      data: { task_id: task.id, text: task.title, due_at: task.due_at },
    }));
  }
  return rows.length;
}
