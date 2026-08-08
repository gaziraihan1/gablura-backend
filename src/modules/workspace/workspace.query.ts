import { prisma } from "../../lib/prisma.js";
import {
  workspaceListInclude,
  workspaceDetailInclude,
} from "./workspace.selects.js";
import { WorkspaceAccess } from "./workspace.access.js";
import type { WorkspaceStats } from "./workspace.types.js";
import { projectWorkspaceListSelect } from "../project/project.selects.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL } from "../../lib/redis/cache.client.js";
import { NotFoundError, ForbiddenError } from "../../errors/AppError.js";


export const WorkspaceQuery = {
  async getUserWorkspaces(userId: string, limit: number = 50) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } }, deletedAt: null },
      include: workspaceListInclude,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  },

  async getBySlug(slug: string, userId: string) {
    // Try cache first
    const cacheKey = CACHE_KEYS.workspaceBySlug(slug);
    const cached = await CacheClient.get(cacheKey);
    if (cached) {
      if ((cached as any).deletedAt) throw new NotFoundError("Workspace");
      return cached;
    }

    // Fetch from database
    const workspace = await prisma.workspace.findFirst({
      where: {
        slug,
        deletedAt: null,
        OR: [
          { isPublic: true },
          { members: { some: { userId } } },
        ],
      },
      include: workspaceDetailInclude,
    });
if (!workspace) throw new NotFoundError("Workspace");

    await CacheClient.set(cacheKey, workspace, CACHE_TTL.WORKSPACE_METADATA);

    return workspace;
  },

  async getById(id: string, userId: string) {
    const cacheKey = CACHE_KEYS.workspaceById(id);
    const cached = await CacheClient.get(cacheKey);
    if (cached) {
      if ((cached as any).deletedAt) throw new NotFoundError("Workspace");
      return cached;
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { isPublic: true },
          { members: { some: { userId } } },
        ],
      },
      include: workspaceDetailInclude,
    });
if (!workspace) throw new NotFoundError("Workspace");

    await CacheClient.set(cacheKey, workspace, CACHE_TTL.WORKSPACE_METADATA);

    return workspace;
  },

  async getMembers(workspaceId: string, userId: string) {
    await WorkspaceAccess.assertMember(workspaceId, userId);
    await WorkspaceAccess.assertNotSuspended(workspaceId);
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
  },

  async getStats(workspaceId: string, userId: string): Promise<WorkspaceStats> {
  await WorkspaceAccess.assertViewer(workspaceId, userId); // relaxed
  await WorkspaceAccess.assertNotSuspended(workspaceId);
  return WorkspaceQuery.computeStats(workspaceId);
},

  async getOverview(slug: string, userId: string) {
    // Try cache first
    const cacheKey = CACHE_KEYS.workspaceOverview(slug);
    const cached = await CacheClient.get(cacheKey);
    if (cached) {
      if ((cached as any)?.workspace?.deletedAt) {
        throw new ForbiddenError("This workspace has been suspended", "WORKSPACE_SUSPENDED");
      }
      return cached;
    }

    const isId = /^[a-z0-9]{20,}$/i.test(slug);

    const workspace = await prisma.workspace.findFirst({
      where: isId
        ? { id: slug,   OR: [{ isPublic: true }, { members: { some: { userId } } }] }
        : { slug,       OR: [{ isPublic: true }, { members: { some: { userId } } }] },
      include: workspaceDetailInclude,
    });

    if (!workspace) throw new NotFoundError("Workspace");
if (workspace.deletedAt) throw new ForbiddenError("This workspace has been suspended", "WORKSPACE_SUSPENDED");

    const [stats, projects] = await Promise.all([
      WorkspaceQuery.computeStats(workspace.id),
      prisma.project.findMany({
        where:   { workspaceId: workspace.id },
        select:  projectWorkspaceListSelect,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const result = { workspace, stats, projects };

    await CacheClient.set(cacheKey, result, CACHE_TTL.WORKSPACE_OVERVIEW);

    return result;
  },

  async computeStats(workspaceId: string): Promise<WorkspaceStats> {
    const cacheKey = CACHE_KEYS.workspaceStats(workspaceId);
    const cached = await CacheClient.get<WorkspaceStats>(cacheKey);
    if (cached) return cached;

    const [
      totalProjects,
      totalTasks,
      totalMembers,
      completedTasks,
      overdueTasks,
    ] = await Promise.all([
      prisma.project.count({ where: { workspaceId } }),
      prisma.task.count({ where: { project: { workspaceId } } }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.task.count({ where: { project: { workspaceId }, status: "COMPLETED" } }),
      prisma.task.count({
        where: {
          project: { workspaceId },
          dueDate: { lt: new Date() },
          status:  { notIn: ["COMPLETED", "CANCELLED"] },
        },
      }),
    ]);

    const stats = {
      totalProjects,
      totalTasks,
      totalMembers,
      completedTasks,
      overdueTasks,
      completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
    };

    await CacheClient.set(cacheKey, stats, CACHE_TTL.WORKSPACE_STATS);

    return stats;
  },

  async getInvitationByToken(token: string) {
    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { token },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            logo: true,
            color: true,
          },
        },
      },
    });
if (!invitation) throw new NotFoundError("Invitation");
    return invitation;
  },
};