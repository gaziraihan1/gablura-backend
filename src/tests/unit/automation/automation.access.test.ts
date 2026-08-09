/**
 * src/tests/unit/automation/automation.access.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationAccess } from '../../../modules/automation/automation.access.js';
import { prisma } from '../../../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
    automationRule: { findUnique: vi.fn() },
  },
}));

describe('AutomationAccess.assertWorkspaceMembership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the workspace owner', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'u1',
      members: [],
    } as any);
    await expect(
      AutomationAccess.assertWorkspaceMembership('u1', 'ws1'),
    ).resolves.toBeUndefined();
  });

  it('allows a workspace member', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'owner',
      members: [{ id: 'm1' }],
    } as any);
    await expect(
      AutomationAccess.assertWorkspaceMembership('u2', 'ws1'),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-member', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'owner',
      members: [],
    } as any);
    await expect(AutomationAccess.assertWorkspaceMembership('u2', 'ws1')).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('rejects a missing workspace', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    await expect(AutomationAccess.assertWorkspaceMembership('u1', 'ws1')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('AutomationAccess.assertManagePermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the workspace owner', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'u1',
      members: [],
    } as any);
    await expect(
      AutomationAccess.assertManagePermission('u1', 'ws1'),
    ).resolves.toBeUndefined();
  });

  it('allows a workspace admin', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'owner',
      members: [{ role: 'ADMIN' }],
    } as any);
    await expect(
      AutomationAccess.assertManagePermission('u2', 'ws1'),
    ).resolves.toBeUndefined();
  });

  it('rejects a plain member', async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'owner',
      members: [{ role: 'MEMBER' }],
    } as any);
    await expect(AutomationAccess.assertManagePermission('u2', 'ws1')).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('AutomationAccess.assertManageRulePermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the rule when the user can manage it', async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue({
      id: 'r1',
      workspaceId: 'ws1',
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'u1',
      members: [],
    } as any);
    const rule = await AutomationAccess.assertManageRulePermission('u1', 'r1');
    expect(rule).toEqual({ id: 'r1', workspaceId: 'ws1' });
  });

  it('throws NotFoundError for a missing rule', async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue(null);
    await expect(AutomationAccess.assertManageRulePermission('u1', 'r1')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('AutomationAccess.assertReadPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a workspace member', async () => {
    vi.mocked(prisma.automationRule.findUnique).mockResolvedValue({
      id: 'r1',
      workspaceId: 'ws1',
    } as any);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      ownerId: 'owner',
      members: [{ id: 'm1' }],
    } as any);
    const rule = await AutomationAccess.assertReadPermission('u2', 'r1');
    expect(rule.workspaceId).toBe('ws1');
  });
});
