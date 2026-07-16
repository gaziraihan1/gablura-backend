import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubtaskActivity } from '../../../../modules/task/subtask/subtask.activity.js';
import { prisma } from '../../../../lib/prisma.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    activity: { create: vi.fn() },
  },
}));

describe('SubtaskActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseParams = {
    subtaskId: 'st1',
    subtaskTitle: 'Test Subtask',
    parentTaskId: 't1',
    userId: 'u1',
    workspaceId: 'ws1',
    workspaceSlug: 'ws-slug',
  };

  describe('logCreated', () => {
    it('should create activity with CREATED action', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await SubtaskActivity.logCreated(baseParams);

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATED',
          entityType: 'TASK',
          entityId: 'st1',
          taskId: 't1',
          metadata: expect.objectContaining({
            subtaskTitle: 'Test Subtask',
            isSubtask: true,
          }),
        }),
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(SubtaskActivity.logCreated(baseParams)).resolves.not.toThrow();
    });
  });

  describe('logUpdated', () => {
    it('should create activity with UPDATED action', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await SubtaskActivity.logUpdated({
        ...baseParams,
        changes: { title: 'old', title: 'new' },
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATED',
          metadata: expect.objectContaining({
            isSubtask: true,
            changes: { title: 'old', title: 'new' },
          }),
        }),
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(SubtaskActivity.logUpdated({
        ...baseParams,
        changes: {},
      })).resolves.not.toThrow();
    });
  });

  describe('logStatusChanged', () => {
    it('should create activity with STATUS_CHANGED action', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await SubtaskActivity.logStatusChanged({
        ...baseParams,
        oldStatus: 'TODO',
        newStatus: 'IN_PROGRESS',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'STATUS_CHANGED',
          metadata: expect.objectContaining({
            oldStatus: 'TODO',
            newStatus: 'IN_PROGRESS',
            isSubtask: true,
          }),
        }),
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(SubtaskActivity.logStatusChanged({
        ...baseParams,
        oldStatus: 'TODO',
        newStatus: 'COMPLETED',
      })).resolves.not.toThrow();
    });
  });

  describe('logDeleted', () => {
    it('should create activity with DELETED action', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await SubtaskActivity.logDeleted(baseParams);

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELETED',
          metadata: expect.objectContaining({
            isSubtask: true,
            deletedAt: expect.any(String),
          }),
        }),
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(SubtaskActivity.logDeleted(baseParams)).resolves.not.toThrow();
    });
  });
});
