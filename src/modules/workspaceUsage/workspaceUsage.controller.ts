import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.js';
import { WorkspaceUsageQuery } from './workspaceUsage.query.js';
import { prisma } from '../../lib/prisma.js';
import { WorkspaceUsageAccess } from './workspaceUsage.access.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

async function assertWorkspaceUsageAccess(
  workspaceId: string,
  userId: string
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });

  if (!workspace) {
    throw new NotFoundError('Workspace');
  }

  if (workspace.plan === "FREE") {
    throw new ForbiddenError("Upgrade workspace plan to access usage analytics");
  }

  await WorkspaceUsageAccess.assertWorkspaceMember(userId, workspaceId);
}

export class WorkspaceUsageController {
  static async getWorkspaceUsage(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { workspaceId } = req.params;

      await assertWorkspaceUsageAccess(workspaceId, req.user.id);

      const data = await WorkspaceUsageQuery.getWorkspaceUsage(
        workspaceId,
        req.user.id
      );

      return res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('Workspace usage error:', error);

      if (error instanceof ForbiddenError) {
        return res.status(403).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }

      if (error instanceof NotFoundError) {
        return res.status(404).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch workspace usage data',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}