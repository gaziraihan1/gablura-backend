import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationMutation } from "../../../modules/notification/notification.mutation.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("NotificationMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a notification", async () => {
      const input = { userId: "u1", type: "TASK_ASSIGNED" as any, title: "T", message: "M" };
      (prisma.notification.create as any).mockResolvedValue({ id: "n1", ...input });

      const result = await NotificationMutation.create(input as any);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: input,
        include: expect.anything(),
      });
      expect(result.id).toBe("n1");
    });
  });

  describe("markAsRead", () => {
    it("should update read status", async () => {
      (prisma.notification.update as any).mockResolvedValue({ id: "n1", read: true });

      await NotificationMutation.markAsRead("n1");
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "n1" },
          data: expect.objectContaining({ read: true }),
        })
      );
    });
  });

  describe("markAllAsRead", () => {
    it("should update multiple notifications", async () => {
      (prisma.notification.updateMany as any).mockResolvedValue({ count: 5 });

      const result = await NotificationMutation.markAllAsRead("u1");
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", read: false },
        data: expect.objectContaining({ read: true }),
      });
      expect(result.count).toBe(5);
    });
  });

  describe("deleteNotification", () => {
    it("should delete a notification", async () => {
      await NotificationMutation.deleteNotification("n1");
      expect(prisma.notification.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    });
  });

  describe("deleteAllReadNotifications", () => {
    it("should delete all read notifications for user", async () => {
      (prisma.notification.deleteMany as any).mockResolvedValue({ count: 3 });

      const result = await NotificationMutation.deleteAllReadNotifications("u1");
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1", read: true },
      });
      expect(result.count).toBe(3);
    });
  });

  describe("deleteOldReadNotifications", () => {
    it("should delete old read notifications", async () => {
      (prisma.notification.deleteMany as any).mockResolvedValue({ count: 10 });

      const result = await NotificationMutation.deleteOldReadNotifications(30);
      expect(prisma.notification.deleteMany).toHaveBeenCalled();
      expect(result.count).toBe(10);
    });
  });
});
