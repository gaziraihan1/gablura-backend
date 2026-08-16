import { Router } from 'express';
import { rateLimitUserApi } from '../../middleware/apiRateLimiter.js';
import { AnalyticsController } from './analytics.controller.js';
import { requireAnalyticsAccess } from '../billing/index.js';

const router = Router();

// Per-user API rate limiting (tier-based by billing plan, fail-closed).
router.use(rateLimitUserApi);

router.get('/:workspaceId/overview', requireAnalyticsAccess, AnalyticsController.getOverview);

router.get('/:workspaceId/projects/:projectId/overview', requireAnalyticsAccess, AnalyticsController.getProjectOverview);

router.get('/:workspaceId/tasks/trends', requireAnalyticsAccess, AnalyticsController.getTaskTrends);

router.get('/:workspaceId/projects/:projectId/tasks/trends', requireAnalyticsAccess, AnalyticsController.getProjectCompletionTrend);

router.get('/:workspaceId/projects/health', requireAnalyticsAccess, AnalyticsController.getProjectHealth);

router.get('/:workspaceId/projects/:projectId/members/contribution', requireAnalyticsAccess, AnalyticsController.getProjectMemberContribution);

router.get('/:workspaceId/projects/:projectId/time/summary', requireAnalyticsAccess, AnalyticsController.getProjectTimeSummary);

router.get('/:workspaceId/projects/:projectId/time/report', requireAnalyticsAccess, AnalyticsController.getProjectTimeReport);

router.get('/:workspaceId/members/contribution', requireAnalyticsAccess, AnalyticsController.getMemberContribution);

router.get('/:workspaceId/time/summary', requireAnalyticsAccess, AnalyticsController.getTimeSummary);

router.get('/:workspaceId/time/report', requireAnalyticsAccess, AnalyticsController.getTimeReport);

router.get('/:workspaceId/activity/trends', requireAnalyticsAccess, AnalyticsController.getActivityTrends);

router.get('/:workspaceId/workload', requireAnalyticsAccess, AnalyticsController.getWorkload);

router.get('/:workspaceId/projects/:projectId/deadline-risk', requireAnalyticsAccess, AnalyticsController.getProjectDeadlineRisk);

export default router;