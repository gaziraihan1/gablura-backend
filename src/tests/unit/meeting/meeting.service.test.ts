import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetingService } from "../../../modules/meeting/meeting.service.js";
import { MeetingQuery } from "../../../modules/meeting/meeting.query.js";
import { MeetingMutation } from "../../../modules/meeting/meeting.mutation.js";
import * as Notifications from "../../../modules/meeting/meeting.notification.js";
import { ForbiddenError, NotFoundError, BadRequestError } from "../../../errors/index.js";
import { MeetingVisibility, MeetingStatus, WorkspaceRole } from "@prisma/client";

vi.mock("../../../modules/meeting/meeting.query");
vi.mock("../../../modules/meeting/meeting.mutation");
vi.mock("../../../modules/meeting/meeting.notification", () => ({
  notifyMeetingCreatedPrivate: vi.fn().mockReturnValue({ catch: vi.fn() }),
  notifyMeetingCreatedPublic: vi.fn().mockReturnValue({ catch: vi.fn() }),
  notifyMeetingUpdated: vi.fn().mockReturnValue({ catch: vi.fn() }),
  notifyMeetingCancelled: vi.fn().mockReturnValue({ catch: vi.fn() }),
}));

describe("MeetingService", () => {
  const ctx = {
    userId: "user1",
    workspaceId: "ws1",
    workspaceRole: "ADMIN" as WorkspaceRole,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should throw ForbiddenError if user is not admin", async () => {
      const nonAdminCtx = { ...ctx, workspaceRole: "MEMBER" as WorkspaceRole };
      await expect(
        MeetingService.create(nonAdminCtx, {} as any, "sender")
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw BadRequestError for invalid dates", async () => {
      await expect(
        MeetingService.create(ctx, {
          title: "Test",
          startTime: "invalid",
          endTime: "invalid",
        } as any, "sender")
      ).rejects.toThrow(BadRequestError);
    });

    it("should create a meeting successfully", async () => {
      const input = {
        title: "Test Meeting",
        visibility: MeetingVisibility.PUBLIC,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
      };
      
      (MeetingMutation.create as any).mockResolvedValue({ id: "m1", ...input });

      const result = await MeetingService.create(ctx, input as any, "sender");

      expect(MeetingMutation.create).toHaveBeenCalled();
      expect(result.id).toBe("m1");
      expect(Notifications.notifyMeetingCreatedPublic).toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("should throw ForbiddenError if user cannot access", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(false);
      await expect(MeetingService.getById(ctx, "m1")).rejects.toThrow(ForbiddenError);
    });

    it("should throw NotFoundError if meeting not found", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(true);
      (MeetingQuery.findById as any).mockResolvedValue(null);
      await expect(MeetingService.getById(ctx, "m1")).rejects.toThrow(NotFoundError);
    });

    it("should return meeting", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(true);
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1" });
      const meeting = await MeetingService.getById(ctx, "m1");
      expect(meeting.id).toBe("m1");
    });
  });

  describe("update", () => {
    it("should throw NotFoundError if meeting not found", async () => {
      (MeetingQuery.findById as any).mockResolvedValue(null);
      await expect(MeetingService.update(ctx, "m1", {}, "sender")).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if not workspace member", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({ workspaceId: "other" });
      await expect(MeetingService.update(ctx, "m1", {}, "sender")).rejects.toThrow(ForbiddenError);
    });
    
    it("should update meeting successfully", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1",
        status: "SCHEDULED"
      });
      (MeetingMutation.update as any).mockResolvedValue({ id: "m1" });
      
      await MeetingService.update(ctx, "m1", { title: "New Title" }, "sender");
      
      expect(MeetingMutation.update).toHaveBeenCalled();
      expect(Notifications.notifyMeetingUpdated).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should cancel meeting successfully", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1",
        status: "SCHEDULED"
      });
      (MeetingMutation.cancel as any).mockResolvedValue({ id: "m1", status: "CANCELLED" });
      
      await MeetingService.cancel(ctx, "m1", "sender");
      
      expect(MeetingMutation.cancel).toHaveBeenCalledWith("m1");
      expect(Notifications.notifyMeetingCancelled).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete meeting successfully", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1"
      });
      
      await MeetingService.delete(ctx, "m1");
      
      expect(MeetingMutation.delete).toHaveBeenCalledWith("m1");
    });
  });
});
