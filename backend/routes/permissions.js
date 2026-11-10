import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { addUserCredits, listUsers, setUserApproval } from '../services/permissions.js';

const router = Router();
router.use(requireRole('admin'));

router.get('/users', async (_req, res, next) => {
  try { res.json({ users: await listUsers() }); } catch (error) { next(error); }
});

router.patch('/users/:id/approval', async (req, res, next) => {
  try {
    const user = await setUserApproval(req.params.id, req.body?.status);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (error) { return next(error); }
});

router.post('/users/:id/credits', async (req, res, next) => {
  try {
    const user = await addUserCredits(req.params.id, req.body?.amount);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (error) { return next(error); }
});

export default router;
