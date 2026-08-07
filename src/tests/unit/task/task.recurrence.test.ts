import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskMutation } from '../../../modules/task/task.mutation.js';
import { TaskAccess } from '../../../modules/task/task.access.js';
import { ProjectAccess } from '../../../modules/project/project.access.js';
import { prisma } from '../../../lib/prisma.js';
import { addInvalidateCacheJob } from '../../../queue/index.js';
import { ForbiddenError, NotFoundError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    task:          { findUnique: vi.fn() },
    taskRecurrence: { upsert: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    $transaction:  vi.fn(),
  },
}));

vi.mock('../../../modules/task/task.access.js', () => ({
  TaskAccess: { checkEditPermission: vi.fn() },
}));

vi.mock('../../../modules/project/project.access.js', () => ({
  ProjectAccess: { assertProjectNotArchived: vi.fn() },
}));

vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn(() => Promise.resolve()),
}));

describe('TaskMutation recurrence methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertRecurrence', () => {
    it('creates a recurrence anchored to a future due date and invalidates caches', async () => {
      const futureDue = new Date(Date.now() + 3 * 86400000);
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: 't1', projectId: null },
      } as any);
      vi.mocked(ProjectAccess.assertProjectNotArchived).mockResolvedValue(undefined as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: 't1', title: 'Standup', workspaceId: 'ws-1', dueDate: futureDue,
      } as any);
      vi.mocked(prisma.taskRecurrence.upsert).mockResolvedValue({
        id: 'rec-1', taskId: 't1', pattern: 'DAILY', interval: 1, days: null, endsAt: null,
      } as any);

      const onUpserted = vi.fn(() => Promise.resolve());
      const result = await TaskMutation.upsertRecurrence(
        't1', 'u1', { pattern: 'DAILY', interval: 1 }, onUpserted,
      );

      expect(prisma.taskRecurrence.upsert).toHaveBeenCalledWith({
        where:  { taskId: 't1' },
        create: expect.objectContaining({
          taskId: 't1', pattern: 'DAILY', interval: 1, lastOccurredAt: futureDue,
        }),
        update: expect.objectContaining({ pattern: 'DAILY', interval: 1 }),
      });
      expect(result.id).toBe('rec-1');
      expect(onUpserted).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.objectContaining({ id: 't1' }) }),
      );
      const jobs = vi.mocked(addInvalidateCacheJob).mock.calls.map((c) => c[0]);
      expect(jobs).toContainEqual(expect.objectContaining({ type: 'task', taskId: 't1', workspaceId: 'ws-1' }));
    });

    it('anchors to now when the task has no future due date', async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: 't1', projectId: null },
      } as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: 't1', title: 'Standup', workspaceId: null, dueDate: null,
      } as any);
      vi.mocked(prisma.taskRecurrence.upsert).mockResolvedValue({ id: 'rec-1' } as any);

      const before = Date.now();
      await TaskMutation.upsertRecurrence('t1', 'u1', { pattern: 'WEEKLY', interval: 1 });

      const createArg = (prisma.taskRecurrence.upsert as any).mock.calls[0][0].create;
      expect(createArg.lastOccurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(createArg.lastOccurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('throws ForbiddenError when the user cannot edit the task', async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: false,
        reason: 'No permission',
      } as any);

      await expect(
        TaskMutation.upsertRecurrence('t1', 'u1', { pattern: 'DAILY' }),
      ).rejects.toThrow(ForbiddenError);
      expect(prisma.taskRecurrence.upsert).not.toHaveBeenCalled();
    });
  });

  describe('deleteRecurrence', () => {
    it('deletes the recurrence and returns success', async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: 't1', projectId: 'proj-1' },
      } as any);
      vi.mocked(ProjectAccess.assertProjectNotArchived).mockResolvedValue(undefined as any);
      vi.mocked(prisma.taskRecurrence.findUnique).mockResolvedValue({ id: 'rec-1', taskId: 't1' } as any);
      vi.mocked(prisma.taskRecurrence.delete).mockResolvedValue({ id: 'rec-1' } as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: 't1', title: 'Standup', workspaceId: 'ws-1',
      } as any);

      const onDeleted = vi.fn(() => Promise.resolve());
      const result = await TaskMutation.deleteRecurrence('t1', 'u1', onDeleted);

      expect(prisma.taskRecurrence.delete).toHaveBeenCalledWith({ where: { taskId: 't1' } });
      expect(result).toEqual({ success: true });
      expect(onDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.objectContaining({ title: 'Standup' }) }),
      );
    });

    it('throws NotFoundError when the task has no recurrence', async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: 't1', projectId: null },
      } as any);
      vi.mocked(prisma.taskRecurrence.findUnique).mockResolvedValue(null);

      await expect(
        TaskMutation.deleteRecurrence('t1', 'u1'),
      ).rejects.toThrow(NotFoundError);
      expect(prisma.taskRecurrence.delete).not.toHaveBeenCalled();
    });
  });
});
