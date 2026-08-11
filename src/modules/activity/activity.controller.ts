import type { Response }      from 'express';
import type { AuthRequest }   from '../../middleware/auth.js';
import type { ActivityType, EntityType } from './activity.types.js';
import { ActivityQuery }      from './activity.query.js';
import { ActivityMutation }   from './activity.mutation.js';
import { ActivityAccess }     from './activity.access.js';
import { asyncHandler, ForbiddenError } from '../../errors/index.js';

const toInt = (value: unknown, fallback: number): number => {
  const parsed = parseInt(value as string, 10);
  return isNaN(parsed) ? fallback : parsed;
};

export const getActivities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { workspaceId, entityType, action, startDate, endDate } = req.query;
  const limit  = toInt(req.query.limit,  50);
  const offset = toInt(req.query.offset, 0);

  const activities = await ActivityQuery.getUserActivities(userId, {
    workspaceId: workspaceId as string      | undefined,
    entityType:  entityType  as EntityType  | undefined,
    action:      action      as ActivityType | undefined,
    startDate:   startDate ? new Date(startDate as string) : undefined,
    endDate:     endDate   ? new Date(endDate   as string) : undefined,
    limit,
    offset,
  });

  res.json({
    success: true,
    data: activities,
    meta: { limit, offset, hasMore: activities.length === limit },
  });
});

export const getWorkspaceActivities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId } = req.params;
  const { action, entityType } = req.query;
  const limit  = toInt(req.query.limit,  50);
  const offset = toInt(req.query.offset, 0);

  const { hasAccess, isAdmin } = await ActivityAccess.getWorkspaceAccess(req.user!.id, workspaceId);
  const isPublic = await ActivityAccess.isPublicWorkspace(workspaceId);
  if(!hasAccess && !isPublic) throw new ForbiddenError('You do not have access to this workspace');

  // Workspace owners/admins see Focura-admin audit rows (e.g. AI cap changes)
  // in the feed; regular members and public viewers don't.
  const includeAdminRows = isAdmin;

  const activities = await ActivityQuery.getWorkspaceActivities(
    workspaceId,
    {
      action:     action     as ActivityType | undefined,
      entityType: entityType as EntityType  | undefined,
      limit,
      offset,
    },
    { includeAdminRows },
  );

  res.json({
    success: true,
    data: activities,
    meta: { limit, offset, hasMore: activities.length === limit },
  });
});

export const getTaskActivities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { taskId } = req.params;
  const limit  = toInt(req.query.limit,  50);
  const offset = toInt(req.query.offset, 0);

  const hasAccess = await ActivityAccess.canAccessTask(req.user!.id, taskId);
  if (!hasAccess) throw new ForbiddenError('You do not have access to this task');

  const activities = await ActivityQuery.getTaskActivities(taskId, { limit, offset });

  res.json({
    success: true,
    data: activities,
    meta: { limit, offset, hasMore: activities.length === limit },
  });
});

export const clearActivities = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { workspaceId, before } = req.query;

  const deletedCount = await ActivityMutation.clearUserActivities(req.user!.id, {
    workspaceId: workspaceId as string | undefined,
    before:      before ? new Date(before as string) : undefined,
  });

  res.json({
    success: true,
    message: `Successfully cleared ${deletedCount} activities`,
    data: { deletedCount },
  });
});

export const deleteActivity = asyncHandler(async (req: AuthRequest, res: Response) => {
  await ActivityMutation.deleteActivity(req.params.activityId, req.user!.id);
  res.json({ success: true, message: 'Activity deleted successfully' });
});