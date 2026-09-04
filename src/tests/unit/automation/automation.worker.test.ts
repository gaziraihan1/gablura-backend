/**
 * src/tests/unit/automation/automation.worker.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processAutomationEvent } from '../../../queue/workers/automation.worker.js';
import { prisma } from '../../../lib/prisma.js';
import { notifyWorkspaceMembers } from '../../../modules/notification/notification.helpers.js';
import { AutomationActivity } from '../../../modules/automation/automation.activity.js';
import type { AutomationEvent } from '../../../modules/automation/automation.types.js';

const mockNotifyWorkspaceMembers = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    task: { findUnique: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
    taskAssignee: { upsert: vi.fn() },
  },
}));

vi.mock('../../../modules/notification/notification.helpers.js', () => ({
  notifyWorkspaceMembers: (...args: unknown[]) => mockNotifyWorkspaceMembers(...args),
}));

vi.mock('../../../modules/automation/automation.activity.js', () => ({
  AutomationActivity: { logRun: vi.fn() },
}));

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    workspaceId: 'ws1',
    projectId: null,
    name: 'Test rule',
    triggerType: 'STATUS_CHANGED',
    triggerConfig: {},
    actions: [],
    enabled: true,
    runCount: 0,
    lastRunAt: null,
    createdById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function event(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    trigger: 'STATUS_CHANGED',
    taskId: 't1',
    actorId: 'actor1',
    workspaceId: 'ws1',
    projectId: 'p1',
    fromStatus: 'TODO',
    toStatus: 'IN_REVIEW',
    ...overrides,
  };
}

describe('processAutomationEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
    } as any);
    vi.mocked(prisma.automationRule.update).mockResolvedValue({} as any);
  });

  it('runs matching STATUS_CHANGED rules and increments runCount', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerConfig: { fromStatus: 'TODO', toStatus: 'IN_REVIEW' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { priority: 'HIGH' },
    });
    expect(prisma.automationRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { runCount: { increment: 1 }, lastRunAt: expect.any(Date) },
    });
    expect(AutomationActivity.logRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', userId: 'actor1' }),
    );
  });

  it('skips rules whose fromStatus does not match the event', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerConfig: { fromStatus: 'COMPLETED', toStatus: 'IN_REVIEW' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(event());

    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('skips rules whose toStatus does not match the event', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerConfig: { toStatus: 'BLOCKED' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(event());

    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('matches rules with an empty trigger config (any status change)', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerConfig: {},
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'URGENT' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
  });

  it('filters TASK_CREATED rules by project when configured', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'TASK_CREATED',
        triggerConfig: { projectId: 'other-project' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
      rule({
        id: 'r2',
        triggerType: 'TASK_CREATED',
        triggerConfig: {},
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(event({ trigger: 'TASK_CREATED' }));

    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
    expect(prisma.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r2' } }),
    );
  });

  it('loads workspace-wide rules alongside project rules', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([] as any);

    await processAutomationEvent(event({ projectId: 'p1' }));

    expect(prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws1',
          enabled: true,
          OR: [{ projectId: 'p1' }, { projectId: null }],
        },
      }),
    );
  });

  it('does nothing when the task no longer exists', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([rule()] as any);
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

    await processAutomationEvent(event());

    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('stops after the run cap when many rules match', async () => {
    const manyRules = Array.from({ length: 25 }, (_, i) =>
      rule({ id: `r${i}`, actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }] }),
    );
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue(manyRules as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    // 25 matching rules, but the burst cap is 20.
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(20);
  });

  it('is loop-safe: actions never re-trigger events (bounded execution)', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        actions: [
          { type: 'ASSIGN_USER', config: { role: 'actor' } },
          { type: 'SET_PRIORITY', config: { priority: 'HIGH' } },
          { type: 'NOTIFY_MEMBERS', config: { message: 'heads up' } },
        ],
      }),
    ] as any);
    vi.mocked(prisma.taskAssignee.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);
    mockNotifyWorkspaceMembers.mockResolvedValue(undefined);

    await processAutomationEvent(event());

    // Each action ran exactly once — no cascading events were generated.
    expect(prisma.taskAssignee.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    expect(mockNotifyWorkspaceMembers).toHaveBeenCalledTimes(1);
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
  });

  it('assigns by explicit userId', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ actions: [{ type: 'ASSIGN_USER', config: { assigneeUserId: 'target-user' } }] }),
    ] as any);
    vi.mocked(prisma.taskAssignee.upsert).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.taskAssignee.upsert).toHaveBeenCalledWith({
      where: { taskId_userId: { taskId: 't1', userId: 'target-user' } },
      create: { taskId: 't1', userId: 'target-user' },
      update: {},
    });
  });

  it('assigns the project owner via role', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ actions: [{ type: 'ASSIGN_USER', config: { role: 'project-owner' } }] }),
    ] as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ createdById: 'owner-id' } as any);
    vi.mocked(prisma.taskAssignee.upsert).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { createdById: true },
    });
    expect(prisma.taskAssignee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'owner-id' }),
      }),
    );
  });

  it('assigns the event actor via role', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ actions: [{ type: 'ASSIGN_USER', config: { role: 'actor' } }] }),
    ] as any);
    vi.mocked(prisma.taskAssignee.upsert).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.taskAssignee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'actor1' }),
      }),
    );
  });

  it('assigns a workspace member by email', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ actions: [{ type: 'ASSIGN_USER', config: { email: 'dev@gablura.dev' } }] }),
    ] as any);
    vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ userId: 'by-email' } as any);
    vi.mocked(prisma.taskAssignee.upsert).mockResolvedValue({} as any);

    await processAutomationEvent(event());

    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws1', user: { email: 'dev@gablura.dev' } },
      }),
    );
    expect(prisma.taskAssignee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'by-email' }),
      }),
    );
  });

  it('notifies workspace members with the rule context', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        createdById: 'creator',
        name: 'Review watcher',
        actions: [{ type: 'NOTIFY_MEMBERS', config: { message: 'Please take a look' } }],
      }),
    ] as any);
    mockNotifyWorkspaceMembers.mockResolvedValue(undefined);

    await processAutomationEvent(event());

    expect(mockNotifyWorkspaceMembers).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      senderId: 'creator',
      type: 'AUTOMATION_TRIGGERED',
      title: 'Automation: Review watcher',
      message: 'Please take a look',
      actionUrl: '/projects/p1/tasks/t1',
    });
  });

  it('runs only the cron-targeted rule for DUE_DATE_APPROACHING events', async () => {
    const dueInTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
      workspaceId: 'ws1',
      dueDate: dueInTwoDays,
      status: 'TODO',
    } as any);
    // Simulate the DB narrowing by id (the where clause below asserts it).
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r-target',
        triggerType: 'DUE_DATE_APPROACHING',
        triggerConfig: { daysBefore: 3 },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(
      event({
        trigger: 'DUE_DATE_APPROACHING',
        ruleId: 'r-target',
        dueDate: dueInTwoDays.toISOString(),
      }),
    );

    // The rules query is narrowed to the targeted rule id...
    expect(prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'r-target' }),
      }),
    );
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
    expect(prisma.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-target' } }),
    );
  });

  it('skips DUE_DATE_APPROACHING rules when the task due date is outside the window', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
      workspaceId: 'ws1',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'TODO',
    } as any);
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'DUE_DATE_APPROACHING',
        triggerConfig: { daysBefore: 3 },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(
      event({
        trigger: 'DUE_DATE_APPROACHING',
        ruleId: 'r1',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('skips DUE_DATE_APPROACHING rules for tasks with no due date or an overdue one', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
      workspaceId: 'ws1',
      dueDate: null,
      status: 'TODO',
    } as any);
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'DUE_DATE_APPROACHING',
        triggerConfig: { daysBefore: 3 },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(
      event({ trigger: 'DUE_DATE_APPROACHING', ruleId: 'r1' }),
    );
    expect(prisma.automationRule.update).not.toHaveBeenCalled();

    // Overdue task — same rule must not fire either.
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      title: 'Task one',
      projectId: 'p1',
      workspaceId: 'ws1',
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: 'TODO',
    } as any);
    await processAutomationEvent(
      event({
        trigger: 'DUE_DATE_APPROACHING',
        ruleId: 'r1',
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('matches ASSIGNEE_CHANGED rules when assignees were added', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'ASSIGNEE_CHANGED',
        triggerConfig: {},
        actions: [{ type: 'NOTIFY_MEMBERS', config: { message: 'assigned' } }],
      }),
    ] as any);
    mockNotifyWorkspaceMembers.mockResolvedValue(undefined);

    await processAutomationEvent(
      event({ trigger: 'ASSIGNEE_CHANGED', addedAssigneeIds: ['user-a', 'user-b'] }),
    );

    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
  });

  it('filters ASSIGNEE_CHANGED rules by the specific user added', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'ASSIGNEE_CHANGED',
        triggerConfig: { assigneeUserId: 'user-b' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(
      event({ trigger: 'ASSIGNEE_CHANGED', addedAssigneeIds: ['user-b'] }),
    );
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.automationRule.update).mockClear();
    await processAutomationEvent(
      event({ trigger: 'ASSIGNEE_CHANGED', addedAssigneeIds: ['user-c'] }),
    );
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('skips ASSIGNEE_CHANGED rules when no assignee was added', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'ASSIGNEE_CHANGED',
        triggerConfig: {},
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(event({ trigger: 'ASSIGNEE_CHANGED' }));
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('matches LABEL_ADDED rules with and without a label filter', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'LABEL_ADDED',
        triggerConfig: { labelId: 'label-1' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'URGENT' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(
      event({ trigger: 'LABEL_ADDED', addedLabelIds: ['label-1'] }),
    );
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.automationRule.update).mockClear();
    await processAutomationEvent(
      event({ trigger: 'LABEL_ADDED', addedLabelIds: ['label-2'] }),
    );
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('skips LABEL_ADDED rules when no label was added', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'LABEL_ADDED',
        triggerConfig: {},
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(event({ trigger: 'LABEL_ADDED' }));
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('matches MENTION rules with and without a user filter', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'MENTION',
        triggerConfig: { mentionedUserId: 'user-3' },
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);

    await processAutomationEvent(
      event({ trigger: 'MENTION', mentionedUserIds: ['user-3'] }),
    );
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.automationRule.update).mockClear();
    await processAutomationEvent(
      event({ trigger: 'MENTION', mentionedUserIds: ['other-user'] }),
    );
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('skips MENTION rules when nobody was mentioned', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({
        id: 'r1',
        triggerType: 'MENTION',
        triggerConfig: {},
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ] as any);

    await processAutomationEvent(event({ trigger: 'MENTION' }));
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('continues with remaining rules when one rule fails', async () => {
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue([
      rule({ id: 'r-fail', actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }] }),
      rule({ id: 'r-ok', actions: [{ type: 'SET_PRIORITY', config: { priority: 'LOW' } }] }),
    ] as any);
    vi.mocked(prisma.task.update)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({} as any);

    await processAutomationEvent(event());

    // The failed rule still gets its runCount attempted once; the second runs fully.
    expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
    expect(prisma.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-ok' } }),
    );
  });
});
