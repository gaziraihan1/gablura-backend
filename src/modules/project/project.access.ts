import { prisma }                              from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError }       from '../../errors/index.js';
import type { ProjectForPermission }           from './project.types.js';

export const ProjectAccess = {
  async assertWorkspaceAccess(userId: string, workspaceId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    if (!workspace) throw new ForbiddenError('No access to this workspace');
    return workspace;
  },

  async assertProjectAdminAccess(userId: string, projectId: string) {
    // Workspace owner or admin
    const project = await prisma.project.findFirst({
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
    if (project) return project;

    // Project MANAGER
    const projectWithManager = await prisma.project.findFirst({
      where:   { id: projectId, members: { some: { userId, role: 'MANAGER' } } },
      include: { workspace: true },
    });
    if (!projectWithManager) throw new ForbiddenError('Only admins can perform this action');
    return projectWithManager;
  },

  async assertProjectAccess(userId: string, projectId: string) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
      },
    });

    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
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

    const adminMember = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: project.workspace.id,
        userId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    });
    return !!adminMember;
  },
};