import { Router } from 'express';
import { getNavCounts } from '../services/navCounts.js';

const router = Router();

/** Sidebar badges: open leads, conversations waiting for a reply, pending staff approvals. */
router.get('/nav/counts', async (req, res) => {
  try {
    res.json(await getNavCounts(req.admin));
  } catch (error) {
    console.error('Nav counts failed:', error.message);
    res.status(500).json({ error: 'Failed to load counts' });
  }
});

export default router;
