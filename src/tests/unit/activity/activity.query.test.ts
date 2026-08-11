import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityQuery } from "../../../modules/activity/activity.query.js";
import { prisma } from "../../../lib/prisma.js";
import { CacheClient } from "../../../lib/redis/cache.client.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    activity: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../lib/redis/cache.client.js", () => ({
  CacheClient: {
    get: vi.fn(),
    set: vi.fn(),
  },
  CACHE_KEYS: {
    activityUserList: vi.fn().mockReturnValue("user-list-key"),
    activityWorkspaceList: vi.fn().mockReturnValue("workspace-list-key"),
    activityTaskList: vi.fn().mockReturnValue("task-list-key"),
  },
  CACHE_TTL: {
    ACTIVITY_LIST: 3600,
    ACTIVITY_FEED: 3600,
  },
}));

describe("ActivityQuery", () => {
  const mockUserId = "user-1";
  const mockWorkspaceId = "ws-1";
  const mockTaskId = "task-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserActivities", () => {
    it("should return cached activities if available", async () => {
      const mockCached = [{ id: "act-1", action: "CREATED" }];
      vi.mocked(CacheClient.get).mockResolvedValue(mockCached);

      const result = await ActivityQuery.getUserActivities(mockUserId);

      expect(result).toEqual(mockCached);
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
    });

    it("should fetch from DB and cache if not cached", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const mockDbResult = [{ id: "act-1", action: "CREATED" }];
      vi.mocked(prisma.activity.findMany).mockResolvedValue(mockDbResult as any);

      const result = await ActivityQuery.getUserActivities(mockUserId);

      expect(result).toEqual(mockDbResult);
      expect(prisma.activity.findMany).toHaveBeenCalled();
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it("should apply workspace and entity filters correctly", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.activity.findMany).mockResolvedValue([]);

      await ActivityQuery.getUserActivities(mockUserId, {
        workspaceId: mockWorkspaceId,
        entityType: "TASK",
        action: "CREATED",
      });

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            entityType: "TASK",
            action: "CREATED",
          }),
        }),
      );
    });

    it("should apply date filters correctly", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.activity.findMany).mockResolvedValue([]);

      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-02");

      await ActivityQuery.getUserActivities(mockUserId, {
        startDate,
        endDate,
      });

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: startDate, lte: endDate },
          }),
        }),
      );
    });
  });

  describe("getWorkspaceActivities", () => {
    it("should return cached workspace activities", async () => {
      const mockCached = [{ id: "act-1" }];
      vi.mocked(CacheClient.get).mockResolvedValue(mockCached);

      const result = await ActivityQuery.getWorkspaceActivities(mockWorkspaceId);

      expect(result).toEqual(mockCached);
    });

    it("should fetch from DB if not cached", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.activity.findMany).mockResolvedValue([{ id: "act-1" }] as any);

      const result = await ActivityQuery.getWorkspaceActivities(mockWorkspaceId);

      expect(result).toEqual([{ id: "act-1" }]);
      expect(prisma.activity.findMany).toHaveBeenCalled();
    });

    it("filters Focura-admin audit rows from the member view", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const rows = [
        { id: "act-1", action: "CREATED", metadata: {} },
        {
          id: "act-2",
          action: "UPDATED",
          metadata: { source: "focura-admin", changes: { aiDailyCalls: { from: null, to: 9000 } } },
        },
      ];
      vi.mocked(prisma.activity.findMany).mockResolvedValue(rows as any);

      const result = await ActivityQuery.getWorkspaceActivities(mockWorkspaceId);

      expect(result.map((r: any) => r.id)).toEqual(["act-1"]);
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it("includes Focura-admin audit rows for workspace admins without caching", async () => {
      const rows = [
        { id: "act-1", action: "CREATED", metadata: {} },
        {
          id: "act-2",
          action: "UPDATED",
          metadata: { source: "focura-admin", changes: { plan: { from: "PRO", to: "ENTERPRISE" } } },
        },
      ];
      vi.mocked(prisma.activity.findMany).mockResolvedValue(rows as any);

      const result = await ActivityQuery.getWorkspaceActivities(
        mockWorkspaceId,
        {},
        { includeAdminRows: true },
      );

      expect(result.map((r: any) => r.id)).toEqual(["act-1", "act-2"]);
      // Admin view is always fresh — never served from or written to the
      // member cache (which would leak admin rows to regular members).
      expect(CacheClient.get).not.toHaveBeenCalled();
      expect(CacheClient.set).not.toHaveBeenCalled();
    });
  });

  describe("getTaskActivities", () => {
    it("should return cached task activities", async () => {
      const mockCached = [{ id: "act-1" }];
      vi.mocked(CacheClient.get).mockResolvedValue(mockCached);

      const result = await ActivityQuery.getTaskActivities(mockTaskId);

      expect(result).toEqual(mockCached);
    });

    it("should fetch from DB if not cached", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.activity.findMany).mockResolvedValue([{ id: "act-1" }] as any);

      const result = await ActivityQuery.getTaskActivities(mockTaskId);

      expect(result).toEqual([{ id: "act-1" }]);
      expect(prisma.activity.findMany).toHaveBeenCalled();
    });
  });
});
