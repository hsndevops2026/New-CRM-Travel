import { Router } from 'express';
import { getCustomerPortal } from '../services/portal.js';

const router = Router();

router.get('/home', async (req, res) => {
  try {
    const data = await getCustomerPortal(req.admin);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load portal' });
  }
});

export default router;