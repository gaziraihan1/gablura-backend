import { Router } from 'express';
import * as WorkspaceController from './workspace.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { sessionTimeout } from '../../middleware/sessionTimeout.js';
import { requireCsrfToken } from '../../middleware/csrf.js';
import {
  requireWorkspaceCreationSlot,
  requireMemberSlot,
  requireMemberSlotForInvitation,
} from '../billing/index.js';
import { getAttachmentStats } from '../attachment/index.js';
import { getWorkspaceStorage } from '../attachment/attachment.controller.js';
import { workspaceAnnouncementRouter } from '../announcement/index.js';

const router = Router();

router.get('/invitations/:token', WorkspaceController.getInvitation);
router.use(authenticate);
router.use(sessionTimeout);
// Every mutating route below requires a valid CSRF token (see
// requireCsrfToken: GET/HEAD/OPTIONS and webhook/callback paths are skipped,
// so read routes are unaffected). The invitation GET above stays public.
router.use(requireCsrfToken());
// The member cap must hold on accept too, not just on invite — otherwise an
// over-limit workspace keeps growing via previously-issued invitations.
router.post(
  '/invitations/:token/accept',
  requireMemberSlotForInvitation,
  WorkspaceController.acceptInvitation,
);

router.get('/', WorkspaceController.getAllWorkspaces);
router.post('/', requireWorkspaceCreationSlot, WorkspaceController.createWorkspace);
router.get('/public', WorkspaceController.getPublicWorkspaces);
router.get('/:slug/overview', WorkspaceController.getWorkspaceOverview);
router.get('/:workspaceSlug/tasks', WorkspaceController.getWorkspaceTasks);
router.get('/:slug', WorkspaceController.getWorkspace);
router.put('/:id', WorkspaceController.updateWorkspace);
router.delete('/:id', WorkspaceController.deleteWorkspace);
router.get('/:id/members', WorkspaceController.getMembers);
router.post('/:id/invite', requireMemberSlot, WorkspaceController.inviteMember);
router.delete('/:id/members/:memberId', WorkspaceController.removeMember);
router.put('/:id/members/:memberId/role', WorkspaceController.updateMemberRole);
router.get('/:id/stats', WorkspaceController.getStats);

router.get('/:workspaceId/attachments/stats', getAttachmentStats);
router.get('/:workspaceId/storage', getWorkspaceStorage);

// Announcements (nested router)
router.use('/:workspaceSlug/announcements', workspaceAnnouncementRouter);

// Leave workspace
router.post('/:id/leave', WorkspaceController.leaveWorkspace);

export default router;