import { prisma }                       from '../../lib/prisma.js';
import type { CreateTimeEntryDto, UpdateTimeEntryDto } from './timeEntry.types.js';
import { NotFoundError }                from '../../errors/index.js';
import { TimeEntryAccess }              from './timeEntry.access.js';
import { CacheClient }                  from '../../lib/redis/cache.client.js';

const timeEntryInclude = {
  user: { select: { id: true, name: true, email: true, image: true } },
} as const;

/**
 * Time entries feed the workspace/project analytics time summaries, which
 * are cached per workspace (and per project) across day windows. Wipe the
 * whole workspace pattern so every window refreshes.
 */
async function invalidateTimeSummaries(workspaceId: string | null, projectId: string | null) {
  // Personal tasks have no workspace — nothing cached to invalidate.
  if (!workspaceId) return;

  const jobs = [
    CacheClient.deletePattern(`analytics:time-summary:${workspaceId}:*`),
    CacheClient.deletePattern(`analytics:project:time-summary:${workspaceId}:*`),
  ];
  if (projectId) {
    jobs.push(
      CacheClient.deletePattern(`analytics:project:time-summary:${workspaceId}:${projectId}:*`),
    );
  }
  await Promise.all(jobs);
}

export const TimeEntryMutation = {
  async createEntry(data: CreateTimeEntryDto) {
    const task = await TimeEntryAccess.assertTaskAccess(data.taskId, data.userId);

    const entry = await prisma.timeEntry.create({
      data: {
        taskId:      data.taskId,
        userId:      data.userId,
        duration:    data.duration,
        category:    data.category ?? 'OTHER',
        billable:    data.billable ?? false,
        description: data.description ?? null,
        startedAt:   data.startedAt ?? new Date(),
        endedAt:     data.endedAt ?? null,
      },
      include: timeEntryInclude,
    });

    await invalidateTimeSummaries(task.workspaceId, null);
    return entry;
  },

  async updateEntry(entryId: string, userId: string, data: UpdateTimeEntryDto) {
    const existing = await TimeEntryAccess.assertEntryOwnership(entryId, userId);

    const task = await prisma.task.findUnique({
      where:  { id: existing.taskId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');

    const entry = await prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.billable !== undefined ? { billable: data.billable } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
        ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
      },
      include: timeEntryInclude,
    });

    await invalidateTimeSummaries(task.workspaceId, task.projectId);
    return entry;
  },

  async deleteEntry(entryId: string, userId: string) {
    const existing = await TimeEntryAccess.assertEntryOwnership(entryId, userId);

    const task = await prisma.task.findUnique({
      where:  { id: existing.taskId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');

    await prisma.timeEntry.delete({ where: { id: entryId } });
    await invalidateTimeSummaries(task.workspaceId, task.projectId);
  },
};
