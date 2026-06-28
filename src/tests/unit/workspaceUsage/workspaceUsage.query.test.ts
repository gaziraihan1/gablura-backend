import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceUsageQuery } from "../../../modules/workspaceUsage/workspaceUsage.query.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    activity: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    task: { count: vi.fn(), groupBy: vi.fn() },
    project: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    comment: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    timeEntry: { count: vi.fn() },
    file: { count: vi.fn() },
    notification: { count: vi.fn() },
    taskAssignee: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
    workspaceMember: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

describe("WorkspaceUsageQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getDailyActiveUsers", () => {
    it("counts unique active users per day", async () => {
      const localDayKey = (daysAgo: number) => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        date.setHours(0, 0, 0, 0);
        return date.toISOString().split("T")[0];
      };
      const localDateAt = (daysAgo: number, hour: number) => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        date.setHours(hour, 0, 0, 0);
        return date;
      };

      vi.mocked(prisma.activity.findMany).mockResolvedValue([
        { userId: "user-1", createdAt: localDateAt(1, 1) },
        { userId: "user-1", createdAt: localDateAt(1, 2) },
        { userId: "user-2", createdAt: localDateAt(1, 3) },
        { userId: "user-3", createdAt: localDateAt(0, 1) },
      ] as any);

      const result = await WorkspaceUsageQuery.getDailyActiveUsers("workspace-1", 2);

      expect(result).toEqual([
        { date: localDayKey(1), count: 2 },
        { date: localDayKey(0), count: 1 },
      ]);
      expect(prisma.activity.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace-1",
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
        select: { userId: true, createdAt: true },
      });
    });
  });

  describe("getUsageSnapshot", () => {
    it("aggregates counts, storage, active members, average DAU, and engagement score", async () => {
      vi.mocked(prisma.task.count).mockResolvedValue(8);
      vi.mocked(prisma.project.count).mockResolvedValue(2);
      vi.mocked(prisma.activity.count).mockResolvedValue(5);

      const members = [
        { user: { id: "u1", name: "One", email: "one@test.dev", image: null, lastLoginAt: new Date("2026-06-27T00:00:00.000Z") } },
        { user: { id: "u2", name: "Two", email: "two@test.dev", image: null, lastLoginAt: new Date("2026-06-01T00:00:00.000Z") } },
      ];
      const files = [
        { id: "f1", size: 1024 * 1024, uploadedById: "u1", projectId: null },
        { id: "f2", size: 2 * 1024 * 1024, uploadedById: "u2", projectId: null },
      ];

      const result = await WorkspaceUsageQuery.getUsageSnapshot("workspace-1", members, files, [
        { date: "2026-06-27", count: 2 },
        { date: "2026-06-28", count: 1 },
      ]);

      expect(result).toEqual({
        totalMembers: 2,
        activeMembers: 1,
        totalTasks: 8,
        totalProjects: 2,
        storageUsedMB: 3,
        activityEvents: 5,
        avgDailyUsers: 2,
        engagementScore: 50,
      });
    });
  });

  describe("getPlanLimits", () => {
    it("returns plan limits and storage usage for known plans", async () => {
      const result = await WorkspaceUsageQuery.getPlanLimits(
        { plan: "PRO", maxStorage: 9999 },
        3,
        [{ id: "f1", size: 2 * 1024 * 1024, uploadedById: "u1", projectId: null }],
        4,
      );

      expect(result).toEqual({
        currentPlan: "PRO",
        memberCount: 3,
        memberLimit: 50,
        storageUsedMB: 2,
        storageLimitMB: 5120,
        projectCount: 4,
        projectLimit: -1,
        automationCount: 0,
        automationLimit: 50,
      });
    });

    it("throws when workspace was not found", async () => {
      await expect(WorkspaceUsageQuery.getPlanLimits(null, 0, [], 0)).rejects.toThrow(
        "Workspace not found",
      );
    });
  });

  describe("privacy redaction for non-admin users", () => {
    it("redacts user engagement details for non-admin members", async () => {
      const result = await WorkspaceUsageQuery.getUserEngagement(
        "workspace-1",
        [{ user: { id: "u1", name: "User", email: "u@test.dev", image: null, lastLoginAt: new Date() } }],
        false,
        [{ date: "2026-06-28", count: 1 }],
      );

      expect(result).toEqual({
        activeUsers: { online: 0, thisWeek: 0, thisMonth: 0 },
        inactiveUsers: [],
        collaborationIndex: [],
        dailyActiveUsers: [{ date: "2026-06-28", count: 1 }],
      });
      expect(prisma.comment.groupBy).not.toHaveBeenCalled();
      expect(prisma.task.groupBy).not.toHaveBeenCalled();
    });

    it("redacts workspace load details for non-admin members", async () => {
      const result = await WorkspaceUsageQuery.getWorkspaceLoad("workspace-1", [], false);

      expect(result).toEqual({
        tasksPerUser: [],
        projectsNearingDeadlines: [],
        averageTaskCompletion: { byUser: [], byProject: [] },
      });
      expect(prisma.taskAssignee.groupBy).not.toHaveBeenCalled();
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });
});