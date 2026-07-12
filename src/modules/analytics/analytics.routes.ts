import { Router } from 'express';
import { AnalyticsController } from './analytics.controller.js';

const router = Router();

router.get('/:workspaceId/overview', AnalyticsController.getOverview);

router.get('/:workspaceId/projects/:projectId/overview', AnalyticsController.getProjectOverview);

router.get('/:workspaceId/projects/:projectId/tasks/trends', AnalyticsController.getProjectCompletionTrend);

router.get('/:workspaceId/projects/health', AnalyticsController.getProjectHealth);

router.get('/:workspaceId/projects/:projectId/members/contribution', AnalyticsController.getProjectMemberContribution);

router.get('/:workspaceId/projects/:projectId/time/summary', AnalyticsController.getProjectTimeSummary);

router.get('/:workspaceId/members/contribution', AnalyticsController.getMemberContribution);

router.get('/:workspaceId/time/summary', AnalyticsController.getTimeSummary);

router.get('/:workspaceId/activity/trends', AnalyticsController.getActivityTrends);

router.get('/:workspaceId/workload', AnalyticsController.getWorkload);

router.get('/:workspaceId/projects/:projectId/deadline-risk', AnalyticsController.getProjectDeadlineRisk);

export default router;