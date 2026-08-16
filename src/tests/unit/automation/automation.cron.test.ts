/**
 * src/tests/unit/automation/automation.cron.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    automationRule: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../../modules/automation/automation.events.js', () => ({
  emitAutomationEvent: vi.fn(),
}));

import cron from 'node-cron';
import { prisma } from '../../../lib/prisma.js';
import { CacheClient } from '../../../lib/redis/cache.client.js';
import { emitAutomationEvent } from '../../../modules/automation/automation.events.js';
import {
  initAutomationCrons,
  runDueDateApproachingScan,
} from '../../../modules/automation/automation.cron.js';

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    workspaceId: 'ws1',
    projectId: null,
    createdById: 'creator',
    triggerConfig: { daysBefore: 3 },
    ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    projectId: 'p1',
    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('initAutomationCrons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedules the due-date scan four times a day', () => {
    initAutomationCrons();
    expect(cron.schedule).toHaveBeenCalledWith(
      '15 */6 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: expect.any(String) }),
    );
  });

  it('does not throw when the scan fails', async () => {
    vi.mocked(prisma.automationRule.findMany).mockRejectedValue(new Error('DB error'));

    initAutomationCrons();
    const callback = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;

    await expect(callback()).resolves.not.toThrow();
  });
});

describe('runDueDateApproachingScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CacheClient.get).mockResolvedValue(null);
    vi.mocked(CacheClient.set).mockResolvedValue(undefined);
  });

  it('does nothing when no DUE_DATE_APPROACHING rules exist', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([] as any);

    const emitted = await runDueDateApproachingScan();

    expect(emitted).toBe(0);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it('emits a targeted event for each task inside the due-date window', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([rule()] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as any);

    const emitted = await runDueDateApproachingScan();

    expect(emitted).toBe(1);
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws1',
          dueDate: { gte: expect.any(Date), lte: expect.any(Date) },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        }),
      }),
    );
    expect(emitAutomationEvent).toHaveBeenCalledWith({
      trigger: 'DUE_DATE_APPROACHING',
      taskId: 't1',
      actorId: 'creator',
      workspaceId: 'ws1',
      projectId: 'p1',
      dueDate: expect.any(String),
      ruleId: 'r1',
    });
    expect(CacheClient.set).toHaveBeenCalledWith(
      expect.stringContaining('automation:due:r1:t1:'),
      true,
      expect.any(Number),
    );
  });

  it('filters tasks by the rule project when scoped', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ projectId: 'proj-a' }),
    ] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as any);

    await runDueDateApproachingScan();

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'proj-a' }),
      }),
    );
  });

  it('skips tasks already fired for this rule + due date', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([rule()] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as any);
    vi.mocked(CacheClient.get).mockResolvedValue(true);

    const emitted = await runDueDateApproachingScan();

    expect(emitted).toBe(0);
    expect(emitAutomationEvent).not.toHaveBeenCalled();
  });

  it('emits events for multiple rules and tasks', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ id: 'r1' }),
      rule({ id: 'r2' }),
    ] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as any);

    const emitted = await runDueDateApproachingScan();

    expect(emitted).toBe(2);
    expect(emitAutomationEvent).toHaveBeenCalledTimes(2);
  });

  it('uses the default daysBefore when the rule config omits it', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ triggerConfig: {} }),
    ] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as any);

    const emitted = await runDueDateApproachingScan();

    expect(emitted).toBe(1);
    // Window end must be now + 3 days.
    const firstCall = vi.mocked(prisma.task.findMany).mock.calls[0]?.[0];
    const dueDateFilter = (firstCall?.where as { dueDate: { lte: Date } } | undefined)?.dueDate;
    const lte = dueDateFilter?.lte.getTime();
    const now = Date.now();
    expect(lte).toBeDefined();
    expect(lte!).toBeGreaterThan(now + 2 * 24 * 60 * 60 * 1000);
    expect(lte!).toBeLessThanOrEqual(now + 3 * 24 * 60 * 60 * 1000 + 1000);
  });
});
