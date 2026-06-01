import { prisma }        from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import {
  projectListInclude,
  projectDetailInclude,
  projectWorkspaceListSelect,
} from './project.selects.js';
import { ProjectAccess }          from './project.access.js';
import { calculateProjectStats }  from './project.stats.js';

export const ProjectQuery = {
  async getUserProjects(userId: string) {
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { members: { some: { userId } } },
          {
            workspace: {
              OR: [{ ownerId: userId }, { members: { some: { userId } } }],
            },
          },
        ],
      },
      include: projectListInclude,
      orderBy: { updatedAt: 'desc' },
    });

    const nonOwnerWorkspaceIds = projects
      .filter((p) => p.workspace?.ownerId !== userId)
      .map((p) => p.workspace!.id);

    const adminMemberships = nonOwnerWorkspaceIds.length > 0
      ? await prisma.workspaceMember.findMany({
          where: {
            userId,
            workspaceId: { in: nonOwnerWorkspaceIds },
            role:        { in: ['OWNER', 'ADMIN'] },
          },
          select: { workspaceId: true },
        })
      : [];

    const adminWorkspaceIds = new Set(adminMemberships.map((m) => m.workspaceId));

    return projects.map((project) => ({
      ...project,
      isAdmin:
        project.workspace?.ownerId === userId ||
        adminWorkspaceIds.has(project.workspace?.id ?? ''),
    }));
  },

  async getProjectsByWorkspace(userId: string, workspaceId: string) {
    await ProjectAccess.assertWorkspaceAccess(userId, workspaceId);

    return prisma.project.findMany({
      where:   { workspaceId },
      select:  projectWorkspaceListSelect,
      orderBy: { createdAt: 'desc' },
    });
  },

  async getProjectDetails(userId: string, projectId: string) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
      },
      include: projectDetailInclude,
    });

    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

    const [stats, isAdmin] = await Promise.all([
      Promise.resolve(calculateProjectStats(project)),
      ProjectAccess.isProjectAdmin(userId, project),
    ]);

    return { ...project, stats, isAdmin };
  },

  async getProjectBySlug(userId: string, slug: string) {
    const project = await prisma.project.findFirst({
      where: {
        slug,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
      },
      include: projectDetailInclude,
    });

    if (!project) throw new NotFoundError('Project');

    const [stats, isAdmin] = await Promise.all([
      Promise.resolve(calculateProjectStats(project)),
      ProjectAccess.isProjectAdmin(userId, project),
    ]);

    return {
      ...project,
      isAdmin,
      stats: { ...stats, totalAnnouncement: project._count.announcement },
    };
  },
};