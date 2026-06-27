import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationQuery } from "../../../modules/notification/notification.query.js";
import { prismaRead, prisma } from "../../../lib/prisma.js";

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

describe("NotificationQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserNotification", () => {
    it("should return paginated notifications without cursor", async () => {
      const mockNotifications = Array(21).fill({ id: "id" });
      (prismaRead.notification.findMany as any).mockResolvedValue(mockNotifications);

      const result = await NotificationQuery.getUserNotification("user1");

      expect(prismaRead.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user1" },
          take: 21,
        })
      );
      expect(result.items.length).toBe(20);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("id");
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread count", async () => {
      (prisma.notification.count as any).mockResolvedValue(5);

      const result = await NotificationQuery.getUnreadCount("user1");

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: "user1", read: false },
      });
      expect(result.count).toBe(5);
    });
  });
});
