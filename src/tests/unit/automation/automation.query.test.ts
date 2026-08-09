/**
 * src/tests/unit/automation/automation.query.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationQuery } from '../../../modules/automation/automation.query.js';
import { prisma } from '../../../lib/prisma.js';
import { AutomationAccess } from '../../../modules/automation/automation.access.js';
import { CacheClient } from '../../../lib/redis/cache.client.js';
import { NotFoundError } from '../../../errors/index.js';

const mockGetOrSet = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    automationRule: { findMany: vi.fn(), findUnique: vi.fn() },
    activity: { findMany: vi.fn() },
  },
}));

vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: { getOrSet: (...args: unknown[]) => mockGetOrSet(...args) },
  CACHE_KEYS: {
    automationList: (workspaceId: string, projectId?: string) =>
      `automation:list:${workspaceId}:${projectId ?? 'all'}`,
  },
  CACHE_TTL: { AUTOMATION_LIST: 300 },
}));

vi.mock('../../../modules/automation/automation.access.js', () => ({
  AutomationAccess: {
    assertWorkspaceMembership: vi.fn(),
    assertReadPermission: vi.fn(),
  },
}));

const rules = [
  { id: 'r1', workspaceId: 'ws1', name: 'Rule one', enabled: true },
  { id: 'r2', workspaceId: 'ws1', name: 'Rule two', enabled: false },
];

describe('AutomationQuery.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrSet.mockImplementation(async (_key: string, fetcher: () => unknown) => fetcher());
    vi.mocked(prisma.automationRule.findMany).mockResolvedValue(rules as any);
  });

  it('checks workspace membership first', async () => {
    await AutomationQuery.list('u1', 'ws1');
    expect(AutomationAccess.assertWorkspaceMembership).toHaveBeenCalledWith('u1', 'ws1');
  });

  it('returns all rules when no project filter is given', async () => {
    const result = await AutomationQuery.list('u1', 'ws1');
    expect(result).toEqual(rules);
    expect(prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws1' },
        orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
      }),
    );
  });

  it('includes workspace-wide rules when filtering by project', async () => {
    await AutomationQuery.list('u1', 'ws1', 'proj1');
    expect(prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws1',
          OR: [{ projectId: 'proj1' }, { projectId: null }],
        },
      }),
    );
  });

  it('caches the list under the workspace-scoped key', async () => {
    await AutomationQuery.list('u1', 'ws1');
    expect(mockGetOrSet).toHaveBeenCalledWith(
      'automation:list:ws1:all',
      expect.any(Function),
      300,
    );
  });
});

describe('AutomationQuery.getById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundError when the rule does not exist', async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(null);
    await expect(AutomationQuery.getById('u1', 'r1')).rejects.toThrow(NotFoundError);
  });

  it('checks membership for an existing rule', async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue({
      id: 'r1',
      workspaceId: 'ws1',
    } as any);
    await AutomationQuery.getById('u1', 'r1');
    expect(AutomationAccess.assertWorkspaceMembership).toHaveBeenCalledWith('u1', 'ws1');
  });
});

describe('AutomationQuery.getRunHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checks read permission then queries activity entries', async () => {
    const runs = [
      { id: 'a1', action: 'AUTOMATION_RUN', metadata: { ruleName: 'R' }, createdAt: new Date() },
    ];
    vi.mocked(prisma.activity.findMany).mockResolvedValue(runs as any);

    const result = await AutomationQuery.getRunHistory('u1', 'r1');

    expect(AutomationAccess.assertReadPermission).toHaveBeenCalledWith('u1', 'r1');
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: 'AUTOMATION', entityId: 'r1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    expect(result).toEqual(runs);
  });
});
