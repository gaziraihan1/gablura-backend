import { prisma } from '../../lib/prisma.js';
import { addLogActivityJob } from '../../queue/index.js';

async function resolveWorkspaceSlug(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where:  { id: workspaceId },
    select: { slug: true },
  });
  return ws.slug;
}

export const ProjectActivity = {
  async logCreated(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    workspaceId:   string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'CREATED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: { projectName: params.projectName },
      });
    } catch (error) {
      console.error('Failed to log project creation activity:', error);
    }
  },

  async logUpdated(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    workspaceId:   string;
    changes:       Record<string, unknown>;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'UPDATED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: {
          projectName: params.projectName,
          changes:     params.changes as any,
        },
      });
    } catch (error) {
      console.error('Failed to log project update activity:', error);
    }
  },

  async logDeleted(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    workspaceId:   string;
    status:        string;
    priority:      string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'DELETED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: {
          projectName: params.projectName,
          status:      params.status,
          priority:    params.priority,
          deletedAt:   new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Failed to log project deletion activity:', error);
    }
  },

  async logMemberAdded(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    addedUserId:   string;
    role:          string;
    workspaceId:   string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'ASSIGNED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: {
          projectName:   params.projectName,
          addedUserId:   params.addedUserId,
          role:          params.role,
        },
      });
    } catch (error) {
      console.error('Failed to log project member added activity:', error);
    }
  },

  async logMemberRemoved(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    removedUserId: string;
    workspaceId:   string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'UNASSIGNED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: {
          projectName:   params.projectName,
          removedUserId: params.removedUserId,
        },
      });
    } catch (error) {
      console.error('Failed to log project member removed activity:', error);
    }
  },

  async logMemberRoleChanged(params: {
    projectId:     string;
    projectName:   string;
    userId:        string;
    targetUserId:  string;
    oldRole:       string;
    newRole:       string;
    workspaceId:   string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await addLogActivityJob({
        action:        'STATUS_CHANGED',
        entityType:    'PROJECT',
        entityId:      params.projectId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug,
        metadata: {
          projectName:  params.projectName,
          targetUserId: params.targetUserId,
          oldRole:      params.oldRole,
          newRole:      params.newRole,
        },
      });
    } catch (error) {
      console.error('Failed to log project member role changed activity:', error);
    }
  },
};
