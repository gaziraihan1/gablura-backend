import { Router } from 'express';
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

router.post('/start',   startSession);
router.get('/active',   getActiveSession);
router.get('/history',  getHistory);
router.get('/stats',    getStats);
router.get('/daily-summary', getDailySummary);

router.post('/:id/complete', completeSession);
router.post('/:id/cancel',   cancelSession);

export default router;