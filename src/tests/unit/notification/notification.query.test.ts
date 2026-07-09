import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationQuery } from "../../../modules/notification/notification.query.js";
import { prismaRead, prisma } from "../../../lib/prisma.js";
import { CacheClient } from "../../../lib/redis/cache.client.js";

vi.mock("../../../lib/prisma", () => ({
  prismaRead: {
    notification: {
      findMany: vi.fn(),
    },
  },
  prisma: {
    notification: {
      count: vi.fn(),
    },
  },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    CacheClient: {
      ...actual.CacheClient,
      getOrSet: vi.fn(),
    },
  };
});

describe("NotificationQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserNotification", () => {
    it("should return cached notifications if available", async () => {
      const cachedData = { items: [{ id: "cached" }], nextCursor: null, hasMore: false };
      vi.mocked(CacheClient.getOrSet).mockResolvedValue(cachedData);

      const result = await NotificationQuery.getUserNotification("user1");

      expect(result).toEqual(cachedData);
      expect(prismaRead.notification.findMany).not.toHaveBeenCalled();
    });

    it("should fetch and cache notifications on cache miss", async () => {
      const mockNotifications = Array(21).fill({ id: "id" });
      vi.mocked(CacheClient.getOrSet).mockImplementation(async (key, fetcher) => await fetcher());
      (prismaRead.notification.findMany as any).mockResolvedValue(mockNotifications);

      const result = await NotificationQuery.getUserNotification("user1");

      expect(result.items.length).toBe(20);
      expect(prismaRead.notification.findMany).toHaveBeenCalled();
      expect(CacheClient.getOrSet).toHaveBeenCalledWith(
        expect.stringContaining("notifications:list:user1"),
        expect.any(Function),
        60
      );
    });
  });

  describe("getUnreadCount", () => {
    it("should return cached unread count if available", async () => {
      const cachedCount = { count: 10 };
      vi.mocked(CacheClient.getOrSet).mockResolvedValue(cachedCount);

      const result = await NotificationQuery.getUnreadCount("user1");

      expect(result).toEqual(cachedCount);
      expect(prisma.notification.count).not.toHaveBeenCalled();
    });

    it("should fetch and cache unread count on cache miss", async () => {
      vi.mocked(CacheClient.getOrSet).mockImplementation(async (key, fetcher) => await fetcher());
      (prisma.notification.count as any).mockResolvedValue(5);

      const result = await NotificationQuery.getUnreadCount("user1");

      expect(result.count).toBe(5);
      expect(prisma.notification.count).toHaveBeenCalled();
      expect(CacheClient.getOrSet).toHaveBeenCalledWith(
        expect.stringContaining("notifications:unread:user1"),
        expect.any(Function),
        30
      );
    });
  });
});
