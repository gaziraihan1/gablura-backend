/**
 * src/tests/unit/automation/automation.mutation.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationMutation } from '../../../modules/automation/automation.mutation.js';
import { prisma } from '../../../lib/prisma.js';
import { AutomationAccess } from '../../../modules/automation/automation.access.js';
import { AutomationActivity } from '../../../modules/automation/automation.activity.js';
import { AutomationCache } from '../../../lib/redis/cache.client.js';
import { ForbiddenError, PlanLimitError } from '../../../errors/index.js';

const mockIncrement = vi.fn();
const mockInvalidateList = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    automationRule: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  AutomationCache: { invalidateList: (...args: unknown[]) => mockInvalidateList(...args) },
  CACHE_KEYS: {},
  CACHE_TTL: {},
  CacheClient: {},
}));

vi.mock('../../../modules/automation/automation.access.js', () => ({
  AutomationAccess: {
    assertManagePermission: vi.fn(),
    getRuleForManager: vi.fn(),
  },
}));

vi.mock('../../../modules/automation/automation.activity.js', () => ({
  AutomationActivity: {
    logCreated: vi.fn(),
    logUpdated: vi.fn(),
    logDeleted: vi.fn(),
    logRun: vi.fn(),
  },
}));

const rule = {
  id: 'r1',
  workspaceId: 'ws1',
  projectId: null,
  name: 'Rule',
  triggerType: 'STATUS_CHANGED',
  triggerConfig: {},
  actions: [],
  enabled: true,
  runCount: 0,
  lastRunAt: null,
  createdById: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AutomationMutation.create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateList.mockResolvedValue(undefined);
  });

  it('creates a rule when under the plan limit', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'PRO' } as any);
    vi.mocked(prisma.automationRule.count).mockResolvedValue(10);
    vi.mocked(prisma.automationRule.create).mockResolvedValue(rule as any);

    const result = await AutomationMutation.create('u1', {
      workspaceId: 'ws1',
      name: 'Rule',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
    });

    expect(AutomationAccess.assertManagePermission).toHaveBeenCalledWith('u1', 'ws1');
    expect(prisma.automationRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'ws1', createdById: 'u1' }),
      }),
    );
    expect(mockInvalidateList).toHaveBeenCalledWith('ws1');
    expect(AutomationActivity.logCreated).toHaveBeenCalled();
    expect(result.id).toBe('r1');
  });

  it('throws PlanLimitError when the enabled rule count meets the limit', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'PRO' } as any);
    vi.mocked(prisma.automationRule.count).mockResolvedValue(50); // PRO limit = 50

    await expect(
      AutomationMutation.create('u1', {
        workspaceId: 'ws1',
        name: 'Rule',
        triggerType: 'STATUS_CHANGED',
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ).rejects.toThrow(PlanLimitError);
    expect(prisma.automationRule.create).not.toHaveBeenCalled();
  });

  it('allows unlimited rules on ENTERPRISE', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'ENTERPRISE' } as any);
    vi.mocked(prisma.automationRule.create).mockResolvedValue(rule as any);

    await AutomationMutation.create('u1', {
      workspaceId: 'ws1',
      name: 'Rule',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'SET_PRIORITY', config: { priority: 'LOW' } }],
    });

    expect(prisma.automationRule.count).not.toHaveBeenCalled();
    expect(prisma.automationRule.create).toHaveBeenCalled();
  });

  it('counts only enabled rules against the limit', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'PRO' } as any);
    vi.mocked(prisma.automationRule.count).mockResolvedValue(0);
    vi.mocked(prisma.automationRule.create).mockResolvedValue(rule as any);

    await AutomationMutation.create('u1', {
      workspaceId: 'ws1',
      name: 'Rule',
      triggerType: 'STATUS_CHANGED',
      actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
    });

    expect(prisma.automationRule.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', enabled: true },
    });
  });

  it('propagates access errors for non-managers', async () => {
    vi.mocked(AutomationAccess.assertManagePermission).mockRejectedValue(
      new ForbiddenError('Forbidden'),
    );

    await expect(
      AutomationMutation.create('u1', {
        workspaceId: 'ws1',
        name: 'Rule',
        triggerType: 'STATUS_CHANGED',
        actions: [{ type: 'SET_PRIORITY', config: { priority: 'HIGH' } }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('AutomationMutation.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateList.mockResolvedValue(undefined);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'PRO' } as any);
    vi.mocked(prisma.automationRule.count).mockResolvedValue(0);
  });

  it('updates fields and invalidates the cache', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue(rule as any);
    const updated = { ...rule, enabled: false, name: 'Renamed' };
    vi.mocked(prisma.automationRule.update).mockResolvedValue(updated as any);

    const result = await AutomationMutation.update('u1', 'r1', { enabled: false, name: 'Renamed' });

    expect(prisma.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ enabled: false, name: 'Renamed' }),
      }),
    );
    expect(mockInvalidateList).toHaveBeenCalledWith('ws1');
    expect(AutomationActivity.logUpdated).toHaveBeenCalled();
    expect(result.name).toBe('Renamed');
  });

  it('does not check the plan limit when the update keeps the rule enabled', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue(rule as any);
    vi.mocked(prisma.automationRule.update).mockResolvedValue({ ...rule, name: 'Renamed' } as any);

    await AutomationMutation.update('u1', 'r1', { name: 'Renamed' });

    expect(prisma.automationRule.count).not.toHaveBeenCalled();
  });

  it('throws PlanLimitError when re-enabling a rule at the plan limit', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue({
      ...rule,
      enabled: false,
    } as any);
    vi.mocked(prisma.automationRule.count).mockResolvedValue(50); // PRO limit = 50

    await expect(
      AutomationMutation.update('u1', 'r1', { enabled: true }),
    ).rejects.toThrow(PlanLimitError);
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('allows re-enabling a rule when under the plan limit', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue({
      ...rule,
      enabled: false,
    } as any);
    vi.mocked(prisma.automationRule.update).mockResolvedValue({ ...rule, enabled: true } as any);

    const result = await AutomationMutation.update('u1', 'r1', { enabled: true });

    expect(prisma.automationRule.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', enabled: true },
    });
    expect(prisma.automationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(result.enabled).toBe(true);
  });

  it('allows re-enabling on ENTERPRISE without checking the count', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue({
      ...rule,
      enabled: false,
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: 'ENTERPRISE' } as any);
    vi.mocked(prisma.automationRule.update).mockResolvedValue({ ...rule, enabled: true } as any);

    await AutomationMutation.update('u1', 'r1', { enabled: true });

    expect(prisma.automationRule.count).not.toHaveBeenCalled();
    expect(prisma.automationRule.update).toHaveBeenCalled();
  });
});

describe('AutomationMutation.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the rule, invalidates cache, and logs the deletion', async () => {
    vi.mocked(AutomationAccess.getRuleForManager).mockResolvedValue(rule as any);
    vi.mocked(prisma.automationRule.delete).mockResolvedValue(rule as any);

    const result = await AutomationMutation.remove('u1', 'r1');

    expect(prisma.automationRule.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(mockInvalidateList).toHaveBeenCalledWith('ws1');
    expect(AutomationActivity.logDeleted).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
