import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceUsageQuery } from "../../../modules/workspaceUsage/workspaceUsage.query.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    activity: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    task: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    project: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    comment: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    timeEntry: { count: vi.fn() },
    file: { count: vi.fn(), findMany: vi.fn() },
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
        { id: "f1", size: 1024 * 1024, uploadedById: "u1", projectId: null, mimeType: "text/plain", uploadedAt: new Date("2026-06-01T00:00:00.000Z") },
        { id: "f2", size: 2 * 1024 * 1024, uploadedById: "u2", projectId: null, mimeType: "image/png", uploadedAt: new Date("2026-06-02T00:00:00.000Z") },
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
        [{ id: "f1", size: 2 * 1024 * 1024, uploadedById: "u1", projectId: null, mimeType: "text/plain", uploadedAt: new Date("2026-06-01T00:00:00.000Z") }],
        4,
      );

      expect(result).toEqual({
        currentPlan: "PRO",
        memberCount: 3,
        memberLimit: 25,
        storageUsedMB: 2,
        storageLimitMB: 10240,
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

  describe("getUserEngagement", () => {
    it("builds a real peak-hours heatmap for admin users", async () => {
      const members = [
        { user: { id: "u1", name: "One", email: "one@test.dev", image: null, lastLoginAt: new Date("2026-06-27T00:00:00.000Z") } },
      ];
      vi.mocked(prisma.comment.groupBy).mockResolvedValue([] as any);
      vi.mocked(prisma.task.groupBy).mockResolvedValue([] as any);
      vi.mocked(prisma.taskAssignee.groupBy).mockResolvedValue([] as any);

      // "Now" is a Sunday (2026-06-28) → Monday is 6 days before. Build dates
      // in local time so getDay()/getHours() behave consistently on any machine.
      const localDateAt = (daysAgo: number, hour: number) => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        date.setHours(hour, 0, 0, 0);
        return date;
      };
      const mondayMorning = localDateAt(6, 9); // Monday 9am
      const mondayAfternoon = localDateAt(6, 15); // Monday 3pm
      vi.mocked(prisma.activity.findMany).mockResolvedValue([
        { createdAt: mondayMorning },
        { createdAt: mondayMorning },
        { createdAt: mondayAfternoon },
      ] as any);

      const result = await WorkspaceUsageQuery.getUserEngagement(
        "workspace-1",
        members,
        true,
        [{ date: "2026-06-28", count: 1 }],
      );

      const monday9 = result.peakHours.find((p) => p.day === "Mon" && p.hour === 9);
      const monday15 = result.peakHours.find((p) => p.day === "Mon" && p.hour === 15);

      expect(monday9?.activity).toBe(100);
      expect(monday15?.activity).toBe(50);
      expect(result.peakHours).toHaveLength(7 * 8);
    });

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
        peakHours: [],
      });
      expect(prisma.comment.groupBy).not.toHaveBeenCalled();
      expect(prisma.task.groupBy).not.toHaveBeenCalled();
    });
  });

  describe("getResourceUsage", () => {
    it("computes storage growth, file trend, growth pct, and file-type distribution", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "u1", name: "One", email: "one@test.dev" },
      ] as any);

      const files = [
        { id: "f1", size: 1024 * 1024, uploadedById: "u1", projectId: null, mimeType: "image/png", uploadedAt: new Date("2026-06-01T00:00:00.000Z") },
        { id: "f2", size: 2 * 1024 * 1024, uploadedById: "u1", projectId: null, mimeType: "application/pdf", uploadedAt: new Date("2026-06-15T00:00:00.000Z") },
        { id: "f3", size: 4 * 1024 * 1024, uploadedById: "u1", projectId: null, mimeType: "video/mp4", uploadedAt: new Date("2026-06-20T00:00:00.000Z") },
      ];

      const result = await WorkspaceUsageQuery.getResourceUsage(
        "workspace-1",
        files,
        10240,
        [],
      );

      expect(result.storageGrowth).toHaveLength(6);
      expect(result.storageGrowth[result.storageGrowth.length - 1].storage).toBe(7);
      expect(result.fileTrend).toHaveLength(6);
      expect(result.fileTrend[result.fileTrend.length - 1].count).toBe(3);
      expect(result.fileGrowthPct).toBeNull(); // previous month had no files
      expect(result.fileTypeDistribution).toEqual([
        { name: "Images", value: 1 },
        { name: "PDFs", value: 1 },
        { name: "Videos", value: 1 },
      ]);
    });
  });

  describe("getWorkspaceGrowth", () => {
    it("computes real month-over-month changes", async () => {
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(3);
      vi.mocked(prisma.project.count).mockResolvedValue(2);
      vi.mocked(prisma.task.count).mockResolvedValue(10);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.project.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.task.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.project.groupBy).mockResolvedValue([
        { status: "ACTIVE", _count: { status: 4 } },
        { status: "COMPLETED", _count: { status: 1 } },
      ] as any);

      const result = await WorkspaceUsageQuery.getWorkspaceGrowth("workspace-1");

      expect(result.thisMonth).toEqual({ newUsers: 3, newProjects: 2, newTasks: 10 });
      expect(result.changes).toEqual({ newTasks: null, newUsers: null, newProjects: null });
      expect(result.projectLifecycle).toEqual({
        created: 2,
        active: 4,
        completed: 1,
        archived: 0,
      });
      expect(result.insights).toEqual([]);
    });
  });

  describe("privacy redaction for non-admin users", () => {
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
