import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityAnalytics } from "../../../modules/activity/activity.analytics.js";
import { prisma } from "../../../lib/prisma.js";
import { ActivityQuery } from "../../../modules/activity/activity.query.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    activity: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/activity/activity.query.js", () => ({
  ActivityQuery: {
    getUserActivities: vi.fn(),
  },
}));

describe("ActivityAnalytics", () => {
  const mockUserId = "user-1";
  const mockWorkspaceId = "ws-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserActivityStats", () => {
    it("should calculate activity stats correctly", async () => {
      vi.mocked(prisma.activity.count).mockResolvedValueOnce(100); // total
      vi.mocked(prisma.activity.count).mockResolvedValueOnce(10);  // today
      vi.mocked(prisma.activity.groupBy).mockResolvedValue([
        { action: "CREATED", _count: 60 },
        { action: "UPDATED", _count: 40 },
      ] as any);
      vi.mocked(prisma.activity.count).mockResolvedValueOnce(5);   // admin total
      vi.mocked(prisma.activity.count).mockResolvedValueOnce(2);   // admin today

      const stats = await ActivityAnalytics.getUserActivityStats(mockUserId, mockWorkspaceId);

      // Admin audit rows (5 total, 2 today, all UPDATED) are subtracted
      expect(stats).toEqual({
        total: 95,
        today: 8,
        byAction: {
          CREATED: 60,
          UPDATED: 35,
        },
      });

      expect(prisma.activity.count).toHaveBeenCalledTimes(4);
      expect(prisma.activity.groupBy).toHaveBeenCalled();
    });

    it("should apply workspace filter when provided", async () => {
      vi.mocked(prisma.activity.count).mockResolvedValue(0);
      vi.mocked(prisma.activity.groupBy).mockResolvedValue([]);

      await ActivityAnalytics.getUserActivityStats(mockUserId, mockWorkspaceId);

      expect(prisma.activity.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
          }),
        }),
      );
    });
  });

  describe("getGroupedActivities", () => {
    it("should group activities by date", async () => {
      const mockActivities = [
        { createdAt: new Date("2024-01-01T10:00:00Z"), action: "CREATED" },
        { createdAt: new Date("2024-01-01T15:00:00Z"), action: "UPDATED" },
        { createdAt: new Date("2024-01-02T10:00:00Z"), action: "CREATED" },
      ];
      vi.mocked(ActivityQuery.getUserActivities).mockResolvedValue(mockActivities as any);

      const grouped = await ActivityAnalytics.getGroupedActivities(mockUserId);

      const dates = Object.keys(grouped);
      expect(dates).toHaveLength(2);
      expect(grouped[dates[0]]).toHaveLength(2);
      expect(grouped[dates[1]]).toHaveLength(1);
    });

    it("should request activities with correct startDate", async () => {
      vi.mocked(ActivityQuery.getUserActivities).mockResolvedValue([]);

      await ActivityAnalytics.getGroupedActivities(mockUserId, undefined, 14);

      expect(ActivityQuery.getUserActivities).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          startDate: expect.any(Date),
          limit: 100,
        }),
      );
    });
  });
});
