import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyTaskQuery } from '../../../modules/dailyTask/dailyTask.query.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    dailyTask: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/dailyTask/dailyTask.selects.js', () => ({
  taskFullInclude: { createdBy: true, assignees: true },
  taskStatsSelect: { id: true, status: true, completedAt: true },
}));

describe('DailyTaskQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getDailyTasks', () => {
    it('should return primary and secondary tasks for a date', async () => {
      const today = new Date('2026-07-15T12:00:00Z');
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([
        { id: 'd1', type: 'PRIMARY', task: { id: 't1' } },
        { id: 'd2', type: 'SECONDARY', task: { id: 't2' } },
        { id: 'd3', type: 'SECONDARY', task: { id: 't3' } },
      ] as any);

      const result = await DailyTaskQuery.getDailyTasks({ userId: 'u1', date: today });

      expect(result.primaryTask).not.toBeNull();
      expect(result.primaryTask!.type).toBe('PRIMARY');
      expect(result.secondaryTasks).toHaveLength(2);
    });

    it('should return null primaryTask when no primary task exists', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([
        { id: 'd1', type: 'SECONDARY', task: { id: 't1' } },
      ] as any);

      const result = await DailyTaskQuery.getDailyTasks({
        userId: 'u1',
        date: new Date('2026-07-15T12:00:00Z'),
      });

      expect(result.primaryTask).toBeNull();
      expect(result.secondaryTasks).toHaveLength(1);
    });

    it('should return empty results when no daily tasks exist', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([]);

      const result = await DailyTaskQuery.getDailyTasks({
        userId: 'u1',
        date: new Date('2026-07-15T12:00:00Z'),
      });

      expect(result.primaryTask).toBeNull();
      expect(result.secondaryTasks).toEqual([]);
    });

    it('should query with correct date bounds', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([]);

      const date = new Date('2026-07-15T14:30:00Z');
      await DailyTaskQuery.getDailyTasks({ userId: 'u1', date });

      const call = vi.mocked(prisma.dailyTask.findMany).mock.calls[0][0];
      const where = call?.where as any;
      expect(where.userId).toBe('u1');
      expect(where.date.gte).toBeInstanceOf(Date);
      expect(where.date.lte).toBeInstanceOf(Date);
    });

    it('should sort by type asc then addedAt asc', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([]);

      await DailyTaskQuery.getDailyTasks({
        userId: 'u1',
        date: new Date('2026-07-15T12:00:00Z'),
      });

      const call = vi.mocked(prisma.dailyTask.findMany).mock.calls[0][0];
      expect(call?.orderBy).toEqual([{ type: 'asc' }, { addedAt: 'asc' }]);
    });
  });

  describe('getDailyTaskStats', () => {
    it('should calculate stats correctly', async () => {
      const startDate = new Date('2026-07-01T00:00:00Z');
      const endDate = new Date('2026-07-07T23:59:59Z');

      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([
        { type: 'PRIMARY', task: { status: 'COMPLETED' } },
        { type: 'PRIMARY', task: { status: 'TODO' } },
        { type: 'SECONDARY', task: { status: 'COMPLETED' } },
        { type: 'SECONDARY', task: { status: 'COMPLETED' } },
        { type: 'SECONDARY', task: { status: 'IN_PROGRESS' } },
      ] as any);

      const result = await DailyTaskQuery.getDailyTaskStats({
        userId: 'u1',
        startDate,
        endDate,
      });

      expect(result.totalDays).toBe(7);
      expect(result.primaryTasksSet).toBe(2);
      expect(result.secondaryTasksSet).toBe(3);
      expect(result.primaryTasksCompleted).toBe(1);
      expect(result.secondaryTasksCompleted).toBe(2);
      expect(result.primaryCompletionRate).toBe(50);
      expect(result.secondaryCompletionRate).toBeCloseTo(66.67, 0);
    });

    it('should return 0 completion rates when no tasks', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([]);

      const result = await DailyTaskQuery.getDailyTaskStats({
        userId: 'u1',
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-07-07T23:59:59Z'),
      });

      expect(result.primaryCompletionRate).toBe(0);
      expect(result.secondaryCompletionRate).toBe(0);
      expect(result.primaryTasksSet).toBe(0);
      expect(result.secondaryTasksSet).toBe(0);
    });

    it('should calculate totalDays correctly', async () => {
      vi.mocked(prisma.dailyTask.findMany).mockResolvedValue([]);

      const result = await DailyTaskQuery.getDailyTaskStats({
        userId: 'u1',
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-07-03T23:59:59Z'),
      });

      expect(result.totalDays).toBe(3);
    });
  });
});
