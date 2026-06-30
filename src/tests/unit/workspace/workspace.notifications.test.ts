import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceNotifications } from "../../../modules/workspace/workspace.notifications.js";
import { prisma } from "../../../lib/prisma.js";
import { notifyUser, notifyUsers } from "../../../modules/notification/notification.helpers.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspaceMember: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/notification/notification.helpers.js", () => ({
  notifyUser: vi.fn(),
  notifyUsers: vi.fn(),
}));

describe("WorkspaceNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifyInvited", () => {
    it("calls notifyUser with invitation details", async () => {
      vi.mocked(notifyUser).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyInvited({
        invitedUserId: "user-2",
        inviterId: "user-1",
        inviterName: "Alice",
        workspaceName: "Test WS",
        token: "token-123",
      });

      expect(notifyUser).toHaveBeenCalledWith({
        userId: "user-2",
        senderId: "user-1",
        type: "WORKSPACE_INVITE",
        title: "Workspace Invitation",
        message: "Alice invited you to join Test WS",
        actionUrl: "/dashboard/workspaces/invitations/token-123",
      });
    });

    it("does not throw when notifyUser fails", async () => {
      vi.mocked(notifyUser).mockRejectedValue(new Error("Notify error"));

      await expect(
        WorkspaceNotifications.notifyInvited({
          invitedUserId: "user-2",
          inviterId: "user-1",
          inviterName: "Alice",
          workspaceName: "Test WS",
          token: "token-123",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyAccepted", () => {
    it("calls notifyUser with acceptance details", async () => {
      vi.mocked(notifyUser).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyAccepted({
        inviterId: "user-1",
        userId: "user-2",
        userName: "Bob",
        workspaceName: "Test WS",
        workspaceSlug: "test-ws",
      });

      expect(notifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        senderId: "user-2",
        type: "MEMBER_JOINED",
        title: "Invitation Accepted",
        message: "Bob accepted your invitation to Test WS",
        actionUrl: "/dashboard/workspaces/test-ws",
      });
    });

    it("does not throw when notifyUser fails", async () => {
      vi.mocked(notifyUser).mockRejectedValue(new Error("Notify error"));

      await expect(
        WorkspaceNotifications.notifyAccepted({
          inviterId: "user-1",
          userId: "user-2",
          userName: "Bob",
          workspaceName: "Test WS",
          workspaceSlug: "test-ws",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyAdmins", () => {
    it("calls notifyUsers for all admin members except excluded user", async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: "admin-1",
          user: { id: "admin-1", notifications: true },
          role: "ADMIN",
        },
        {
          userId: "admin-2",
          user: { id: "admin-2", notifications: true },
          role: "ADMIN",
        },
      ] as any);
      vi.mocked(notifyUsers).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyAdmins({
        workspaceId: "ws-1",
        excludeUserId: "user-1",
        senderId: "user-3",
        senderName: "Charlie",
        workspaceName: "Test WS",
        workspaceSlug: "test-ws",
      });

      expect(notifyUsers).toHaveBeenCalledWith([
        {
          userId: "admin-1",
          senderId: "user-3",
          type: "MEMBER_JOINED",
          title: "New Member Joined",
          message: "Charlie joined Test WS",
          actionUrl: "/dashboard/workspaces/test-ws/members",
        },
        {
          userId: "admin-2",
          senderId: "user-3",
          type: "MEMBER_JOINED",
          title: "New Member Joined",
          message: "Charlie joined Test WS",
          actionUrl: "/dashboard/workspaces/test-ws/members",
        },
      ]);
    });

    it("filters out admins with notifications disabled", async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: "admin-1",
          user: { id: "admin-1", notifications: true },
          role: "ADMIN",
        },
        {
          userId: "admin-2",
          user: { id: "admin-2", notifications: false },
          role: "ADMIN",
        },
      ] as any);
      vi.mocked(notifyUsers).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyAdmins({
        workspaceId: "ws-1",
        excludeUserId: "user-1",
        senderId: "user-3",
        senderName: "Charlie",
        workspaceName: "Test WS",
        workspaceSlug: "test-ws",
      });

      expect(notifyUsers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: "admin-1" }),
        ]),
      );
      expect(notifyUsers).toHaveBeenCalledWith(
        expect.not.arrayContaining([
          expect.objectContaining({ userId: "admin-2" }),
        ]),
      );
    });

    it("does not throw when prisma fails", async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        WorkspaceNotifications.notifyAdmins({
          workspaceId: "ws-1",
          excludeUserId: "user-1",
          senderId: "user-3",
          senderName: "Charlie",
          workspaceName: "Test WS",
          workspaceSlug: "test-ws",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyRemoved", () => {
    it("calls notifyUser with removal details", async () => {
      vi.mocked(notifyUser).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyRemoved({
        removedUserId: "user-2",
        removerId: "user-1",
        workspaceName: "Test WS",
      });

      expect(notifyUser).toHaveBeenCalledWith({
        userId: "user-2",
        senderId: "user-1",
        type: "MEMBER_REMOVED",
        title: "Removed from Workspace",
        message: "You have been removed from Test WS",
      });
    });

    it("does not throw when notifyUser fails", async () => {
      vi.mocked(notifyUser).mockRejectedValue(new Error("Notify error"));

      await expect(
        WorkspaceNotifications.notifyRemoved({
          removedUserId: "user-2",
          removerId: "user-1",
          workspaceName: "Test WS",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyRoleChanged", () => {
    it("calls notifyUser with role change details", async () => {
      vi.mocked(notifyUser).mockResolvedValue(undefined);

      await WorkspaceNotifications.notifyRoleChanged({
        userId: "user-2",
        updaterId: "user-1",
        workspaceName: "Test WS",
        workspaceId: "ws-1",
        role: "ADMIN",
      });

      expect(notifyUser).toHaveBeenCalledWith({
        userId: "user-2",
        senderId: "user-1",
        type: "ROLE_UPDATED",
        title: "Role Updated",
        message: "Your role in Test WS has been changed to ADMIN",
        actionUrl: "/dashboard/workspaces/ws-1",
      });
    });

    it("does not throw when notifyUser fails", async () => {
      vi.mocked(notifyUser).mockRejectedValue(new Error("Notify error"));

      await expect(
        WorkspaceNotifications.notifyRoleChanged({
          userId: "user-2",
          updaterId: "user-1",
          workspaceName: "Test WS",
          workspaceId: "ws-1",
          role: "ADMIN",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

