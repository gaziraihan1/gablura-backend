import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyTaskMutation } from '../../../modules/dailyTask/dailyTask.mutation.js';
import { prisma } from '../../../lib/prisma.js';
import { DailyTaskAccess } from '../../../modules/dailyTask/dailyTask.access.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    dailyTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.access.js', () => ({
  DailyTaskAccess: {
    assertTaskAccess: vi.fn(),
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.activity.js', () => ({
  DailyTaskActivity: {
    logAdded: vi.fn(),
    logRemoved: vi.fn(),
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.selects.js', () => ({
  taskFullInclude: { createdBy: true, assignees: true },
}));

describe('DailyTaskMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('addDailyTask', () => {
    const mockTask = {
      id: 't1',
      title: 'Test Task',
      status: 'TODO',
      project: { workspace: { id: 'ws1' } },
    };

    it('should create a new daily task', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue(mockTask as any);
      vi.mocked(prisma.dailyTask.findFirst)
        .mockResolvedValueOnce(null) // primary check
        .mockResolvedValueOnce(null); // duplicate check
      vi.mocked(prisma.dailyTask.create).mockResolvedValue({
        id: 'd1',
        type: 'PRIMARY',
        task: mockTask,
      } as any);

      const result = await DailyTaskMutation.addDailyTask({
        userId: 'u1',
        taskId: 't1',
        type: 'PRIMARY',
      });

      expect(result.id).toBe('d1');
      expect(prisma.dailyTask.create).toHaveBeenCalled();
    });

    it('should throw BadRequestError for completed task', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
      } as any);

      await expect(
        DailyTaskMutation.addDailyTask({ userId: 'u1', taskId: 't1', type: 'PRIMARY' }),
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ConflictError when primary task already exists', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue(mockTask as any);
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue({
        id: 'existing',
        type: 'PRIMARY',
      } as any);

      await expect(
        DailyTaskMutation.addDailyTask({ userId: 'u1', taskId: 't1', type: 'PRIMARY' }),
      ).rejects.toThrow(ConflictError);
    });

    it('should return existing daily task when duplicate with same type', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue(mockTask as any);
      // For SECONDARY type: no primary check, only duplicate check
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue({
        id: 'existing',
        type: 'SECONDARY',
      } as any);

      const result = await DailyTaskMutation.addDailyTask({
        userId: 'u1',
        taskId: 't1',
        type: 'SECONDARY',
      });

      expect(result.id).toBe('existing');
      expect(prisma.dailyTask.update).not.toHaveBeenCalled();
      expect(prisma.dailyTask.create).not.toHaveBeenCalled();
    });

    it('should update type when duplicate with different type', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue(mockTask as any);
      // For PRIMARY type: first call is primary check (returns null), second is duplicate check
      vi.mocked(prisma.dailyTask.findFirst)
        .mockResolvedValueOnce(null) // primary check - no existing PRIMARY
        .mockResolvedValueOnce({ id: 'existing', type: 'SECONDARY' } as any); // duplicate check
      vi.mocked(prisma.dailyTask.update).mockResolvedValue({
        id: 'existing',
        type: 'PRIMARY',
      } as any);

      const result = await DailyTaskMutation.addDailyTask({
        userId: 'u1',
        taskId: 't1',
        type: 'PRIMARY',
      });

      expect(result.type).toBe('PRIMARY');
      expect(prisma.dailyTask.update).toHaveBeenCalled();
    });

    it('should skip primary check for SECONDARY type', async () => {
      vi.mocked(DailyTaskAccess.assertTaskAccess).mockResolvedValue(mockTask as any);
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.dailyTask.create).mockResolvedValue({
        id: 'd1',
        type: 'SECONDARY',
      } as any);

      await DailyTaskMutation.addDailyTask({
        userId: 'u1',
        taskId: 't1',
        type: 'SECONDARY',
      });

      // Only the duplicate check should be called, not the primary check
      expect(prisma.dailyTask.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeDailyTask', () => {
    it('should remove a daily task', async () => {
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue({
        id: 'd1',
        type: 'PRIMARY',
        task: {
          title: 'Task',
          project: { workspace: { id: 'ws1' } },
        },
      } as any);
      vi.mocked(prisma.dailyTask.delete).mockResolvedValue({} as any);

      await DailyTaskMutation.removeDailyTask({ userId: 'u1', taskId: 't1' });

      expect(prisma.dailyTask.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    });

    it('should throw NotFoundError when daily task does not exist', async () => {
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue(null);

      await expect(
        DailyTaskMutation.removeDailyTask({ userId: 'u1', taskId: 't1' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should query with correct date bounds', async () => {
      vi.mocked(prisma.dailyTask.findFirst).mockResolvedValue({
        id: 'd1',
        type: 'PRIMARY',
        task: { title: 'Task', project: { workspace: { id: 'ws1' } } },
      } as any);
      vi.mocked(prisma.dailyTask.delete).mockResolvedValue({} as any);

      await DailyTaskMutation.removeDailyTask({ userId: 'u1', taskId: 't1' });

      const call = vi.mocked(prisma.dailyTask.findFirst).mock.calls[0][0];
      const where = call?.where as any;
      expect(where.userId).toBe('u1');
      expect(where.taskId).toBe('t1');
    });
  });

  describe('clearExpiredDailyTasks', () => {
    it('should delete expired daily tasks and return count', async () => {
      vi.mocked(prisma.dailyTask.deleteMany).mockResolvedValue({ count: 5 });

      const result = await DailyTaskMutation.clearExpiredDailyTasks();

      expect(result.deletedCount).toBe(5);
      expect(prisma.dailyTask.deleteMany).toHaveBeenCalled();
    });

    it('should return 0 when no expired tasks', async () => {
      vi.mocked(prisma.dailyTask.deleteMany).mockResolvedValue({ count: 0 });

      const result = await DailyTaskMutation.clearExpiredDailyTasks();

      expect(result.deletedCount).toBe(0);
    });

    it('should delete tasks where date is before today', async () => {
      vi.mocked(prisma.dailyTask.deleteMany).mockResolvedValue({ count: 1 });

      await DailyTaskMutation.clearExpiredDailyTasks();

      const call = vi.mocked(prisma.dailyTask.deleteMany).mock.calls[0][0];
      expect((call?.where as any).date.lt).toBeInstanceOf(Date);
    });
  });
});
