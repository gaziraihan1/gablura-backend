import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { prisma } from '../lib/prisma.js';

export enum Permission {
  // Workspace permissions
  WORKSPACE_VIEW = 'workspace:view',
  WORKSPACE_EDIT = 'workspace:edit',
  WORKSPACE_DELETE = 'workspace:delete',
  WORKSPACE_INVITE = 'workspace:invite',
  
  // Project permissions
  PROJECT_CREATE = 'project:create',
  PROJECT_VIEW = 'project:view',
  PROJECT_EDIT = 'project:edit',
  PROJECT_DELETE = 'project:delete',
  
  // Task permissions
  TASK_CREATE = 'task:create',
  TASK_VIEW = 'task:view',
  TASK_EDIT = 'task:edit',
  TASK_DELETE = 'task:delete',
  TASK_ASSIGN = 'task:assign',
  
  // Billing permissions
  BILLING_VIEW = 'billing:view',
  BILLING_MANAGE = 'billing:manage',
  
  // Admin permissions
  ADMIN_ALL = 'admin:all',
}

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: [Permission.ADMIN_ALL],
  WORKSPACE_OWNER: [
    Permission.WORKSPACE_VIEW,
    Permission.WORKSPACE_EDIT,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_INVITE,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_VIEW,
    Permission.PROJECT_EDIT,
    Permission.PROJECT_DELETE,
    Permission.TASK_CREATE,
    Permission.TASK_VIEW,
    Permission.TASK_EDIT,
    Permission.TASK_DELETE,
    Permission.TASK_ASSIGN,
    Permission.BILLING_VIEW,
    Permission.BILLING_MANAGE,
  ],
  WORKSPACE_ADMIN: [
    Permission.WORKSPACE_VIEW,
    Permission.WORKSPACE_EDIT,
    Permission.WORKSPACE_INVITE,
    Permission.PROJECT_CREATE,
    Permission.PROJECT_VIEW,
    Permission.PROJECT_EDIT,
    Permission.TASK_CREATE,
    Permission.TASK_VIEW,
    Permission.TASK_EDIT,
    Permission.TASK_ASSIGN,
    Permission.BILLING_VIEW,
  ],
  WORKSPACE_MEMBER: [
    Permission.WORKSPACE_VIEW,
    Permission.PROJECT_VIEW,
    Permission.TASK_CREATE,
    Permission.TASK_VIEW,
    Permission.TASK_EDIT,
  ],
  WORKSPACE_VIEWER: [
    Permission.WORKSPACE_VIEW,
    Permission.PROJECT_VIEW,
    Permission.TASK_VIEW,
  ],
};

/**
 * Check if user has permission
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  
  // Admin has all permissions
  if (permissions.includes(Permission.ADMIN_ALL)) return true;
  
  return permissions.includes(permission);
}

/**
 * Middleware to require specific permission
 */
export const requirePermission = (...permissions: Permission[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const userRole = req.user.role;
    const hasRequiredPermission = permissions.some(permission =>
      hasPermission(userRole, permission)
    );

    if (!hasRequiredPermission) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'FORBIDDEN',
        required: permissions,
      });
    }

    next();
  };
};

/**
 * Check workspace membership and role
 */
export const requireWorkspaceMembership = (minRole?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const workspaceId = req.params.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'Workspace ID required',
        code: 'MISSING_WORKSPACE_ID',
      });
    }

    // Check membership
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
            userId: req.user.id,
            workspaceId,
        },
      },
      select: { role: true },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Not a member of this workspace',
        code: 'NOT_WORKSPACE_MEMBER',
      });
    }

    // Check minimum role if specified
    if (minRole) {
      const roleHierarchy = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];
      const userRoleIndex = roleHierarchy.indexOf(membership.role);
      const requiredRoleIndex = roleHierarchy.indexOf(minRole);

      if (userRoleIndex < requiredRoleIndex) {
        return res.status(403).json({
          success: false,
          message: `Minimum role required: ${minRole}`,
          code: 'INSUFFICIENT_ROLE',
          required: minRole,
          current: membership.role,
        });
      }
    }

    // Attach workspace role to request
    (req as any).workspaceRole = membership.role;

    next();
  };
};

/**
 * Check resource ownership
 */
export const requireResourceOwnership = (resourceType: 'task' | 'project') => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const resourceId = req.params.id || req.params.taskId || req.params.projectId;
    if (!resourceId) {
      return res.status(400).json({
        success: false,
        message: `${resourceType} ID required`,
        code: 'MISSING_RESOURCE_ID',
      });
    }

    if (resourceType === 'task') {
  const task = await prisma.task.findUnique({
    where: { id: resourceId },
    select: {
      createdById: true,
      assignees: { select: { userId: true } }, // ✅ not assigneeId
    },
  });

  if (!task) {
    return res.status(404).json({
      success: false,
      message: 'Task not found',
      code: 'TASK_NOT_FOUND',
    });
  }

  // Allow creator and assignee
  if (
    task.createdById !== req.user.id &&
    !task.assignees.some((a) => a.userId === req.user?.id) // ✅ not task.assignees.id
  ) {
    return res.status(403).json({
      success: false,
      message: 'You can only modify tasks you created or are assigned to',
      code: 'NOT_RESOURCE_OWNER',
    });
  }
}else if (resourceType === 'project') {
      const project = await prisma.project.findUnique({
        where: { id: resourceId },
        select: { createdById: true },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found',
          code: 'PROJECT_NOT_FOUND',
        });
      }

      if (project.createdById !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'You can only modify projects you created',
          code: 'NOT_RESOURCE_OWNER',
        });
      }
    }

    next();
  };
};