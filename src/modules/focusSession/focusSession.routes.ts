import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import {
  startSession,
  completeSession,
  cancelSession,
  getActiveSession,
  getHistory,
  getStats,
  getDailySummary,
} from './focusSession.controller.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

router.post('/start',   startSession);
router.get('/active',   getActiveSession);
router.get('/history',  getHistory);
router.get('/stats',    getStats);
router.get('/daily-summary', getDailySummary);

router.post('/:id/complete', completeSession);
router.post('/:id/cancel',   cancelSession);

export default router;