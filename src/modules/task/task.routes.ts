import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import { upload } from '../../middleware/upload.js';
import {
  getTasks,
  getTaskStats,
  createTask,
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  getPersonalQuota,
  getWorkspaceQuota,
  getTaskOverview,
  linkGitHubEntity,
  unlinkGitHubEntity,
  linkSlackMessage,
  unlinkSlackMessage,
  upsertRecurrence,
  deleteRecurrence,
} from './task.controller.js';
import { commentRouter } from '../comment/index.js';
import {
  getTaskAttachments,
  addAttachment,
  deleteAttachment,
} from '../attachment/index.js';
import { subtaskRouter } from './subtask/index.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
// Mounted once here so it also guards the nested comment, subtask and
// attachment routers — each user shares one sliding-window bucket.
router.use(rateLimitUserApi);

router.get('/quota/personal',                  getPersonalQuota);
router.get('/quota/workspace/:workspaceId',    getWorkspaceQuota);

router.get('/stats',        getTaskStats);
router.get('/',             getTasks);
router.post('/',            createTask);
router.get('/:id/overview', getTaskOverview);
router.get('/:id',          getTask);
router.put('/:id',          updateTask);
router.patch('/:id/status', updateTaskStatus);
router.delete('/:id',       deleteTask);

router.post('/:id/recurrence',   upsertRecurrence);
router.delete('/:id/recurrence', deleteRecurrence);

router.put('/:id/github-link', linkGitHubEntity);
router.put('/:id/github-unlink', unlinkGitHubEntity);

router.put('/:id/slack-link', linkSlackMessage);
router.put('/:id/slack-unlink', unlinkSlackMessage);

router.use('/:taskId/comments', commentRouter);

router.use('/:taskId/subtasks', subtaskRouter)

router.get('/:taskId/attachments',                                              getTaskAttachments);
router.post('/:taskId/attachments', upload.single('file'), addAttachment);
router.delete('/:taskId/attachments/:attachmentId',                             deleteAttachment);

export default router;