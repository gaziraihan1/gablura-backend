import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    taskRecurrence: { findMany: vi.fn(), update: vi.fn() },
    task:          { createMany: vi.fn(), findFirst: vi.fn() },
    taskLabel:     { createMany: vi.fn() },
    taskAssignee:  { createMany: vi.fn() },
    $transaction:  vi.fn(),
  },
}));

vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn(() => Promise.resolve()),
}));

import cron from 'node-cron';
import { prisma } from '../../../lib/prisma.js';
import { addInvalidateCacheJob } from '../../../queue/index.js';
import { initTaskRecurrenceCrons, computeNextDue } from '../../../modules/task/taskRecurrence.cron.js';

describe('taskRecurrence.cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeNextDue', () => {
    it('DAILY advances by interval days', () => {
      const cursor = new Date(2026, 7, 6); // Aug 6, 2026
      const due = computeNextDue(cursor, 'DAILY', 1);
      expect(due).toEqual(new Date(2026, 7, 7));
      expect(computeNextDue(cursor, 'DAILY', 3)).toEqual(new Date(2026, 7, 9));
    });

    it('WEEKLY advances by interval weeks and snaps to allowed weekdays', () => {
      const cursor = new Date(2026, 7, 6); // Thursday
      // +7d = Thursday Aug 13 (getDay() === 4). Allowed days [1,3] = Mon, Wed.
      const due = computeNextDue(cursor, 'WEEKLY', 1, [1, 3]);
      expect(due.getDay()).toBe(1); // Monday Aug 17
      expect(due).toEqual(new Date(2026, 7, 17));
    });

    it('WEEKLY without days is exactly +interval weeks', () => {
      const cursor = new Date(2026, 7, 6);
      expect(computeNextDue(cursor, 'WEEKLY', 2, [])).toEqual(new Date(2026, 7, 20));
    });

    it('MONTHLY clamps to the last valid day of the target month', () => {
      const cursor = new Date(2026, 0, 31); // Jan 31
      const due = computeNextDue(cursor, 'MONTHLY', 1);
      expect(due).toEqual(new Date(2026, 1, 28)); // Feb 28, 2026
    });

    it('CUSTOM with days behaves like weekly; without days behaves like daily', () => {
      const cursor = new Date(2026, 7, 6); // Thursday
      // +7d = Thursday Aug 13, then snap forward to the next Sunday (day 0) = Aug 16
      expect(computeNextDue(cursor, 'CUSTOM', 1, [0])).toEqual(new Date(2026, 7, 16));
      expect(computeNextDue(cursor, 'CUSTOM', 2, null)).toEqual(new Date(2026, 7, 8));
    });
  });

  describe('scheduler run', () => {
    const baseRecurrence = {
      id: 'rec-1',
      pattern: 'DAILY',
      interval: 1,
      days: null,
      endsAt: null,
      lastOccurredAt: null,
      taskId: 'task-anchor',
      task: {
        title: 'Weekly bug triage',
        description: 'Triage new bugs',
        priority: 'MEDIUM',
        status: 'TODO',
        projectId: 'proj-1',
        sectionId: null,
        sprintId: null,
        milestoneId: null,
        workspaceId: 'ws-1',
        createdById: 'u-1',
        estimatedHours: 1,
        focusRequired: false,
        focusLevel: null,
        energyType: null,
        distractionCost: null,
        intent: 'EXECUTION',
        dueDate: null,
        labels: [{ labelId: 'lab-1' }],
        assignees: [{ userId: 'u-2' }],
      },
    };

    const tx = () => ({
      task: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst:  vi.fn().mockResolvedValue({ id: 'new-task-1' }),
      },
      taskLabel:    { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      taskAssignee: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      taskRecurrence: { update: vi.fn().mockResolvedValue({}) },
    });

    it('schedules the cron at 0 1 * * *', () => {
      initTaskRecurrenceCrons();
      expect(cron.schedule).toHaveBeenCalledWith('0 1 * * *', expect.any(Function));
    });

    it('generates a due instance with recurrenceId + recurrenceDueDate and advances lastOccurredAt', async () => {
      // lastOccurredAt two days ago → nextDue yesterday → due
      const rec = {
        ...baseRecurrence,
        lastOccurredAt: new Date(Date.now() - 2 * 86400000),
      };
      vi.mocked(prisma.taskRecurrence.findMany)
        .mockResolvedValueOnce([rec] as any)
        .mockResolvedValueOnce([] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx()));

      initTaskRecurrenceCrons();
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
      await callback();

      const txInstance = (prisma.$transaction as any).mock.calls[0][0];
      // Re-run the transaction function against a fresh tx to inspect calls
      const mockTx = tx();
      await txInstance(mockTx);

      expect(mockTx.task.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              recurrenceId: 'rec-1',
              status: 'TODO',
              title: 'Weekly bug triage',
            }),
          ],
          skipDuplicates: true,
        }),
      );
      expect(mockTx.taskRecurrence.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data:  { lastOccurredAt: expect.any(Date) },
      });
    });

    it('skips recurrences whose next due is in the future', async () => {
      const rec = {
        ...baseRecurrence,
        pattern: 'WEEKLY',
        lastOccurredAt: new Date(Date.now() - 86400000),
      };
      vi.mocked(prisma.taskRecurrence.findMany)
        .mockResolvedValueOnce([rec] as any)
        .mockResolvedValueOnce([] as any);

      initTaskRecurrenceCrons();
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
      await callback();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent: a duplicate insert (count 0) still advances state and skips label attach', async () => {
      const rec = {
        ...baseRecurrence,
        lastOccurredAt: new Date(Date.now() - 2 * 86400000),
      };
      vi.mocked(prisma.taskRecurrence.findMany)
        .mockResolvedValueOnce([rec] as any)
        .mockResolvedValueOnce([] as any);
      const mockTx = tx();
      mockTx.task.createMany.mockResolvedValue({ count: 0 });
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(mockTx));

      initTaskRecurrenceCrons();
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
      await callback();

      expect(mockTx.task.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(mockTx.taskLabel.createMany).not.toHaveBeenCalled();
      expect(mockTx.taskRecurrence.update).toHaveBeenCalled();
    });

    it('invalidates workspace and personal caches for generated instances', async () => {
      vi.mocked(prisma.taskRecurrence.findMany)
        .mockResolvedValueOnce([
          { ...baseRecurrence, lastOccurredAt: new Date(Date.now() - 2 * 86400000) },
          {
            ...baseRecurrence,
            id: 'rec-2',
            task: { ...baseRecurrence.task, workspaceId: null, createdById: 'u-9' },
            lastOccurredAt: new Date(Date.now() - 2 * 86400000),
          },
        ] as any)
        .mockResolvedValueOnce([] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx()));

      initTaskRecurrenceCrons();
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
      await callback();

      const jobs = vi.mocked(addInvalidateCacheJob).mock.calls.map((c) => c[0]);
      expect(jobs).toContainEqual(expect.objectContaining({ type: 'analytics', workspaceId: 'ws-1' }));
      expect(jobs).toContainEqual(expect.objectContaining({ type: 'task', workspaceId: 'ws-1' }));
      expect(jobs).toContainEqual(expect.objectContaining({ type: 'task', userId: 'u-9' }));
    });

    it('queries only recurrences that have not ended', async () => {
      vi.mocked(prisma.taskRecurrence.findMany).mockResolvedValueOnce([] as any);

      initTaskRecurrenceCrons();
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
      await callback();

      expect(prisma.taskRecurrence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }] },
        }),
      );
    });
  });
});
