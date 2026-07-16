import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('../../../queue/index.js', () => ({
  addSendNotificationJob: vi.fn().mockResolvedValue(undefined),
  addNotifyWorkspaceMembersJob: vi.fn().mockResolvedValue(undefined),
}));

import {
  notifyMeetingCreatedPrivate,
  notifyMeetingCreatedPublic,
  notifyMeetingUpdated,
  notifyMeetingCancelled,
} from '../../../modules/meeting/meeting.notification.js';
import { addSendNotificationJob, addNotifyWorkspaceMembersJob } from '../../../queue/index.js';

describe('meeting.notification', () => {
  beforeEach(() => vi.clearAllMocks());

  const mockMeeting = {
    id: 'm1',
    title: 'Team Standup',
    startTime: new Date('2026-07-20T10:00:00Z'),
    visibility: 'PUBLIC' as const,
    attendees: [
      { userId: 'u1', user: { name: 'Alice' } },
      { userId: 'u2', user: { name: 'Bob' } },
    ],
  };

  const mockWorkspace = { slug: 'my-workspace' };

  beforeEach(() => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
  });

  describe('notifyMeetingCreatedPrivate', () => {
    it('should send notifications to attendees excluding sender', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u2', notifications: true },
      ] as any);

      await notifyMeetingCreatedPrivate({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addSendNotificationJob).toHaveBeenCalledTimes(1);
      expect(addSendNotificationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u2',
          type: 'MEETING_CREATED',
        }),
      );
    });

    it('should skip users with notifications disabled', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u2', notifications: false },
      ] as any);

      await notifyMeetingCreatedPrivate({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addSendNotificationJob).not.toHaveBeenCalled();
    });

    it('should do nothing when no attendees besides sender', async () => {
      const singleUserMeeting = {
        ...mockMeeting,
        attendees: [{ userId: 'u1', user: { name: 'Alice' } }],
      };

      await notifyMeetingCreatedPrivate({
        meeting: singleUserMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addSendNotificationJob).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('notifyMeetingCreatedPublic', () => {
    it('should notify all workspace members', async () => {
      await notifyMeetingCreatedPublic({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addNotifyWorkspaceMembersJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          senderId: 'u1',
          type: 'MEETING_CREATED',
          excludeUserId: 'u1',
        }),
      );
    });
  });

  describe('notifyMeetingUpdated', () => {
    it('should notify all workspace members for PUBLIC meeting by admin', async () => {
      await notifyMeetingUpdated({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
        isAdmin: true,
      });

      expect(addNotifyWorkspaceMembersJob).toHaveBeenCalled();
      expect(addSendNotificationJob).not.toHaveBeenCalled();
    });

    it('should notify only attendees for PRIVATE meeting', async () => {
      const privateMeeting = { ...mockMeeting, visibility: 'PRIVATE' };
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u2', notifications: true },
      ] as any);

      await notifyMeetingUpdated({
        meeting: privateMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
        isAdmin: true,
      });

      expect(addSendNotificationJob).toHaveBeenCalled();
      expect(addNotifyWorkspaceMembersJob).not.toHaveBeenCalled();
    });

    it('should notify only attendees for non-admin even PUBLIC', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u2', notifications: true },
      ] as any);

      await notifyMeetingUpdated({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
        isAdmin: false,
      });

      expect(addSendNotificationJob).toHaveBeenCalled();
      expect(addNotifyWorkspaceMembersJob).not.toHaveBeenCalled();
    });
  });

  describe('notifyMeetingCancelled', () => {
    it('should notify all workspace members for PUBLIC meeting', async () => {
      await notifyMeetingCancelled({
        meeting: mockMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addNotifyWorkspaceMembersJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MEETING_CANCELLED',
        }),
      );
    });

    it('should notify only attendees for PRIVATE meeting', async () => {
      const privateMeeting = { ...mockMeeting, visibility: 'PRIVATE' };
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u2', notifications: true },
      ] as any);

      await notifyMeetingCancelled({
        meeting: privateMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addSendNotificationJob).toHaveBeenCalled();
    });

    it('should do nothing when no attendees besides sender', async () => {
      const singleUserMeeting = {
        ...mockMeeting,
        visibility: 'PRIVATE',
        attendees: [{ userId: 'u1', user: { name: 'Alice' } }],
      };

      await notifyMeetingCancelled({
        meeting: singleUserMeeting as any,
        workspaceId: 'ws1',
        senderId: 'u1',
        senderName: 'Alice',
      });

      expect(addSendNotificationJob).not.toHaveBeenCalled();
    });
  });
});
