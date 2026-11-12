import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import {
  getAgencySettings,
  publicAgencySettings,
  staffAgencySettings,
  updateAgencySettings,
} from '../services/agencySettings.js';
import { logAuditEvent } from '../services/audit.js';

const router = Router();

router.get('/agency-settings', async (_req, res, next) => {
  try {
    res.json({ agency: staffAgencySettings(await getAgencySettings()) });
  } catch (error) {
    next(error);
  }
});

router.patch('/agency-settings', requireRole('admin'), async (req, res, next) => {
  try {
    const before = await getAgencySettings();
    const agency = await updateAgencySettings(req.body || {});
    void logAuditEvent({
      entityType: 'agency_settings',
      action: 'updated',
      actorId: req.admin?.id,
      actorRole: req.admin?.role,
      before: staffAgencySettings(before),
      after: staffAgencySettings(agency),
    });
    res.json({ agency: staffAgencySettings(agency) });
  } catch (error) {
    next(error);
  }
});

export default router;
