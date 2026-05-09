import { prisma } from '../../lib/prisma.js';
import type {
  TaskFilterParams,
  PaginationParams,
  SortParams,
  PaginatedTasksResult,
  TaskStats,
  TaskIntent,
} from './task.types.js';
import { taskFullInclude, taskDetailInclude } from './task.selects.js';
import { TaskFilters } from './task.filters.js';
import { getTimeStatus } from './task.utils.js';
import { CacheClient } from '../../lib/redis/cache.client.js';
import { Prisma, TaskStatus } from '@prisma/client';

// ─── Overdue count ────────────────────────────────────────────────────────────
//
// Mirrors the three branches in getTimeStatus() exactly, pushed fully into the
// DB — zero rows fetched into Node memory regardless of dataset size.
//
// Scoping is handled by extracting a flat id list from Prisma's resolved
// baseWhere filter, which keeps all the complex workspace/project/user JOIN
// logic in one place (TaskFilters) without duplicating it in raw SQL.
//
// The two queries (id fetch + raw count) are cheaper than the old approach
// because:
//   • The id fetch is SELECT id only — minimal row payload
//   • The raw count uses ANY(array) which hits the primary-key index
//   • No task rows are hydrated into JS objects
//
// If your active task sets regularly exceed ~10 000, consider the generated
// column approach documented in the N+1 fix notes instead.

async function countOverdueTasks(
  baseWhere: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const scopedIds = await prisma.task.findMany({
    where: {
      ...baseWhere,
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    select: { id: true },
  });

  if (scopedIds.length === 0) return 0;

  const ids = scopedIds.map((t) => t.id);

  // Prisma.join wraps each value safely — no manual string interpolation
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::int AS count
    FROM   tasks
    WHERE  id = ANY(${Prisma.sql`ARRAY[${Prisma.join(ids)}]::uuid[]`})
      AND  status NOT IN ('COMPLETED', 'CANCELLED')
      AND  (
             -- Branch A: actual time logged exceeds estimate
             (
               "estimatedHours" IS NOT NULL
               AND "actualHours" IS NOT NULL
               AND "actualHours" > "estimatedHours"
             )
             OR
             -- Branch B: elapsed hours since creation exceeds estimate
             --           (no actual hours logged yet)
             (
               "estimatedHours" IS NOT NULL
               AND "actualHours" IS NULL
               AND EXTRACT(EPOCH FROM (${now}::timestamptz - "createdAt")) / 3600
                   > "estimatedHours"
             )
             OR
             -- Branch C: no estimate at all — plain deadline has passed
             (
               "estimatedHours" IS NULL
               AND "dueDate" IS NOT NULL
               AND "dueDate" < ${now}
             )
           )
  `;

  return Number(result[0].count);
}


export const TaskQuery = {
  // ── List ──────────────────────────────────────────────────────────────────

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

    if (filters.search?.trim()) {
      where = TaskFilters.applySearchFilter(where, filters.search);
    }

    console.log('🔍 Filter Mode:', {
      projectId:   filters.projectId   || 'none',
      workspaceId: filters.workspaceId || 'none',
      type:        filters.type        || 'all',
      mode:        filters.projectId
        ? 'PROJECT'
        : (!filters.workspaceId ? 'PERSONAL' : 'WORKSPACE'),
    });

    const orderBy = TaskFilters.buildOrderBy(sortBy, sortOrder);

    const [tasks, totalCount] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskFullInclude,
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.task.count({ where }),
    ]);

    console.log(`📊 Found ${totalCount} tasks (showing ${tasks.length} on page ${page})`);

    const now = new Date();
    const tasksWithTracking = tasks.map((task) => ({
      ...task,
      timeTracking: getTimeStatus(task, now),
    }));

    return {
      data: tasksWithTracking,
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

  // ── Single task ───────────────────────────────────────────────────────────

  async getTaskById(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { workspace: { members: { some: { userId } } } } },
          { workspace: { members: { some: { userId } } } },
        ],
      },
      include: taskDetailInclude,
    });

    if (!task) throw new Error('Task not found');
    return { ...task, timeTracking: getTimeStatus(task) };
  },

  // ── Detail page — single round-trip for task + comments + attachments ─────

  async getTaskOverview(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { workspace: { members: { some: { userId } } } } },
          { workspace: { members: { some: { userId } } } },
        ],
      },
      include: taskDetailInclude,
    });

    if (!task) throw new Error('Task not found');

    const [comments, attachments] = await Promise.all([
      prisma.comment.findMany({
        where:   { taskId, parentId: null },
        include: {
          user:    { select: { id: true, name: true, image: true } },
          replies: {
            include: {
              user: { select: { id: true, name: true, image: true } },
              mentions: {
                include: {
                  mentionedUser: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          mentions: {
            include: {
              mentionedUser: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.file.findMany({
        where:   { taskId },
        include: {
          uploadedBy: { select: { id: true, name: true, image: true } },
        },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);

    return {
      task:        { ...task, timeTracking: getTimeStatus(task) },
      comments,
      attachments,
    };
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  //
  // All counts run in a single Promise.all — no rows fetched into memory.
  // Overdue is delegated to countOverdueTasks() which mirrors getTimeStatus()
  // branch-for-branch inside the DB.
  // Results are cached for 2 minutes; mutations must call CacheClient.deletePattern
  // with `stats:${userId}:*` to bust on write.

  async getTaskStats(params: {
    userId:       string;
    workspaceId?: string;
    type?:        string;
  }): Promise<TaskStats> {
    const cacheKey =
      `stats:${params.userId}:${params.workspaceId ?? 'personal'}:${params.type ?? 'all'}`;

    // 1. Cache fast path
    const cached = await CacheClient.get<TaskStats>(cacheKey);
    if (cached) return cached;

    console.log('📊 Getting stats for:', {
      userId:      params.userId,
      workspaceId: params.workspaceId || 'none',
      type:        params.type        || 'all',
    });

    // 2. Build base filter once — reused by all counts below
    const baseWhere = !params.workspaceId
      ? TaskFilters.buildPersonalTasksFilter({
          userId: params.userId,
          type:   params.type,
        })
      : await TaskFilters.buildWorkspaceTasksFilter({
          userId:      params.userId,
          workspaceId: params.workspaceId,
          type:        params.type,
        });

    // Shared active scope — excludes terminal statuses
    const activeWhere = {
      ...baseWhere,
      status: { notIn: ['COMPLETED', 'CANCELLED'] as TaskStatus[] },
    };

    const now = new Date();

    // 3. All DB work in one round-trip batch
    const [
      totalTasks,
      inProgress,
      completed,
      overdueCount,
      dueTodayCount,
      statusCounts,
      personalCount,
      assignedCount,
      createdCount,
    ] = await Promise.all([
      // Total matching the base scope
      prisma.task.count({ where: baseWhere }),

      // In-progress subset
      prisma.task.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),

      // Completed subset
      prisma.task.count({ where: { ...baseWhere, status: 'COMPLETED' } }),

      // Overdue — three-branch logic pushed into DB, zero rows in memory
      countOverdueTasks(baseWhere, now),

      // Due today — midnight-to-midnight window
      prisma.task.count({
        where: {
          ...activeWhere,
          dueDate: {
            gte: new Date(new Date(now).setHours(0, 0, 0, 0)),
            lt:  new Date(new Date(now).setHours(23, 59, 59, 999)),
          },
        },
      }),

      // Status breakdown for byStatus map
      prisma.task.groupBy({
        by:     ['status'],
        where:  baseWhere,
        _count: true,
      }),

      // Personal task count (no project, created by user)
      prisma.task.count({
        where: { projectId: null, createdById: params.userId },
      }),

      // Assigned to this user (workspace-scoped when applicable)
      prisma.task.count({
        where: {
          assignees: { some: { userId: params.userId } },
          ...(params.workspaceId && {
            project: { workspaceId: params.workspaceId },
          }),
        },
      }),

      // Created by this user (workspace-scoped when applicable)
      prisma.task.count({
        where: {
          createdById: params.userId,
          ...(params.workspaceId && {
            project: { workspaceId: params.workspaceId },
          }),
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
      byStatus:   statusCounts.reduce(
        (acc, item) => { acc[item.status] = item._count; return acc; },
        {} as Record<string, number>,
      ),
    };

    console.log('📊 Stats result:', stats);

    // 4. Cache — 2 min TTL. Bust via CacheClient.deletePattern(`stats:${userId}:*`)
    //    in createTask / updateTask / updateTaskStatus / deleteTask mutations.
    await CacheClient.set(cacheKey, stats, 120);

    return stats;
  },

  // ── By intent ─────────────────────────────────────────────────────────────

  async getTasksByIntent(params: {
    userId:       string;
    intent:       TaskIntent;
    workspaceId?: string;
  }) {
    const where: Record<string, unknown> = {
      intent: params.intent,
      OR: [
        { createdById: params.userId },
        { assignees: { some: { userId: params.userId } } },
      ],
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    };

    if (params.workspaceId) {
      where.project = { workspaceId: params.workspaceId };
    }

    return prisma.task.findMany({
      where,
      include: {
        assignees: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        },
        labels:  { include: { label: true } },
        project: { select: { id: true, name: true, color: true } },
      },
      orderBy: [
        { priority: 'desc' },
        { dueDate:  'asc'  },
      ],
    });
  },
};