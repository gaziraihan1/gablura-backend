import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsAccess } from '../../../modules/analytics/analytics.access.js';
import { prisma } from '../../../lib/prisma.js';
import { ForbiddenError, NotFoundError, PlanLimitError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspaceMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
  },
}));

describe('AnalyticsAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertWorkspaceAdminOrOwner', () => {
    it('should allow OWNER role', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'OWNER',
      } as any);

      const result = await AnalyticsAccess.assertWorkspaceAdminOrOwner('u1', 'ws1');
      expect(result.role).toBe('OWNER');
    });

    it('should allow ADMIN role', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'ADMIN',
      } as any);

      const result = await AnalyticsAccess.assertWorkspaceAdminOrOwner('u1', 'ws1');
      expect(result.role).toBe('ADMIN');
    });

    it('should deny MEMBER role', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'MEMBER',
      } as any);

      await expect(
        AnalyticsAccess.assertWorkspaceAdminOrOwner('u1', 'ws1'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('should deny GUEST role', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'GUEST',
      } as any);

      await expect(
        AnalyticsAccess.assertWorkspaceAdminOrOwner('u1', 'ws1'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('should deny non-member', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(
        AnalyticsAccess.assertWorkspaceAdminOrOwner('u1', 'ws1'),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('assertAnalyticsAccess', () => {
    it('should allow admin on paid workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'ADMIN',
      } as any);

      await expect(
        AnalyticsAccess.assertAnalyticsAccess('u1', 'ws1'),
      ).resolves.not.toThrow();
    });

    it('should throw PlanLimitError for FREE workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'FREE',
      } as any);

      await expect(
        AnalyticsAccess.assertAnalyticsAccess('u1', 'ws1'),
      ).rejects.toThrow(PlanLimitError);
    });

    it('should throw NotFoundError for non-existent workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

      await expect(
        AnalyticsAccess.assertAnalyticsAccess('u1', 'ws1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should deny non-admin on paid workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'MEMBER',
      } as any);

      await expect(
        AnalyticsAccess.assertAnalyticsAccess('u1', 'ws1'),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('assertProjectAnalyticsAccess', () => {
    it('should allow workspace admin', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'ADMIN',
      } as any);

      await expect(
        AnalyticsAccess.assertProjectAnalyticsAccess('u1', 'ws1', 'p1'),
      ).resolves.not.toThrow();
    });

    it('should allow project manager when not workspace admin', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'MEMBER',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: 'p1',
      } as any);

      await expect(
        AnalyticsAccess.assertProjectAnalyticsAccess('u1', 'ws1', 'p1'),
      ).resolves.not.toThrow();
    });

    it('should deny non-admin non-manager', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'MEMBER',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      await expect(
        AnalyticsAccess.assertProjectAnalyticsAccess('u1', 'ws1', 'p1'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw PlanLimitError for FREE workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'FREE',
      } as any);

      await expect(
        AnalyticsAccess.assertProjectAnalyticsAccess('u1', 'ws1', 'p1'),
      ).rejects.toThrow(PlanLimitError);
    });
  });

  describe('isWorkspaceAdminOrOwner', () => {
    it('should return true for OWNER', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'OWNER',
      } as any);

      expect(await AnalyticsAccess.isWorkspaceAdminOrOwner('u1', 'ws1')).toBe(true);
    });

    it('should return true for ADMIN', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'ADMIN',
      } as any);

      expect(await AnalyticsAccess.isWorkspaceAdminOrOwner('u1', 'ws1')).toBe(true);
    });

    it('should return false for MEMBER', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: 'MEMBER',
      } as any);

      expect(await AnalyticsAccess.isWorkspaceAdminOrOwner('u1', 'ws1')).toBe(false);
    });

    it('should return false for non-member', async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      expect(await AnalyticsAccess.isWorkspaceAdminOrOwner('u1', 'ws1')).toBe(false);
    });
  });

  describe('assertBusinessOnlyAccess', () => {
    it('should return true for BUSINESS workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'BUSINESS',
      } as any);

      const result = await AnalyticsAccess.assertBusinessOnlyAccess('u1', 'ws1');
      expect(result).toBe(true);
    });

    it('should return false for PRO workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        plan: 'PRO',
      } as any);

      const result = await AnalyticsAccess.assertBusinessOnlyAccess('u1', 'ws1');
      expect(result).toBe(false);
    });

    it('should throw NotFoundError for non-existent workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

      await expect(
        AnalyticsAccess.assertBusinessOnlyAccess('u1', 'ws1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getUserAdminWorkspaces', () => {
    it('should return workspace IDs where user is admin or owner', async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        { workspaceId: 'ws1' },
        { workspaceId: 'ws2' },
      ] as any);

      const result = await AnalyticsAccess.getUserAdminWorkspaces('u1');
      expect(result).toEqual(['ws1', 'ws2']);
    });

    it('should return empty array when user has no admin roles', async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([]);

      const result = await AnalyticsAccess.getUserAdminWorkspaces('u1');
      expect(result).toEqual([]);
    });

    it('should filter out null workspaceIds', async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        { workspaceId: 'ws1' },
        { workspaceId: null },
      ] as any);

      const result = await AnalyticsAccess.getUserAdminWorkspaces('u1');
      expect(result).toEqual(['ws1']);
    });
  });
});
