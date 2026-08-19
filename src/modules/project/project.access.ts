import { prisma }                              from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError }       from '../../errors/index.js';
import type { ProjectForPermission }           from './project.types.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const ProjectAccess = {
  async assertWorkspaceAccess(userId: string, workspaceId: string) {
    const cacheKey = CACHE_KEYS.workspaceAccess(workspaceId, userId);
    const workspace = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.workspace.findFirst({
          where: {
            id: workspaceId,
            OR: [{ ownerId: userId }, { members: { some: { userId } } }],
          },
        }),
      CACHE_TTL.ACCESS_CONTROL_WORKSPACE_MEMBER,
    );

    if (!workspace) throw new ForbiddenError('No access to this workspace');
    return workspace;
  },

  async assertProjectAdminAccess(userId: string, projectId: string) {
    const cacheKey = CACHE_KEYS.projectAdmin(projectId, userId);
    const project = await CacheClient.getOrSet(
      cacheKey,
      async () => {
        // Workspace owner or admin
        const proj = await prisma.project.findFirst({
          where: {
            id: projectId,
            workspace: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId, role: { in: ['ADMIN', 'OWNER'] } } } },
              ],
            },
          },
          include: { workspace: true },
        });
        if (proj) return proj;

        // Project MANAGER
        const projectWithManager = await prisma.project.findFirst({
          where:   { id: projectId, members: { some: { userId, role: 'MANAGER' } } },
          include: { workspace: true },
        });
        return projectWithManager;
      },
      CACHE_TTL.ACCESS_CONTROL_PROJECT_ADMIN,
    );

    if (!project) throw new ForbiddenError('Only admins can perform this action');
    return project;
  },

  async assertProjectAccess(userId: string, projectId: string) {
    const cacheKey = CACHE_KEYS.projectMember(projectId, userId);
    const project = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.project.findFirst({
          where: {
            id: projectId,
            workspace: {
              OR: [{ ownerId: userId }, { members: { some: { userId } } }],
            },
          },
        }),
      CACHE_TTL.ACCESS_CONTROL_PROJECT_MEMBER,
    );

    if (!project) {
      // Distinguish a missing project (404) from a real project the user
      // cannot access (403). Returning 403 FORBIDDEN lets the client render
      // the "access restricted" screen (matching the tasks module) instead of
      // a not-found page or an error toast.
      const exists = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
      throw new ForbiddenError('You do not have access to this project');
    }
    return project;
  },

  async assertProjectNotArchived(projectId: string) {
    const project = await prisma.project.findUnique({
      where:  { id: projectId },
      select: { status: true, name: true },
    });
    if (!project) throw new NotFoundError('Project');
    if (project.status === 'ARCHIVED') {
      throw new ForbiddenError('This project is archived and cannot be modified');
    }
  },

  async isProjectAdmin(userId: string, project: ProjectForPermission): Promise<boolean> {
    if (!project.workspace) return false;
    if (project.workspace.ownerId === userId) return true;

    // Workspace OWNER or ADMIN
    const workspaceAdmin = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: project.workspace.id,
        userId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    });
    if (workspaceAdmin) return true;

    // Project MANAGER
    const projectManager = await prisma.projectMember.findFirst({
      where: {
        projectId: project.id,
        userId,
        role: 'MANAGER',
      },
    });
    return !!projectManager;
  },
};