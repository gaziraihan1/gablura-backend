import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyTaskAccess } from '../../../modules/dailyTask/dailyTask.access.js';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    task: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.selects.js', () => ({
  taskWorkspaceInclude: { project: { select: { workspace: { select: { id: true } } } } },
}));

describe('DailyTaskAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findAccessibleTask', () => {
    it('should return task when user has access', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      const result = await DailyTaskAccess.findAccessibleTask('u1', 't1');
      expect(result!.id).toBe('t1');
    });

    it('should return null when user has no access', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);

      const result = await DailyTaskAccess.findAccessibleTask('u1', 't1');
      expect(result).toBeNull();
    });

    it('should pass correct OR conditions for access check', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      await DailyTaskAccess.findAccessibleTask('u1', 't1');

      expect(prisma.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: 't1',
          OR: [
            { createdById: 'u1' },
            { assignees: { some: { userId: 'u1' } } },
            { project: { members: { some: { userId: 'u1' } } } },
            {
              workspace: {
                OR: [
                  { ownerId: 'u1' },
                  { members: { some: { userId: 'u1', role: 'ADMIN' } } },
                ],
              },
            },
          ],
        },
        include: { project: { select: { workspace: { select: { id: true } } } } },
      });
    });
  });

  describe('assertTaskAccess', () => {
    it('should return task when accessible', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      const result = await DailyTaskAccess.assertTaskAccess('u1', 't1');
      expect(result.id).toBe('t1');
    });

    it('should throw NotFoundError when task is not accessible', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);

      await expect(DailyTaskAccess.assertTaskAccess('u1', 't1')).rejects.toThrow(NotFoundError);
    });
  });
});
