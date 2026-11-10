import { Router } from 'express';
import {
  createReminder,
  deleteReminder,
  listRemindersForContact,
  listRemindersInRange,
  updateReminder,
} from '../services/reminders.js';

const router = Router();

router.get('/reminders', async (req, res) => {
  try {
    const reminders = await listRemindersInRange({
      from: req.query.from,
      to: req.query.to,
      limit: Number(req.query.limit) || 500,
    });
    res.json({ count: reminders.length, reminders });
  } catch (error) {
    console.error('List reminders failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to list reminders' });
  }
});

router.get('/contacts/:id/reminders', async (req, res) => {
  try {
    const reminders = await listRemindersForContact(req.params.id);
    res.json({ count: reminders.length, reminders });
  } catch (error) {
    console.error('List contact reminders failed:', error);
    res.status(500).json({ error: 'Failed to list reminders' });
  }
});

router.post('/contacts/:id/reminders', async (req, res) => {
  try {
    const reminder = await createReminder(
      req.params.id,
      {
        text: req.body?.text,
        remind_at: req.body?.remind_at,
      },
      req.admin?.id || null,
    );
    res.status(201).json({ reminder });
  } catch (error) {
    console.error('Create reminder failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create reminder' });
  }
});

router.patch('/reminders/:id', async (req, res) => {
  try {
    const reminder = await updateReminder(req.params.id, {
      text: req.body?.text,
      remind_at: req.body?.remind_at,
      done: req.body?.done,
    });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ reminder });
  } catch (error) {
    console.error('Update reminder failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to update reminder' });
  }
});

router.delete('/reminders/:id', async (req, res) => {
  try {
    const reminder = await deleteReminder(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ deleted: true, reminder });
  } catch (error) {
    console.error('Delete reminder failed:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

export default router;
