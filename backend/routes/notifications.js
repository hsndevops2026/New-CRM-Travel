import { Router } from 'express';
import { listNotifications, markRead } from '../services/notifications.js';

const router = Router();

router.get('/notifications', async (req, res) => {
  try {
    res.json(await listNotifications(req.admin.id, { limit: req.query.limit }));
  } catch (error) {
    console.error('[notifications]', error.message);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/notifications/read', async (req, res) => {
  try {
    await markRead(req.admin.id, { ids: req.body?.ids, all: req.body?.all === true });
    res.json(await listNotifications(req.admin.id));
  } catch (error) {
    console.error('[notifications]', error.message);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

export default router;
