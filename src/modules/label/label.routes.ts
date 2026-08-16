import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import {
  getLabels,
  getPopularLabels,
  getLabelById,
  createLabel,
  updateLabel,
  deleteLabel,
  addLabelToTask,
  removeLabelFromTask,
  getLabelTasks,
} from './label.controller.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

router.get('/',         getLabels);
router.get('/popular',  getPopularLabels);
router.get('/:id',      getLabelById);
router.get('/:id/tasks', getLabelTasks);
router.post('/',        createLabel);
router.patch('/:id',    updateLabel);
router.delete('/:id',   deleteLabel);

router.post('/:labelId/tasks/:taskId',   addLabelToTask);
router.delete('/:labelId/tasks/:taskId', removeLabelFromTask);

export default router;