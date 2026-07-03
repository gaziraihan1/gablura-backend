import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetingService } from "../../../modules/meeting/meeting.service.js";
import { MeetingQuery } from "../../../modules/meeting/meeting.query.js";
import { MeetingMutation } from "../../../modules/meeting/meeting.mutation.js";
import * as Notifications from "../../../modules/meeting/meeting.notification.js";
import { ForbiddenError, NotFoundError, BadRequestError } from "../../../errors/index.js";
import { MeetingVisibility, MeetingStatus, WorkspaceRole } from "@prisma/client";
import type { CreateMeetingInput, UpdateMeetingInput } from "../../../modules/meeting/meeting.types.js";

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
      const input: CreateMeetingInput = {
        title: "Test",
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      };
      await expect(
        MeetingService.create(nonAdminCtx, input, "sender")
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw BadRequestError for invalid dates", async () => {
      const input = {
        title: "Test",
        startTime: "invalid",
        endTime: "invalid",
        visibility: MeetingVisibility.PUBLIC,
      } as unknown as CreateMeetingInput;
      await expect(
        MeetingService.create(ctx, input, "sender")
      ).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if end time is before start time", async () => {
      const input: CreateMeetingInput = {
        title: "Test",
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now()).toISOString(),
        visibility: MeetingVisibility.PUBLIC,
      };
      await expect(
        MeetingService.create(ctx, input, "sender")
      ).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if private meeting has no attendees", async () => {
      const input: CreateMeetingInput = {
        title: "Test",
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        visibility: MeetingVisibility.PRIVATE,
      };
      await expect(
        MeetingService.create(ctx, input, "sender")
      ).rejects.toThrow(BadRequestError);
    });

    it("should create a meeting successfully", async () => {
      const input: CreateMeetingInput = {
        title: "Test Meeting",
        visibility: MeetingVisibility.PUBLIC,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
      };
      
      (MeetingMutation.create as any).mockResolvedValue({ id: "m1", ...input });

      const result = await MeetingService.create(ctx, input, "sender");

      expect(MeetingMutation.create).toHaveBeenCalled();
      expect(result.id).toBe("m1");
      expect(Notifications.notifyMeetingCreatedPublic).toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("should throw ForbiddenError if user cannot access", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "ws1" });
      (MeetingQuery.canUserAccess as any).mockResolvedValue(false);
      await expect(MeetingService.getById(ctx, "m1")).rejects.toThrow(ForbiddenError);
    });

    it("should throw NotFoundError if meeting not found", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(true);
      (MeetingQuery.findById as any).mockResolvedValue(null);
      await expect(MeetingService.getById(ctx, "m1")).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if meeting belongs to different workspace", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(true);
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "other_ws" });
      await expect(MeetingService.getById(ctx, "m1")).rejects.toThrow(ForbiddenError);
    });

    it("should return meeting", async () => {
      (MeetingQuery.canUserAccess as any).mockResolvedValue(true);
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "ws1" });
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
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "other" });
      await expect(MeetingService.update(ctx, "m1", {}, "sender")).rejects.toThrow(ForbiddenError);
    });

    it("should throw ForbiddenError if user is not admin and not creator", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "ws1", createdById: "other_user" });
      const memberCtx = { ...ctx, workspaceRole: "MEMBER" as WorkspaceRole, userId: "user1" };
      await expect(MeetingService.update(memberCtx, "m1", {}, "sender")).rejects.toThrow(ForbiddenError);
    });

    it("should throw BadRequestError if updating a cancelled meeting", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({ id: "m1", workspaceId: "ws1", status: "CANCELLED" as MeetingStatus });
      await expect(MeetingService.update(ctx, "m1", {}, "sender")).rejects.toThrow(BadRequestError);
    });
    
    it("should update meeting successfully", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1",
        status: "SCHEDULED" as MeetingStatus
      });
      (MeetingMutation.update as any).mockResolvedValue({ id: "m1" });
      
      const input: UpdateMeetingInput = { title: "New Title" };
      await MeetingService.update(ctx, "m1", input, "sender");
      
      expect(MeetingMutation.update).toHaveBeenCalled();
      expect(Notifications.notifyMeetingUpdated).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should throw BadRequestError if already cancelled", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1",
        status: "CANCELLED" as MeetingStatus
      });
      await expect(MeetingService.cancel(ctx, "m1", "sender")).rejects.toThrow(BadRequestError);
    });

    it("should cancel meeting successfully", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "user1",
        status: "SCHEDULED" as MeetingStatus
      });
      (MeetingMutation.cancel as any).mockResolvedValue({ id: "m1", status: "CANCELLED" as MeetingStatus });
      
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

    it("should throw ForbiddenError if user is not admin and not creator", async () => {
      (MeetingQuery.findById as any).mockResolvedValue({
        id: "m1",
        workspaceId: "ws1",
        createdById: "other_user"
      });
      const memberCtx = { ...ctx, workspaceRole: "MEMBER" as WorkspaceRole, userId: "user1" };
      await expect(MeetingService.delete(memberCtx, "m1")).rejects.toThrow(ForbiddenError);
    });
  });
});
