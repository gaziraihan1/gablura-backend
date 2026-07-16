import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyTaskActivity } from '../../../modules/dailyTask/dailyTask.activity.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    activity: { create: vi.fn() },
  },
}));

describe('DailyTaskActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('logAdded', () => {
    it('should create an activity record for adding a daily task', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await DailyTaskActivity.logAdded({
        userId: 'u1',
        taskId: 't1',
        taskTitle: 'Test Task',
        workspaceId: 'ws1',
        type: 'PRIMARY',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          action: 'UPDATED',
          entityType: 'TASK',
          entityId: 't1',
          userId: 'u1',
          workspaceId: 'ws1',
          workspaceSlug: '',
          taskId: 't1',
          metadata: {
            taskTitle: 'Test Task',
            dailyTaskType: 'PRIMARY',
            action: 'added_to_daily_tasks',
          },
        },
      });
    });

    it('should not throw when prisma fails (fire-and-forget)', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(
        DailyTaskActivity.logAdded({
          userId: 'u1',
          taskId: 't1',
          taskTitle: 'Task',
          workspaceId: 'ws1',
          type: 'SECONDARY',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logRemoved', () => {
    it('should create an activity record for removing a daily task', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await DailyTaskActivity.logRemoved({
        userId: 'u1',
        taskId: 't1',
        taskTitle: 'Test Task',
        workspaceId: 'ws1',
        type: 'SECONDARY',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          action: 'UPDATED',
          entityType: 'TASK',
          entityId: 't1',
          userId: 'u1',
          workspaceId: 'ws1',
          workspaceSlug: '',
          taskId: 't1',
          metadata: {
            taskTitle: 'Test Task',
            dailyTaskType: 'SECONDARY',
            action: 'removed_from_daily_tasks',
          },
        },
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(
        DailyTaskActivity.logRemoved({
          userId: 'u1',
          taskId: 't1',
          taskTitle: 'Task',
          workspaceId: 'ws1',
          type: 'PRIMARY',
        }),
      ).resolves.not.toThrow();
    });
  });
});
