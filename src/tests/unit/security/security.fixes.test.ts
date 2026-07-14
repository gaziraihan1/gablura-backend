import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock prisma (must use vi.hoisted for vi.mock factory access) ───────────────
const mockPrisma = vi.hoisted(() => ({
  notification: {
    update: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  workspaceMember: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  workspace: {
    findUnique: vi.fn(),
  },
  contactMessage: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

// Mock cache client to avoid Redis dependency
vi.mock('../../../lib/redis/cache.client.js', () => ({
  CacheClient: { get: vi.fn(), set: vi.fn(), getOrSet: vi.fn((_k: any, fn: any) => fn()), invalidate: vi.fn() },
  CACHE_KEYS: { workspaceMember: vi.fn(), workspaceAdmin: vi.fn(), workspaceOwner: vi.fn() },
  CACHE_TTL: { ACCESS_CONTROL_WORKSPACE_MEMBER: 60, ACCESS_CONTROL_WORKSPACE_ADMIN: 60, ACCESS_CONTROL_WORKSPACE_OWNER: 60 },
  WorkspaceCache: { invalidateMembers: vi.fn(), invalidateUserWorkspaces: vi.fn(), invalidateWorkspace: vi.fn() },
  AccessControlCache: { invalidateWorkspaceAccess: vi.fn(), invalidateWorkspaceUsers: vi.fn() },
}));

// Mock queue to avoid Redis dependency
vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn().mockReturnValue({ catch: vi.fn() }),
  addSendEmailJob: vi.fn().mockReturnValue({ catch: vi.fn() }),
  addSendNotificationJob: vi.fn().mockReturnValue({ catch: vi.fn() }),
}));

// Mock email to avoid SMTP
vi.mock('../../../utils/email.js', () => ({
  sendInvitationEmail: vi.fn(),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────
import { NotificationMutation } from '../../../modules/notification/notification.mutation.js';
import { WorkspaceMutation } from '../../../modules/workspace/workspace.mutation.js';
import { getContactMessages } from '../../../modules/contact/contact.service.js';

describe('Security Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FIX: Notification IDOR — markAsRead/deleteNotification require userId
  // ──────────────────────────────────────────────────────────────────────────
  describe('Notification IDOR Prevention', () => {
    it('markAsRead includes userId in where clause', async () => {
      mockPrisma.notification.update.mockResolvedValue({ id: 'n1', read: true });

      await NotificationMutation.markAsRead('n1', 'user-abc');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'user-abc' },
        data: { read: true, readAt: expect.any(Date) },
      });
    });

    it('deleteNotification includes userId in where clause', async () => {
      mockPrisma.notification.delete.mockResolvedValue(undefined);

      await NotificationMutation.deleteNotification('n1', 'user-abc');

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'user-abc' },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FIX: Workspace member IDOR — verify memberId belongs to workspace
  // ──────────────────────────────────────────────────────────────────────────
  describe('Workspace Member IDOR Prevention', () => {
    it('removeMember rejects memberId from different workspace', async () => {
      // Admin check passes
      mockPrisma.workspaceMember.findFirst.mockResolvedValue({ id: 'admin-member', role: 'ADMIN' });
      // Member found but belongs to different workspace
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'workspace-B',
        user: { id: 'u1', name: 'Test', notifications: true },
        workspace: { name: 'Other Workspace' },
      });

      await expect(
        WorkspaceMutation.removeMember('workspace-A', 'admin-id', 'member-1')
      ).rejects.toThrow('Member');
    });

    it('removeMember succeeds when memberId belongs to workspace', async () => {
      mockPrisma.workspaceMember.findFirst.mockResolvedValue({ id: 'admin-member', role: 'ADMIN' });
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'workspace-A',
        user: { id: 'u1', name: 'Test', notifications: true },
        workspace: { name: 'My Workspace' },
      });
      mockPrisma.workspaceMember.delete.mockResolvedValue(undefined);

      await WorkspaceMutation.removeMember('workspace-A', 'admin-id', 'member-1');

      expect(mockPrisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { id: 'member-1' },
      });
    });

    it('updateMemberRole rejects invalid role', async () => {
      await expect(
        WorkspaceMutation.updateMemberRole('ws1', 'owner-id', 'member-1', 'SUPER_ADMIN' as any)
      ).rejects.toThrow('Invalid role');
    });

    it('updateMemberRole rejects memberId from different workspace', async () => {
      // Owner check passes
      mockPrisma.workspaceMember.findFirst.mockResolvedValue({ id: 'owner', role: 'OWNER', workspace: { name: 'WS' } });
      // Target member belongs to different workspace
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'workspace-B',
      });

      await expect(
        WorkspaceMutation.updateMemberRole('workspace-A', 'owner-id', 'member-1', 'ADMIN')
      ).rejects.toThrow('Member');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FIX: Contact enum validation — invalid status/category filtered out
  // ──────────────────────────────────────────────────────────────────────────
  describe('Contact Enum Validation', () => {
    it('filters out invalid status values', async () => {
      mockPrisma.contactMessage.findMany.mockResolvedValue([]);
      mockPrisma.contactMessage.count.mockResolvedValue(0);

      await getContactMessages({
        page: 1,
        limit: 10,
        status: 'INVALID_STATUS',
      });

      expect(mockPrisma.contactMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ status: 'INVALID_STATUS' }),
        })
      );
    });

    it('filters out invalid category values', async () => {
      mockPrisma.contactMessage.findMany.mockResolvedValue([]);
      mockPrisma.contactMessage.count.mockResolvedValue(0);

      await getContactMessages({
        page: 1,
        limit: 10,
        category: '<script>alert(1)</script>',
      });

      expect(mockPrisma.contactMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ category: '<script>alert(1)</script>' }),
        })
      );
    });

    it('passes valid status values through', async () => {
      mockPrisma.contactMessage.findMany.mockResolvedValue([]);
      mockPrisma.contactMessage.count.mockResolvedValue(0);

      await getContactMessages({
        page: 1,
        limit: 10,
        status: 'READ',
      });

      expect(mockPrisma.contactMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'READ' }),
        })
      );
    });
  });
});
