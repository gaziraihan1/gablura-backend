import { prisma }        from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import {
  projectListInclude,
  projectDetailInclude,
  projectWorkspaceListSelect,
} from './project.selects.js';
import { ProjectAccess }          from './project.access.js';
import { calculateProjectStats }  from './project.stats.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const ProjectQuery = {
  async getUserProjects(userId: string) {
    const cacheKey = CACHE_KEYS.projectList(userId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { members: { some: { userId } } },
          {
            workspace: {
              OR: [{ ownerId: userId }, { members: { some: { userId } } }, {isPublic: true}],
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

    const result = projects.map((project) => ({
      ...project,
      isAdmin:
        project.workspace?.ownerId === userId ||
        adminWorkspaceIds.has(project.workspace?.id ?? ''),
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.PROJECT_LIST);
    return result;
  },

  async getProjectsByWorkspace(userId: string, workspaceId: string) {
    await ProjectAccess.assertWorkspaceAccess(userId, workspaceId);

    const cacheKey = CACHE_KEYS.projectWorkspaceList(workspaceId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const projects = await prisma.project.findMany({
      where:   { workspaceId },
      select:  projectWorkspaceListSelect,
      orderBy: { createdAt: 'desc' },
    });

    await CacheClient.set(cacheKey, projects, CACHE_TTL.PROJECT_LIST);
    return projects;
  },

  async getProjectDetails(userId: string, projectId: string) {
    const cacheKey = CACHE_KEYS.projectById(projectId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId } } }, {isPublic: true}],
        },
      },
      include: projectDetailInclude,
    });

    if (!project) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');

    const [stats, isAdmin] = await Promise.all([
      Promise.resolve(calculateProjectStats(project)),
      ProjectAccess.isProjectAdmin(userId, project),
    ]);

    const result = { ...project, stats, isAdmin };
    await CacheClient.set(cacheKey, result, CACHE_TTL.PROJECT_METADATA);
    return result;
  },

  async getProjectBySlug(userId: string, slug: string) {
  const cacheKey = CACHE_KEYS.projectBySlug(slug);
  const cached = await CacheClient.get(cacheKey);
  
  if (cached) {
    // Verify access for cached data
    const cachedProject = cached as any;
    if (cachedProject.workspaceId) {
      const hasAccess = await prisma.workspace.findFirst({
        where: {
          id: cachedProject.workspaceId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId } } },
            { isPublic: true },
          ],
        },
        select: { id: true },
      });
      if (!hasAccess) throw new NotFoundError('Project');
    }
    return cached;
  }

  // First find the project by slug alone
  const project = await prisma.project.findFirst({
    where: { slug },
    include: projectDetailInclude,
  });

  if (!project) throw new NotFoundError('Project');

  // Then verify access separately using workspaceId directly
  if (project.workspaceId) {
    const hasAccess = await prisma.workspace.findFirst({
      where: {
        id: project.workspaceId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
          { isPublic: true },
        ],
      },
      select: { id: true },
    });
    console.log(hasAccess ? "User has access to the project" : "User does NOT have access to the project"); // Debugging log
    if (!hasAccess) throw new NotFoundError('Project');
  }

  const [stats, isAdmin] = await Promise.all([
    Promise.resolve(calculateProjectStats(project)),
    ProjectAccess.isProjectAdmin(userId, project),
  ]);

  const result = {
    ...project,
    isAdmin,
    stats: { ...stats, totalAnnouncement: project._count.announcement },
  };

  // Cache the result
  await CacheClient.set(cacheKey, result, CACHE_TTL.PROJECT_METADATA);
  return result;
},
};