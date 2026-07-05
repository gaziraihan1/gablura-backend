import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  personalLimits, 
  workspaceLimits, 
  checkAndConsumePersonalQuota, 
  checkAndConsumeWorkspaceQuota,
  getPersonalQuotaUsage,
  getWorkspaceQuotaUsage
} from '../../../modules/task/task.quota.service.js';
import { getRedisClient } from '../../../redis/redis.client.js';

vi.mock('../../../redis/redis.client.js', () => ({
  getRedisClient: vi.fn(),
}));

describe('Task Quota Service', () => {
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      eval: vi.fn(),
      pipeline: vi.fn().mockReturnThis(),
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(),
      zrem: vi.fn(),
      decr: vi.fn(),
      get: vi.fn(),
    };
    (getRedisClient as any).mockReturnValue(mockRedis);
  });

  describe('personalLimits', () => {
    it('should return PRO limits for PRO plan', () => {
      expect(personalLimits('PRO')).toEqual({ dailyLimit: 500 });
    });
    it('should return FREE limits for FREE plan', () => {
      expect(personalLimits('FREE')).toEqual({ dailyLimit: 100 });
    });
  });

  describe('workspaceLimits', () => {
    it('should return unlimited for ENTERPRISE', () => {
      expect(workspaceLimits('ENTERPRISE', 1)).toEqual({
        dailyWorkspaceTotal: null,
        dailyPerMember: null,
        perMinute: null,
        isUnlimited: true,
      });
    });

    it('should return proportional limits for PRO', () => {
      const limits = workspaceLimits('PRO', 2);
      expect(limits.dailyWorkspaceTotal).toBe(3000);
      expect(limits.dailyPerMember).toBe(1500);
      expect(limits.perMinute).toBe(25);
    });

    it('should return proportional limits for FREE', () => {
      const limits = workspaceLimits('FREE', 10);
      expect(limits.dailyWorkspaceTotal).toBe(300);
      expect(limits.dailyPerMember).toBe(30);
      expect(limits.perMinute).toBe(5);
    });
  });

  describe('checkAndConsumePersonalQuota', () => {
    it('should allow consumption if under limit', async () => {
      mockRedis.eval.mockResolvedValue(50); // current count
      const result = await checkAndConsumePersonalQuota('user-1', 'FREE');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });

    it('should deny consumption if over limit', async () => {
      mockRedis.eval.mockResolvedValue(101); // over FREE limit (100)
      const result = await checkAndConsumePersonalQuota('user-1', 'FREE');
      expect(result.allowed).toBe(false);
      expect(mockRedis.decr).toHaveBeenCalled();
    });
  });

  describe('checkAndConsumeWorkspaceQuota', () => {
    it('should allow unlimited for ENTERPRISE plan', async () => {
      const result = await checkAndConsumeWorkspaceQuota('user-1', 'ws-1', 'ENTERPRISE', 1);
      expect(result.allowed).toBe(true);
      expect(result.isUnlimited).toBe(true);
    });

    it('should deny if rate limit reached', async () => {
      // Mock pipeline for rate limit check
      mockRedis.exec.mockResolvedValue([
        [null, null], // zremrangebyscore
        [null, 26],   // zcard (limit is 25 for PRO)
        [null, null], // zadd
        [null, null], // expire
      ]);
      
      const result = await checkAndConsumeWorkspaceQuota('user-1', 'ws-1', 'PRO', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit reached');
      expect(mockRedis.zrem).toHaveBeenCalled();
    });

    it('should deny if workspace daily total reached', async () => {
      // Pass rate limit
      mockRedis.exec.mockResolvedValue([[null, null], [null, 10], [null, null], [null, null]]);
      // Workspace total limit reached (3000 for PRO)
      mockRedis.eval.mockResolvedValueOnce(3001); // wsKey
      
      const result = await checkAndConsumeWorkspaceQuota('user-1', 'ws-1', 'PRO', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Workspace daily task limit reached');
      expect(mockRedis.decr).toHaveBeenCalled();
    });

    it('should deny if member daily limit reached', async () => {
      // Pass rate limit
      mockRedis.exec.mockResolvedValue([[null, null], [null, 10], [null, null], [null, null]]);
      // Pass workspace total
      mockRedis.eval.mockResolvedValueOnce(100); // wsKey
      // Member limit reached (e.g. 3000 for PRO member)
      mockRedis.eval.mockResolvedValueOnce(3001); // memberKey
      
      const result = await checkAndConsumeWorkspaceQuota('user-1', 'ws-1', 'PRO', 1);
      // console.log(result)
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Your daily task limit reached');
    });

    it('should allow if all checks pass', async () => {
      mockRedis.exec.mockResolvedValue([[null, null], [null, 10], [null, null], [null, null]]);
      mockRedis.eval.mockResolvedValueOnce(100); // wsKey
      mockRedis.eval.mockResolvedValueOnce(10);  // memberKey
      
      const result = await checkAndConsumeWorkspaceQuota('user-1', 'ws-1', 'PRO', 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe('getPersonalQuotaUsage', () => {
    it('should fetch usage from redis', async () => {
      mockRedis.get.mockResolvedValue('42');
      const result = await getPersonalQuotaUsage('user-1', 'FREE');
      expect(result.usedToday).toBe(42);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(58);
    });
  });

  describe('getWorkspaceQuotaUsage', () => {
    it('should fetch workspace and member usage', async () => {
      const allMemberIds = ['u1', 'u2'];
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('workspace')) return Promise.resolve('100');
        if (key.includes('member:ws-1:u1')) return Promise.resolve('10');
        if (key.includes('member:ws-1:u2')) return Promise.resolve('20');
        return Promise.resolve('0');
      });
      
      // Mock pipeline results
      mockRedis.exec.mockResolvedValue([
        [null, '100'], // ws
        [null, '10'],  // u1
        [null, '20'],  // u2
      ]);

      const result = await getWorkspaceQuotaUsage('ws-1', 'u1', 'PRO', 2, allMemberIds);
      expect(result.workspaceUsedToday).toBe(100);
      expect(result.memberUsedToday).toBe(10);
      expect(result.perMemberBreakdown).toHaveLength(2);
      expect(result.perMemberBreakdown[0].usedToday).toBe(10);
    });
  });
});
