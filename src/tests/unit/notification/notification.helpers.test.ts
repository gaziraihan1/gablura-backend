import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyUser, notifyUsers } from "../../../modules/notification/notification.helpers.js";
import { prisma } from "../../../lib/prisma.js";
import { getPublisher } from "../../../lib/redis/redis.pubsub.js";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
  },
}));

const mockPublisher = {
  publish: vi.fn().mockResolvedValue(1),
};
vi.mock("../../../lib/redis/redis.pubsub", () => ({
  getPublisher: vi.fn(() => mockPublisher),
}));

describe("Notification Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifyUser", () => {
    it("should create a notification and publish to SSE", async () => {
      const mockNotification = {
        id: "n1",
        createdAt: new Date(),
        type: "TASK_ASSIGNED",
      };
      (prisma.notification.create as any).mockResolvedValue({
        ...mockNotification,
        sender: { id: "s1" },
      });

      await notifyUser({
        userId: "u1",
        type: "TASK_ASSIGNED" as any,
        title: "T",
        message: "M",
      });

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(getPublisher().publish).toHaveBeenCalled();
    });
  });

  describe("notifyUsers", () => {
    it("should perform bulk insert and publish", async () => {
      const notifications = [
        { userId: "u1", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
        { userId: "u2", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
      ];
      (prisma.notification.createManyAndReturn as any).mockResolvedValue(
        notifications.map((n, i) => ({ ...n, id: `n${i}`, createdAt: new Date(), read: false }))
      );

      await notifyUsers(notifications);

      expect(prisma.notification.createManyAndReturn).toHaveBeenCalled();
      expect(getPublisher().publish).toHaveBeenCalledTimes(2);
    });
  });
});
