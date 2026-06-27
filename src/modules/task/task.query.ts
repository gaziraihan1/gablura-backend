import { prisma }        from '../../lib/prisma.js';
import type { TaskFilterParams, PaginationParams, SortParams, PaginatedTasksResult, TaskStats, TaskIntent } from './task.types.js';
import { taskFullInclude, taskDetailInclude } from './task.selects.js';
import { TaskFilters }   from './task.filters.js';
import { getTimeStatus } from './task.utils.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';
import { NotFoundError } from '../../errors/index.js';
import { Prisma, TaskStatus } from '@prisma/client';

async function countOverdueTasks(baseWhere: Record<string, unknown>, now: Date): Promise<number> {
  const scopedIds = await prisma.task.findMany({
    where:  { ...baseWhere, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    select: { id: true },
  });

  if (scopedIds.length === 0) return 0;

  const ids    = scopedIds.map((t) => t.id);
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::int AS count
    FROM   "Task"
    WHERE  id = ANY(${Prisma.sql`ARRAY[${Prisma.join(ids)}]::text[]`})
      AND  status NOT IN ('COMPLETED', 'CANCELLED')
      AND  (
             ("estimatedHours" IS NOT NULL AND "actualHours" IS NOT NULL AND "actualHours" > "estimatedHours")
             OR ("estimatedHours" IS NOT NULL AND "actualHours" IS NULL
                 AND EXTRACT(EPOCH FROM (${now}::timestamptz - "createdAt")) / 3600 > "estimatedHours")
             OR ("estimatedHours" IS NULL AND "dueDate" IS NOT NULL AND "dueDate" < ${now})
           )
  `;
  return Number(result[0].count);
}

export const TaskQuery = {
  async getTasks(
    filters:    TaskFilterParams,
    pagination: PaginationParams = {},
    sort:       SortParams       = {},
  ): Promise<PaginatedTasksResult> {
    const page      = Math.max(1, pagination.page ?? 1);
    const pageSize  = Math.min(100, Math.max(1, pagination.pageSize ?? 10));
    const skip      = (page - 1) * pageSize;
    const sortBy    = sort.sortBy    ?? 'createdAt';
    const sortOrder = sort.sortOrder ?? 'desc';

    let where: Record<string, unknown>;
    if (filters.projectId) {
      where = TaskFilters.buildProjectFilter(filters);
    } else if (!filters.workspaceId) {
      where = TaskFilters.buildPersonalTasksFilter(filters);
    } else {
      where = await TaskFilters.buildWorkspaceTasksFilter(filters);
    }

    where = TaskFilters.applyAdditionalFilters(where, filters);
    if (filters.search?.trim()) where = TaskFilters.applySearchFilter(where, filters.search);

    console.log('🔍 Filter Mode:', {
      projectId:   filters.projectId   || 'none',
      workspaceId: filters.workspaceId || 'none',
      type:        filters.type        || 'all',
      mode:        filters.projectId ? 'PROJECT' : (!filters.workspaceId ? 'PERSONAL' : 'WORKSPACE'),
    });

    const orderBy = TaskFilters.buildOrderBy(sortBy, sortOrder);

    const [tasks, totalCount] = await Promise.all([
      prisma.task.findMany({ where, include: taskFullInclude, orderBy, skip, take: pageSize }),
      prisma.task.count({ where }),
    ]);

    console.log(`📊 Found ${totalCount} tasks (showing ${tasks.length} on page ${page})`);

    const now = new Date();
    return {
      data: tasks.map((task) => ({ ...task, timeTracking: getTimeStatus(task, now) })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext:    page < Math.ceil(totalCount / pageSize),
        hasPrev:    page > 1,
      },
    };
  },

  async getTaskById(taskId: string, userId: string) {
  const cacheKey = CACHE_KEYS.taskById(taskId);
  const cached = await CacheClient.get(cacheKey);
  if (cached) return cached;

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        { createdById: userId },
        { assignees:  { some: { userId } } },
        { project:    { workspace: { members: { some: { userId } } } } },
        { project:    { workspace: { ownerId: userId } } },
        { workspace:  { members: { some: { userId } } } },
        { workspace:  { ownerId: userId } },
      ],
    },
    include: taskDetailInclude,
  });

  if (!task) throw new NotFoundError('Task');
  const result = { ...task, timeTracking: getTimeStatus(task) };
  await CacheClient.set(cacheKey, result, CACHE_TTL.TASK_METADATA);
  return result;
},

  async getTaskOverview(taskId: string, userId: string) {
    const cacheKey = CACHE_KEYS.taskOverview(taskId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      OR: [
        { createdById: userId },
        { assignees:  { some: { userId } } },
        { project:    { workspace: { members: { some: { userId } } } } },
        { project:    { workspace: { ownerId: userId } } },
        { workspace:  { members: { some: { userId } } } },
        { workspace:  { ownerId: userId } },
      ],
    },
    include: taskDetailInclude,
  });

    if (!task) throw new NotFoundError('Task');

    const [comments, attachments] = await Promise.all([
      prisma.comment.findMany({
        where:   { taskId, parentId: null },
        include: {
          user:    { select: { id: true, name: true, image: true } },
          replies: {
            include: {
              user:     { select: { id: true, name: true, image: true } },
              mentions: { include: { mentionedUser: { select: { id: true, name: true } } } },
            },
            orderBy: { createdAt: 'asc' },
          },
          mentions: { include: { mentionedUser: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.file.findMany({
        where:   { taskId },
        include: { uploadedBy: { select: { id: true, name: true, image: true } } },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);

    const result = { task: { ...task, timeTracking: getTimeStatus(task) }, comments, attachments };
    await CacheClient.set(cacheKey, result, CACHE_TTL.TASK_OVERVIEW);
    return result;
  },

  async getTaskStats(params: { userId: string; workspaceId?: string; type?: string }): Promise<TaskStats> {
    const cacheKey = CACHE_KEYS.taskStats(params.userId, params.workspaceId, params.type);

    const cached = await CacheClient.get<TaskStats>(cacheKey);
    if (cached) return cached;

    console.log('📊 Getting stats for:', { userId: params.userId, workspaceId: params.workspaceId || 'none', type: params.type || 'all' });

    const baseWhere = !params.workspaceId
      ? TaskFilters.buildPersonalTasksFilter({ userId: params.userId, type: params.type })
      : await TaskFilters.buildWorkspaceTasksFilter({ userId: params.userId, workspaceId: params.workspaceId, type: params.type });

    const activeWhere = { ...baseWhere, status: { notIn: ['COMPLETED', 'CANCELLED'] as TaskStatus[] } };
    const now         = new Date();

    const [
      totalTasks, inProgress, completed, overdueCount, dueTodayCount,
      statusCounts, personalCount, assignedCount, createdCount,
    ] = await Promise.all([
      prisma.task.count({ where: baseWhere }),
      prisma.task.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { ...baseWhere, status: 'COMPLETED' } }),
      countOverdueTasks(baseWhere, now),
      prisma.task.count({
        where: {
          ...activeWhere,
          dueDate: {
            gte: new Date(new Date(now).setHours(0, 0, 0, 0)),
            lt:  new Date(new Date(now).setHours(23, 59, 59, 999)),
          },
        },
      }),
      prisma.task.groupBy({ by: ['status'], where: baseWhere, _count: true }),
      prisma.task.count({ where: { projectId: null, createdById: params.userId } }),
      prisma.task.count({
        where: {
          assignees: { some: { userId: params.userId } },
          ...(params.workspaceId && { project: { workspaceId: params.workspaceId } }),
        },
      }),
      prisma.task.count({
        where: {
          createdById: params.userId,
          ...(params.workspaceId && { project: { workspaceId: params.workspaceId } }),
        },
      }),
    ]);

    const stats: TaskStats = {
      personal:   params.type === 'assigned' ? 0 : (params.workspaceId ? 0 : personalCount),
      assigned:   assignedCount,
      created:    createdCount,
      overdue:    overdueCount,
      dueToday:   dueTodayCount,
      totalTasks,
      inProgress,
      completed,
      byStatus: statusCounts.reduce(
        (acc, item) => { acc[item.status] = item._count; return acc; },
        {} as Record<string, number>,
      ),
    };

    console.log('📊 Stats result:', stats);
    CacheClient.set(cacheKey, stats, CACHE_TTL.TASK_STATS).catch(() => {});
    return stats;
  },

  async getTasksByIntent(params: { userId: string; intent: TaskIntent; workspaceId?: string }) {
    const where: Record<string, unknown> = {
      intent: params.intent,
      OR:     [{ createdById: params.userId }, { assignees: { some: { userId: params.userId } } }],
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    };

    if (params.workspaceId) where.project = { workspaceId: params.workspaceId };

    return prisma.task.findMany({
      where,
      include: {
        assignees: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
        labels:    { include: { label: true } },
        project:   { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    });
  },
};