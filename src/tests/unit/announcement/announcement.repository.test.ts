import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    announcement: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspaceMember: { findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    projectMember: { findFirst: vi.fn() },
  },
}));

import { AnnouncementRepository } from '../../../modules/announcement/announcement.repository.js';

describe('AnnouncementRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  const mockAnnouncement = {
    id: 'a1',
    title: 'Test',
    content: 'Content',
    visibility: 'PUBLIC',
    isPinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceSlug: 'ws-slug',
    projectId: null,
    createdById: 'u1',
    createdBy: { id: 'u1', name: 'User', image: null },
    project: null,
    targets: [],
  };

  describe('create', () => {
    it('should create a PUBLIC announcement', async () => {
      vi.mocked(prisma.announcement.create).mockResolvedValue(mockAnnouncement as any);

      const result = await AnnouncementRepository.create({
        title: 'Test',
        content: 'Content',
        visibility: 'PUBLIC',
        workspaceSlug: 'ws-slug',
        createdById: 'u1',
      });

      expect(result.id).toBe('a1');
      expect(result.visibility).toBe('PUBLIC');
    });

    it('should create a PRIVATE announcement with targets', async () => {
      vi.mocked(prisma.announcement.create).mockResolvedValue({
        ...mockAnnouncement,
        visibility: 'PRIVATE',
        targets: [{ userId: 'u2', user: { id: 'u2', name: 'Bob', image: null } }],
      } as any);

      const result = await AnnouncementRepository.create({
        title: 'Private',
        content: 'Secret',
        visibility: 'PRIVATE',
        workspaceSlug: 'ws-slug',
        createdById: 'u1',
        targetIds: ['u2'],
      });

      expect(result.targets).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return announcement by id', async () => {
      vi.mocked(prisma.announcement.findUnique).mockResolvedValue(mockAnnouncement as any);

      const result = await AnnouncementRepository.findById('a1');
      expect(result!.id).toBe('a1');
    });

    it('should return null when not found', async () => {
      vi.mocked(prisma.announcement.findUnique).mockResolvedValue(null);

      const result = await AnnouncementRepository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('should return paginated results', async () => {
      vi.mocked(prisma.announcement.findMany).mockResolvedValue([mockAnnouncement] as any);
      vi.mocked(prisma.announcement.count).mockResolvedValue(1);

      const result = await AnnouncementRepository.findMany({
        workspaceSlug: 'ws-slug',
        userId: 'u1',
        visibility: 'PUBLIC',
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.totalCount).toBe(1);
    });

    it('should apply pagination', async () => {
      vi.mocked(prisma.announcement.findMany).mockResolvedValue([]);
      vi.mocked(prisma.announcement.count).mockResolvedValue(0);

      await AnnouncementRepository.findMany({
        workspaceSlug: 'ws-slug',
        userId: 'u1',
        visibility: 'PUBLIC',
        page: 2,
        pageSize: 5,
      });

      const call = vi.mocked(prisma.announcement.findMany).mock.calls[0]![0];
      expect(call!.skip).toBe(5);
      expect(call!.take).toBe(5);
    });
  });

  describe('update', () => {
    it('should update announcement', async () => {
      vi.mocked(prisma.announcement.update).mockResolvedValue({
        ...mockAnnouncement,
        title: 'Updated',
      } as any);

      const result = await AnnouncementRepository.update('a1', { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should delete announcement', async () => {
      vi.mocked(prisma.announcement.delete).mockResolvedValue({} as any);

      await AnnouncementRepository.delete('a1');
      expect(prisma.announcement.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    });
  });

  describe('isWorkspaceGuest', () => {
    it('should return true for GUEST role', async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: 'GUEST' } as any);

      const result = await AnnouncementRepository.isWorkspaceGuest('ws-slug', 'u1');
      expect(result).toBe(true);
    });

    it('should return false for non-GUEST role', async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: 'MEMBER' } as any);

      const result = await AnnouncementRepository.isWorkspaceGuest('ws-slug', 'u1');
      expect(result).toBe(false);
    });

    it('should return false for non-member', async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);

      const result = await AnnouncementRepository.isWorkspaceGuest('ws-slug', 'u1');
      expect(result).toBe(false);
    });
  });

  describe('isPUblicWorkspace', () => {
    it('should return true for public workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ isPublic: true } as any);

      const result = await AnnouncementRepository.isPUblicWorkspace('ws-slug');
      expect(result).toBe(true);
    });

    it('should return false for non-public workspace', async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ isPublic: false } as any);

      const result = await AnnouncementRepository.isPUblicWorkspace('ws-slug');
      expect(result).toBe(false);
    });
  });
});
