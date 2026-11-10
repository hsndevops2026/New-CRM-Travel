import { query } from '../config/database.js';
import { listThreads } from './inbox.js';

/** Stages where a lead no longer needs the team's attention. */
const CLOSED_STAGES = ['lost', 'archived', 'booked'];

/**
 * The three numbers the sidebar shows next to Inbox, Leads and Permissions.
 *
 *   leads_open        leads still being worked (not lost, archived or booked)
 *   inbox_awaiting    customer conversations whose last message is the customer's — i.e. waiting for us
 *   approvals_pending staff sign-ups waiting for an admin (admins only; null for everyone else)
 *
 * An agent only counts what they can see: their own leads and conversations.
 *
 * @param {{ id: string, role: string }} admin
 * @param {{ listThreadsFn?: Function }} [options]
 */
export async function getNavCounts(admin, { listThreadsFn = listThreads } = {}) {
  const isAgent = admin?.role === 'agent';

  const leads = isAgent
    ? await query(
        `SELECT count(*)::int AS n
         FROM leads
         JOIN user_leads ON user_leads.lead_id = leads.id
         WHERE user_leads.user_id = $1
           AND COALESCE(leads.lifecycle_status, 'intake') <> ALL($2::text[])`,
        [admin.id, CLOSED_STAGES],
      )
    : await query(
        `SELECT count(*)::int AS n
         FROM leads
         WHERE COALESCE(lifecycle_status, 'intake') <> ALL($1::text[])`,
        [CLOSED_STAGES],
      );

  const { threads } = await listThreadsFn({
    kind: 'customer',
    limit: 200,
    userId: isAgent ? admin.id : null,
  });

  let approvals = null;
  if (admin?.role === 'admin') {
    const pending = await query(
      `SELECT count(*)::int AS n FROM admins WHERE approval_status = 'pending'`,
    );
    approvals = pending.rows[0].n;
  }

  // Undone reminders due today or earlier (overdue), so the sidebar badge stays actionable.
  const reminders = await query(
    `SELECT count(*)::int AS n
     FROM contact_reminders
     WHERE done_at IS NULL
       AND remind_at < (date_trunc('day', NOW()) + INTERVAL '1 day')`,
  );

  return {
    leads_open: leads.rows[0].n,
    inbox_awaiting: threads.filter((thread) => thread.last_direction === 'inbound').length,
    approvals_pending: approvals,
    reminders_open: reminders.rows[0].n,
  };
}
