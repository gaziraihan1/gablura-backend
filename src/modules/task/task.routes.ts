import { Router } from 'express';
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
} from './task.controller.js';
import { commentRouter } from '../comment/index.js';
import {
  getTaskAttachments,
  addAttachment,
  deleteAttachment,
} from '../attachment/index.js';
import { requireFileSizeLimit } from '../billing/index.js';
import { subtaskRouter } from './subtask/index.js';

const router = Router();

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