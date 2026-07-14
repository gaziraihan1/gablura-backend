import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  notifyUser,
  notifyUsers,
  getPublishMetrics,
  resetPublishMetrics,
} from "../../../modules/notification/notification.helpers.js";
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
  setex: vi.fn().mockResolvedValue("OK"),
};
vi.mock("../../../lib/redis/redis.pubsub", () => ({
  getPublisher: vi.fn(() => mockPublisher),
}));

describe("Notification Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPublishMetrics();
    // Default: publish succeeds
    mockPublisher.publish.mockResolvedValue(1);
  });

  afterEach(() => {
    resetPublishMetrics();
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

    it("should track successful publish metrics", async () => {
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

      const metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(1);
      expect(metrics.successfulPublishes).toBe(1);
      expect(metrics.failedPublishes).toBe(0);
    });

    it("should retry on publish failure and track metrics", async () => {
      const mockNotification = {
        id: "n1",
        createdAt: new Date(),
        type: "TASK_ASSIGNED",
      };
      (prisma.notification.create as any).mockResolvedValue({
        ...mockNotification,
        sender: { id: "s1" },
      });

      // First 2 attempts fail, then succeed
      mockPublisher.publish
        .mockRejectedValueOnce(new Error("Redis error"))
        .mockRejectedValueOnce(new Error("Redis error"))
        .mockResolvedValueOnce(1);

      await notifyUser({
        userId: "u1",
        type: "TASK_ASSIGNED" as any,
        title: "T",
        message: "M",
      });

      const metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(3); // 2 retries + 1 success
      expect(metrics.successfulPublishes).toBe(1);
      expect(metrics.failedPublishes).toBe(0);
    });

    it("should track failed publish after all retries exhausted", async () => {
      const mockNotification = {
        id: "n1",
        createdAt: new Date(),
        type: "TASK_ASSIGNED",
      };
      (prisma.notification.create as any).mockResolvedValue({
        ...mockNotification,
        sender: { id: "s1" },
      });

      // All attempts fail (original + 3 retries = 4 total)
      mockPublisher.publish.mockRejectedValue(new Error("Redis error"));

      await notifyUser({
        userId: "u1",
        type: "TASK_ASSIGNED" as any,
        title: "T",
        message: "M",
      });

      const metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(4); // 1 original + 3 retries
      expect(metrics.successfulPublishes).toBe(0);
      expect(metrics.failedPublishes).toBe(1);
      expect(metrics.lastFailure).toBeDefined();
      expect(metrics.lastFailure?.userId).toBe("u1");
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
      // Each notification triggers one publish call
      expect(getPublisher().publish).toHaveBeenCalledTimes(2);
    });

    it("should track metrics for batch operations", async () => {
      const notifications = [
        { userId: "u1", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
        { userId: "u2", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
        { userId: "u3", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
      ];
      (prisma.notification.createManyAndReturn as any).mockResolvedValue(
        notifications.map((n, i) => ({ ...n, id: `n${i}`, createdAt: new Date(), read: false }))
      );

      await notifyUsers(notifications);

      const metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(3);
      expect(metrics.successfulPublishes).toBe(3);
      expect(metrics.failedPublishes).toBe(0);
    });

    it("should handle partial failures in batch", async () => {
      const notifications = [
        { userId: "u1", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
        { userId: "u2", type: "TASK_ASSIGNED" as any, title: "T", message: "M" },
      ];
      (prisma.notification.createManyAndReturn as any).mockResolvedValue(
        notifications.map((n, i) => ({ ...n, id: `n${i}`, createdAt: new Date(), read: false }))
      );

      // All publishes fail (will be caught by Promise.allSettled)
      mockPublisher.publish.mockRejectedValue(new Error("Redis error"));

      // Should not throw - partial failures are handled
      await notifyUsers(notifications);

      expect(prisma.notification.createManyAndReturn).toHaveBeenCalled();
      const metrics = getPublishMetrics();
      expect(metrics.failedPublishes).toBeGreaterThan(0);
    });
  });

  describe("Metrics", () => {
    it("should reset metrics correctly", async () => {
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

      let metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(1);

      resetPublishMetrics();

      metrics = getPublishMetrics();
      expect(metrics.totalAttempts).toBe(0);
      expect(metrics.successfulPublishes).toBe(0);
      expect(metrics.failedPublishes).toBe(0);
    });
  });
});
