import { Router } from 'express';
import { requireRole } from '../middleware/requireRole.js';
import { employeeReport, overdueReport, parseRange, pipelineReport } from '../services/reports.js';

const router = Router();

function fail(res, error) {
  if (!error.status || error.status >= 500) console.error('[reports]', error.message);
  res.status(error.status || 500).json({ error: error.status && error.status < 500 ? error.message : 'Failed to build the report' });
}

function intParam(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

router.get('/reports/pipeline', requireRole('admin'), async (req, res) => {
  try { res.json(await pipelineReport(parseRange(req.query))); } catch (error) { fail(res, error); }
});

router.get('/reports/employees', requireRole('admin'), async (req, res) => {
  try { res.json(await employeeReport(parseRange(req.query))); } catch (error) { fail(res, error); }
});

router.get('/reports/overdue', requireRole('admin'), async (req, res) => {
  try {
    res.json(await overdueReport({
      replyHours: intParam(req.query.reply_hours, 2, 1, 168),
      quoteDays: intParam(req.query.quote_days, 2, 1, 60),
      staleDays: intParam(req.query.stale_days, 3, 1, 60),
    }));
  } catch (error) { fail(res, error); }
});

export default router;
