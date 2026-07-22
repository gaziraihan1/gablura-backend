import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsQuery } from '../../../modules/analytics/analytics.query.js';
import { prisma } from '../../../lib/prisma.js';
import { AnalyticsAccess } from '../../../modules/analytics/analytics.access.js';
import { CacheClient } from '../../../lib/redis/cache.client.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    project: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    task: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    taskAssignee: {
      groupBy: vi.fn(),
    },
    workspaceMember: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    activity: {
      groupBy: vi.fn(),
    },
    timeEntry: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    file: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    comment: {
      groupBy: vi.fn(),
    },
    projectMember: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/analytics/analytics.access.js', () => ({
  AnalyticsAccess: {
    assertWorkspaceAdminOrOwner: vi.fn(),
    assertProjectAnalyticsAccess: vi.fn(),
  },
}));

vi.mock('../../../lib/redis/cache.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/redis/cache.client.js')>();
  return {
    ...actual,
    CacheClient: {
      ...actual.CacheClient,
      get: vi.fn(),
      set: vi.fn(),
    },
  };
});

describe('AnalyticsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getExecutiveKPIs', () => {
    it('should return cached KPIs if available', async () => {
      const cachedKPIs = { totalTasks: 10, completedTasks: 5 };
      vi.mocked(CacheClient.get).mockResolvedValue(cachedKPIs);

      const result = await AnalyticsQuery.getExecutiveKPIs('ws1', 'u1');

      expect(result).toEqual(cachedKPIs);
      expect(AnalyticsAccess.assertWorkspaceAdminOrOwner).toHaveBeenCalledWith('u1', 'ws1');
    });

    it('should calculate KPIs on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.count).mockResolvedValue(5);
      vi.mocked(prisma.task.count).mockResolvedValue(20);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(3);
      vi.mocked(prisma.activity.groupBy).mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }] as any);
      vi.mocked(prisma.timeEntry.aggregate).mockResolvedValue({ _sum: { duration: 300 } } as any);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({ _sum: { size: 1048576 } } as any);

      const result = await AnalyticsQuery.getExecutiveKPIs('ws1', 'u1');

      expect(result.totalTasks).toBe(20);
      expect(result.totalMembers).toBe(3);
      expect(result.activeMembers).toBe(2);
      expect(result.totalHours).toBe(5);
      expect(result.storageUsed).toBe(1);
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it('should calculate completion rate correctly', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.count).mockResolvedValue(0);
      vi.mocked(prisma.task.count)
        .mockResolvedValueOnce(10)  // totalTasks
        .mockResolvedValueOnce(7);  // completedTasks
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(0);
      vi.mocked(prisma.activity.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.timeEntry.aggregate).mockResolvedValue({ _sum: { duration: 0 } } as any);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({ _sum: { size: 0 } } as any);

      const result = await AnalyticsQuery.getExecutiveKPIs('ws1', 'u1');

      expect(result.completionRate).toBe(70);
    });

    it('should return 0 completion rate when no tasks', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.count).mockResolvedValue(0);
      vi.mocked(prisma.task.count).mockResolvedValue(0);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(0);
      vi.mocked(prisma.activity.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.timeEntry.aggregate).mockResolvedValue({ _sum: { duration: 0 } } as any);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({ _sum: { size: 0 } } as any);

      const result = await AnalyticsQuery.getExecutiveKPIs('ws1', 'u1');

      expect(result.completionRate).toBe(0);
    });
  });

  describe('getTaskStatusDistribution', () => {
    it('should return cached distribution if available', async () => {
      const cached = [{ status: 'TODO', count: 5, percentage: 50 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getTaskStatusDistribution('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate distribution on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.groupBy).mockResolvedValue([
        { status: 'TODO', _count: { status: 6 } },
        { status: 'COMPLETED', _count: { status: 4 } },
      ] as any);

      const result = await AnalyticsQuery.getTaskStatusDistribution('ws1', 'u1');

      expect(result).toHaveLength(2);
      expect(result[0].percentage).toBe(60);
      expect(result[1].percentage).toBe(40);
    });

    it('should handle empty distribution', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.groupBy).mockResolvedValue([]);

      const result = await AnalyticsQuery.getTaskStatusDistribution('ws1', 'u1');

      expect(result).toEqual([]);
    });
  });

  describe('getTaskCompletionTrend', () => {
    it('should return cached trend if available', async () => {
      const cached = [{ date: new Date(), count: 5 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getTaskCompletionTrend('ws1', 'u1', 7);

      expect(result).toEqual(cached);
    });

    it('should build dense daily array on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await AnalyticsQuery.getTaskCompletionTrend('ws1', 'u1', 7);

      expect(result).toHaveLength(7);
      expect(result.every((p) => p.count === 0)).toBe(true);
    });

    it('should query raw SQL with correct workspace and date range', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      await AnalyticsQuery.getTaskCompletionTrend('ws1', 'u1', 7);

      expect(prisma.$queryRaw).toHaveBeenCalled();
      const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
      // Verify the query template contains the workspace ID
      expect((call[0] as unknown as TemplateStringsArray).join('')).toContain('Task');
    });
  });

  describe('getOverdueTrend', () => {
    it('should return cached trend if available', async () => {
      const cached = [{ weekStart: new Date(), count: 3 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getOverdueTrend('ws1', 'u1', 7);

      expect(result).toEqual(cached);
    });

    it('should build weekly buckets on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await AnalyticsQuery.getOverdueTrend('ws1', 'u1', 14);

      // 14 days / 7 = 2 weeks
      expect(result).toHaveLength(2);
    });
  });

  describe('getProjectHealthMetrics', () => {
    it('should return cached health if available', async () => {
      const cached = [{ projectId: 'p1', health: 'healthy' }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getProjectHealthMetrics('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate health on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'p1',
          name: 'Project A',
          status: 'ACTIVE',
          dueDate: null,
          _count: { tasks: 10 },
          tasks: Array(7).fill({ id: 't' }),
        },
      ] as any);

      const result = await AnalyticsQuery.getProjectHealthMetrics('ws1', 'u1');

      expect(result).toHaveLength(1);
      expect(result[0].health).toBe('healthy');
      expect(result[0].progress).toBe(70);
    });

    it('should mark project as critical when overdue', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'p1',
          name: 'Overdue Project',
          status: 'ACTIVE',
          dueDate: pastDate,
          _count: { tasks: 10 },
          tasks: [{ id: 't1' }],
        },
      ] as any);

      const result = await AnalyticsQuery.getProjectHealthMetrics('ws1', 'u1');

      expect(result[0].health).toBe('critical');
    });

    it('should mark project as at-risk when due soon with low progress', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: 'p1',
          name: 'At Risk Project',
          status: 'ACTIVE',
          dueDate: soonDate,
          _count: { tasks: 10 },
          tasks: [{ id: 't1' }], // 10% complete
        },
      ] as any);

      const result = await AnalyticsQuery.getProjectHealthMetrics('ws1', 'u1');

      expect(result[0].health).toBe('at-risk');
    });
  });

  describe('getMemberContribution', () => {
    it('should return cached contributions if available', async () => {
      const cached = [{ userId: 'u1', contributionScore: 10 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getMemberContribution('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate contributions on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: 'u1',
          role: 'ADMIN',
          user: { id: 'u1', name: 'Alice', email: 'a@test.com', image: null },
        },
      ] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { taskId: 5 } },
      ] as any);
      vi.mocked(prisma.timeEntry.groupBy).mockResolvedValue([
        { userId: 'u1', _sum: { duration: 120 } },
      ] as any);
      vi.mocked(prisma.comment.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { userId: 3 } },
      ] as any);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([]);

      const result = await AnalyticsQuery.getMemberContribution('ws1', 'u1');

      expect(result).toHaveLength(1);
      expect(result[0].completedTasks).toBe(5);
      expect(result[0].totalHours).toBe(2);
      expect(result[0].commentsCount).toBe(3);
      // score = 5*2 + 2 + 3*0.5 = 13.5
      expect(result[0].contributionScore).toBe(13.5);
    });

    it('should sort by contribution score descending', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: 'u1',
          role: 'MEMBER',
          user: { id: 'u1', name: 'Alice', email: 'a@test.com', image: null },
        },
        {
          userId: 'u2',
          role: 'MEMBER',
          user: { id: 'u2', name: 'Bob', email: 'b@test.com', image: null },
        },
      ] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { taskId: 10 } },
        { userId: 'u2', _count: { taskId: 2 } },
      ] as any);
      vi.mocked(prisma.timeEntry.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.comment.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([]);

      const result = await AnalyticsQuery.getMemberContribution('ws1', 'u1');

      expect(result[0].userId).toBe('u1');
      expect(result[1].userId).toBe('u2');
    });
  });

  describe('getActivityVolumeTrend', () => {
    it('should return cached trend if available', async () => {
      const cached = [{ date: new Date(), created: 5, updated: 3, completed: 2, assigned: 1, total: 11 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getActivityVolumeTrend('ws1', 'u1', 7);

      expect(result).toEqual(cached);
    });

    it('should build dense daily array on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await AnalyticsQuery.getActivityVolumeTrend('ws1', 'u1', 7);

      expect(result).toHaveLength(7);
      expect(result.every((p) => p.total === 0)).toBe(true);
    });

    it('should aggregate actions per day', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      // Build a date that matches what getDayKey produces (UTC midnight)
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      // Use the same date the function will generate for day index 0
      const day0 = new Date(startDate);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { day: day0, action: 'CREATED', count: 3n },
        { day: day0, action: 'UPDATED', count: 2n },
      ]);

      const result = await AnalyticsQuery.getActivityVolumeTrend('ws1', 'u1', 30);

      // Find the entry for day0's key
      const day0Key = day0.toISOString().split('T')[0];
      const day0Entry = result.find((p) => p.date.toISOString().split('T')[0] === day0Key);
      expect(day0Entry).toBeDefined();
      expect(day0Entry!.created).toBe(3);
      expect(day0Entry!.updated).toBe(2);
      expect(day0Entry!.total).toBe(5);
    });
  });

  describe('getMostActiveDay', () => {
    it('should return cached result if available', async () => {
      const cached = { day: 'Monday', count: 15, mostCommonAction: 'CREATED' };
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getMostActiveDay('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should return default when no activities', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await AnalyticsQuery.getMostActiveDay('ws1', 'u1');

      expect(result.day).toBe('None');
      expect(result.count).toBe(0);
    });

    it('should find most active day from DB results', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      // Monday = DOW 1
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { dow: 1, action: 'CREATED', count: 10n },
        { dow: 1, action: 'UPDATED', count: 5n },
        { dow: 3, action: 'CREATED', count: 3n },
      ]);

      const result = await AnalyticsQuery.getMostActiveDay('ws1', 'u1');

      expect(result.day).toBe('Monday');
      expect(result.count).toBe(15);
      expect(result.mostCommonAction).toBe('CREATED');
    });
  });

  describe('getTasksPerMember', () => {
    it('should return cached workload if available', async () => {
      const cached = [{ userId: 'u1', assignedTasks: 5, status: 'normal' }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getTasksPerMember('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate workload on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: 'u1',
          user: { id: 'u1', name: 'Alice', email: 'a@test.com' },
        },
      ] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { taskId: 5 } },
      ] as any);

      const result = await AnalyticsQuery.getTasksPerMember('ws1', 'u1');

      expect(result[0].assignedTasks).toBe(5);
      expect(result[0].status).toBe('normal');
    });

    it('should mark member as overloaded when >= 15 tasks', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: 'u1',
          user: { id: 'u1', name: 'Alice', email: 'a@test.com' },
        },
      ] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { taskId: 15 } },
      ] as any);

      const result = await AnalyticsQuery.getTasksPerMember('ws1', 'u1');

      expect(result[0].status).toBe('overloaded');
    });

    it('should mark member as high when >= 10 tasks', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: 'u1',
          user: { id: 'u1', name: 'Alice', email: 'a@test.com' },
        },
      ] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([
        { userId: 'u1', _count: { taskId: 10 } },
      ] as any);

      const result = await AnalyticsQuery.getTasksPerMember('ws1', 'u1');

      expect(result[0].status).toBe('high');
    });
  });

  describe('getTasksByPriority', () => {
    it('should return cached distribution if available', async () => {
      const cached = [{ priority: 'HIGH', count: 5 }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getTasksByPriority('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate distribution on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.groupBy).mockResolvedValue([
        { priority: 'HIGH', _count: { priority: 5 } },
        { priority: 'MEDIUM', _count: { priority: 3 } },
      ] as any);

      const result = await AnalyticsQuery.getTasksByPriority('ws1', 'u1');

      expect(result).toHaveLength(2);
      expect((result as Array<{ priority: string; count: number }>)[0].priority).toBe('HIGH');
      expect((result as Array<{ priority: string; count: number }>)[0].count).toBe(5);
    });
  });

  describe('getDeadlineRiskAnalysis', () => {
    it('should return cached analysis if available', async () => {
      const cached = { riskLevel: 'low', dueIn3Days: [], dueIn7DaysCount: 0, highPriorityNearDeadline: [] };
      vi.mocked(CacheClient.get).mockResolvedValue(cached);

      const result = await AnalyticsQuery.getDeadlineRiskAnalysis('ws1', 'u1');

      expect(result).toEqual(cached);
    });

    it('should calculate risk on cache miss', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.findMany)
        .mockResolvedValueOnce([])  // dueIn3Days
        .mockResolvedValueOnce([]); // highPriorityNearDeadline
      vi.mocked(prisma.task.count).mockResolvedValue(0);

      const result = await AnalyticsQuery.getDeadlineRiskAnalysis('ws1', 'u1');

      expect(result.riskLevel).toBe('low');
      expect(result.dueIn7DaysCount).toBe(0);
    });

    it('should set high risk when >= 3 high-priority near deadline', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 't1', title: 'T1', dueDate: new Date(), priority: 'URGENT', status: 'TODO', createdById: 'u1', createdAt: new Date(), updatedAt: new Date() },
          { id: 't2', title: 'T2', dueDate: new Date(), priority: 'HIGH', status: 'TODO', createdById: 'u1', createdAt: new Date(), updatedAt: new Date() },
          { id: 't3', title: 'T3', dueDate: new Date(), priority: 'URGENT', status: 'TODO', createdById: 'u1', createdAt: new Date(), updatedAt: new Date() },
        ] as any);
      vi.mocked(prisma.task.count).mockResolvedValue(3);

      const result = await AnalyticsQuery.getDeadlineRiskAnalysis('ws1', 'u1');

      expect(result.riskLevel).toBe('high');
    });

    it('should set medium risk when 2 high-priority near deadline', async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.task.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 't1', title: 'T1', dueDate: new Date(), priority: 'HIGH', status: 'TODO', createdById: 'u1', createdAt: new Date(), updatedAt: new Date() },
          { id: 't2', title: 'T2', dueDate: new Date(), priority: 'URGENT', status: 'TODO', createdById: 'u1', createdAt: new Date(), updatedAt: new Date() },
        ] as any);
      vi.mocked(prisma.task.count).mockResolvedValue(2);

      const result = await AnalyticsQuery.getDeadlineRiskAnalysis('ws1', 'u1');

      expect(result.riskLevel).toBe('medium');
    });
  });
});
