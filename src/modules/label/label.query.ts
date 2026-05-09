import { prisma }                             from '../../lib/prisma.js';
import type { LabelFilters, PopularLabelsFilters, LabelTasksFilters, PaginatedResult } from './label.types.js';
import { labelListInclude, labelDetailInclude, labelTasksInclude } from './label.selects.js';
import { LabelAccess }                         from './label.access.js';
import { NotFoundError }                       from './label.types.js';
import { normalizePage, buildPaginationMeta }  from './label.utils.js';
import type { Prisma, TaskStatus, Priority }               from '@prisma/client';

// Infer result row types from the select/include shapes
type LabelListRow  = Prisma.LabelGetPayload<{ include: typeof labelListInclude }>;
type LabelTasksRow = Prisma.TaskLabelGetPayload<{ include: typeof labelTasksInclude }>;

export const LabelQuery = {
  // ─── List all labels (paginated) ─────────────────────────────────────────

  async getLabels(
    userId:  string,
    filters: LabelFilters = {},
  ): Promise<PaginatedResult<LabelListRow>> {
    const { page, limit, skip } = normalizePage(filters.page, filters.limit);

    const where: Prisma.LabelWhereInput = filters.workspaceId
      ? { workspaceId: filters.workspaceId }
      : { createdById: userId, workspaceId: null };

    const [total, labels] = await prisma.$transaction([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where,
        include: labelListInclude,
        orderBy: { name: 'asc' },
        skip,
        take:    limit,
      }),
    ]);

    return { data: labels, pagination: buildPaginationMeta(total, { page, limit }) };
  },

  // ─── Single label (metadata only, no tasks) ───────────────────────────────

  async getLabel(labelId: string, userId: string) {
    await LabelAccess.assertLabelAccess(labelId, userId);

    const label = await prisma.label.findUnique({
      where:   { id: labelId },
      include: labelDetailInclude,
    });

    if (!label) throw new NotFoundError('Label not found');

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
      {
        project: {
          workspace: {
            members: { some: { userId, role: 'ADMIN' } },
          },
        },
      },
      {
        project: {
          members: { some: { userId, role: 'MANAGER' } },
        },
      },
    ],
  };

  const where: Prisma.TaskLabelWhereInput = {
    labelId,
    task: taskFilter,
  };

  const [total, tasks] = await prisma.$transaction([
    prisma.taskLabel.count({ where }),
    prisma.taskLabel.findMany({
      where,
      include: labelTasksInclude,
      orderBy: { task: { createdAt: 'desc' } },
      skip,
      take:    limit,
    }),
  ]);

  return { data: tasks, pagination: buildPaginationMeta(total, { page, limit }) };
},

  // ─── Popular labels (paginated) ───────────────────────────────────────────

  async getPopularLabels(
    userId:  string,
    filters: PopularLabelsFilters = {},
  ): Promise<PaginatedResult<LabelListRow>> {
    const { page, limit, skip } = normalizePage(filters.page, filters.limit ?? 10);

    const where: Prisma.LabelWhereInput = filters.workspaceId
      ? { workspaceId: filters.workspaceId }
      : {
          OR: [
            { createdById: userId, workspaceId: null },
            {
              workspace: {
                OR: [
                  { ownerId: userId },
                  { members: { some: { userId } } },
                ],
              },
            },
          ],
        };

    const [total, labels] = await prisma.$transaction([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where,
        include: labelListInclude,
        orderBy: { tasks: { _count: 'desc' } },
        skip,
        take:    limit,
      }),
    ]);

    return { data: labels, pagination: buildPaginationMeta(total, { page, limit }) };
  },
};