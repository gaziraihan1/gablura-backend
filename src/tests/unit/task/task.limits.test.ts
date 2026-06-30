import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getPersonalQuotaInfo, 
  getWorkspaceQuotaInfo 
} from '../../../modules/task/task.limits.js';
import { prisma } from '../../../lib/prisma.js';
import * as QuotaService from '../../../modules/task/task.quota.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/task/task.quota.service.js', () => ({
  getPersonalQuotaUsage: vi.fn(),
  getWorkspaceQuotaUsage: vi.fn(),
  personalLimits: vi.fn(),
  workspaceLimits: vi.fn(),
}));

describe('Task Limits', () => {
  const mockUserId = 'user-1';
  const mockWorkspaceId = 'ws-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPersonalQuotaInfo', () => {
    it('should resolve plan and return quota info', async () => {
      (prisma.workspace.findMany as any).mockResolvedValue([{ plan: 'PRO' }]);
      (QuotaService.personalLimits as any).mockReturnValue({ dailyLimit: 500 });
      (QuotaService.getPersonalQuotaUsage as any).mockResolvedValue({
        limit: 500,
        usedToday: 100,
        remaining: 400,
        resetAt: new Date(),
      });

      const result = await getPersonalQuotaInfo(mockUserId);
      expect(result.plan).toBe('PRO');
      expect(result.dailyLimit).toBe(500);
      expect(result.usedToday).toBe(100);
    });

    it('should resolve to FREE plan if no workspaces owned', async () => {
      (prisma.workspace.findMany as any).mockResolvedValue([]);
      (QuotaService.personalLimits as any).mockReturnValue({ dailyLimit: 100 });
      (QuotaService.getPersonalQuotaUsage as any).mockResolvedValue({
        limit: 100,
        usedToday: 10,
        remaining: 90,
        resetAt: new Date(),
      });

      const result = await getPersonalQuotaInfo(mockUserId);
      expect(result.plan).toBe('FREE');
    });
  });

  describe('getWorkspaceQuotaInfo', () => {
    it('should return workspace quota info for admin', async () => {
      (prisma.workspace.findUnique as any).mockResolvedValue({ plan: 'PRO' });
      (prisma.workspaceMember.findMany as any).mockResolvedValue([
        { userId: 'u1', user: { name: 'U1', email: 'e1', image: 'i1' } },
        { userId: 'u2', user: { name: 'U2', email: 'e2', image: 'i2' } },
      ]);
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ role: 'ADMIN' });
      (QuotaService.workspaceLimits as any).mockReturnValue({
        dailyWorkspaceTotal: 3000,
        dailyPerMember: 1500,
        perMinute: 25,
        isUnlimited: false,
      });
      (QuotaService.getWorkspaceQuotaUsage as any).mockResolvedValue({
        workspaceUsedToday: 500,
        workspaceRemaining: 2500,
        memberUsedToday: 100,
        memberRemaining: 1400,
        isUnlimited: false,
        resetAt: new Date(),
        perMemberBreakdown: [
          { userId: 'u1', usedToday: 100, remaining: 1400 },
          { userId: 'u2', usedToday: 400, remaining: 1100 },
        ],
      });

      const result = await getWorkspaceQuotaInfo(mockWorkspaceId, mockUserId);
      expect(result.plan).toBe('PRO');
      expect(result.members).toHaveLength(2);
      expect(result.members[0].userId).toBe('u1');
      expect(result.members[0].usedToday).toBe(100);
    });

    it('should return limited member info for non-admin', async () => {
      (prisma.workspace.findUnique as any).mockResolvedValue({ plan: 'PRO' });
      (prisma.workspaceMember.findMany as any).mockResolvedValue([
        { userId: 'u1', user: { name: 'U1', email: 'e1', image: 'i1' } },
        { userId: 'u2', user: { name: 'U2', email: 'e2', image: 'i2' } },
      ]);
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ role: 'MEMBER' });
      (QuotaService.workspaceLimits as any).mockReturnValue({
        dailyWorkspaceTotal: 3000,
        dailyPerMember: 1500,
        perMinute: 25,
        isUnlimited: false,
      });
      (QuotaService.getWorkspaceQuotaUsage as any).mockResolvedValue({
        workspaceUsedToday: 500,
        workspaceRemaining: 2500,
        memberUsedToday: 100,
        memberRemaining: 1400,
        isUnlimited: false,
        resetAt: new Date(),
        perMemberBreakdown: [
          { userId: 'u1', usedToday: 100, remaining: 1400 },
        ],
      });

      const result = await getWorkspaceQuotaInfo(mockWorkspaceId, mockUserId);
      expect(result.members).toHaveLength(0); // Not admin, no members breakdown
    });
  });
});
