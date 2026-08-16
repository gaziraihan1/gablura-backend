import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import {
  getTaskEntries,
  getMyEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
} from './timeEntry.controller.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

router.get('/task/:taskId', getTaskEntries);
router.get('/my',           getMyEntries);
router.post('/',            createTimeEntry);
router.patch('/:id',        updateTimeEntry);
router.delete('/:id',       deleteTimeEntry);

export default router;
