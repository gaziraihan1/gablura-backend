import { prisma }                             from '../../lib/prisma.js';
import type { LabelFilters, PopularLabelsFilters, LabelTasksFilters, PaginatedResult } from './label.types.js';
import { labelListInclude, labelDetailInclude, labelTasksInclude } from './label.selects.js';
import { LabelAccess }                         from './label.access.js';
import { NotFoundError }                       from '../../errors/index.js';
import { normalizePage, buildPaginationMeta }  from './label.utils.js';
import type { Prisma, TaskStatus, Priority }   from '@prisma/client';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

type LabelListRow  = Prisma.LabelGetPayload<{ include: typeof labelListInclude }>;
type LabelTasksRow = Prisma.TaskLabelGetPayload<{ include: typeof labelTasksInclude }>;

export const LabelQuery = {
  async getLabels(userId: string, filters: LabelFilters = {}): Promise<PaginatedResult<LabelListRow>> {
    const isDefaultPagination = (!filters.page || filters.page === 1) && (!filters.limit || filters.limit === 50);
    const cacheKey = CACHE_KEYS.labelList(userId, filters.workspaceId ?? null);

    if (isDefaultPagination) {
      const cached = await CacheClient.get<PaginatedResult<LabelListRow>>(cacheKey);
      if (cached) return cached;
    }

    const { page, limit, skip } = normalizePage(filters.page, filters.limit);

    const where: Prisma.LabelWhereInput = filters.workspaceId
      ? { workspaceId: filters.workspaceId }
      : { createdById: userId, workspaceId: null };

    const [total, labels] = await prisma.$transaction([
      prisma.label.count({ where }),
      prisma.label.findMany({ where, include: labelListInclude, orderBy: { name: 'asc' }, skip, take: limit }),
    ]);

    const result = { data: labels, pagination: buildPaginationMeta(total, { page, limit }) };
    if (isDefaultPagination) await CacheClient.set(cacheKey, result, CACHE_TTL.LABEL_LIST);
    return result;
  },

  async getLabel(labelId: string, userId: string) {
    await LabelAccess.assertLabelAccess(labelId, userId);

    const cacheKey = CACHE_KEYS.labelById(labelId);
    const cached   = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const label = await prisma.label.findUnique({ where: { id: labelId }, include: labelDetailInclude });
    if (!label) throw new NotFoundError('Label');

    await CacheClient.set(cacheKey, label, CACHE_TTL.LABEL_LIST);
    return label;
  },

  async getLabelTasks(
    labelId: string,
    userId:  string,
    filters: LabelTasksFilters = {},
  ): Promise<PaginatedResult<LabelTasksRow>> {
    await LabelAccess.assertLabelAccess(labelId, userId);

    const { page, limit, skip } = normalizePage(filters.page, filters.limit);

    const taskFilter: Prisma.TaskWhereInput = {
      ...(filters.status   ? { status:   filters.status   as TaskStatus } : {}),
      ...(filters.priority ? { priority: filters.priority as Priority   } : {}),
      OR: [
        { createdById: userId },
        { assignees:   { some: { userId } } },
        { project: { workspace: { ownerId: userId } } },
        { project: { workspace: { members: { some: { userId, role: 'ADMIN' } } } } },
        { project: { members:   { some: { userId, role: 'MANAGER' } } } },
      ],
    };

    const where: Prisma.TaskLabelWhereInput = { labelId, task: taskFilter };

    const [total, tasks] = await prisma.$transaction([
      prisma.taskLabel.count({ where }),
      prisma.taskLabel.findMany({ where, include: labelTasksInclude, orderBy: { task: { createdAt: 'desc' } }, skip, take: limit }),
    ]);

    return { data: tasks, pagination: buildPaginationMeta(total, { page, limit }) };
  },

  async getPopularLabels(userId: string, filters: PopularLabelsFilters = {}): Promise<PaginatedResult<LabelListRow>> {
    const isDefaultPagination = (!filters.page || filters.page === 1) && (!filters.limit || filters.limit === 10);
    const cacheKey = CACHE_KEYS.popularLabels(userId, filters.workspaceId ?? null);

    if (isDefaultPagination) {
      const cached = await CacheClient.get<PaginatedResult<LabelListRow>>(cacheKey);
      if (cached) return cached;
    }

    const { page, limit, skip } = normalizePage(filters.page, filters.limit ?? 10);

    const where: Prisma.LabelWhereInput = filters.workspaceId
      ? { workspaceId: filters.workspaceId }
      : {
          OR: [
            { createdById: userId, workspaceId: null },
            { workspace: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] } },
          ],
        };

    const [total, labels] = await prisma.$transaction([
      prisma.label.count({ where }),
      prisma.label.findMany({ where, include: labelListInclude, orderBy: { tasks: { _count: 'desc' } }, skip, take: limit }),
    ]);

    const result = { data: labels, pagination: buildPaginationMeta(total, { page, limit }) };
    if (isDefaultPagination) await CacheClient.set(cacheKey, result, CACHE_TTL.LABEL_LIST);
    return result;
  },
};