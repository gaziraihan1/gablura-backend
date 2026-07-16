import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingQuery } from '../../../modules/meeting/meeting.query.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    meeting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../modules/meeting/meeting.select.js', () => ({
  meetingSelect: { id: true, title: true, attendees: true },
}));

describe('MeetingQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('listForUser', () => {
    it('should return meetings with pagination', async () => {
      const mockMeetings = [
        { id: 'm1', title: 'Meeting 1' },
        { id: 'm2', title: 'Meeting 2' },
      ];
      vi.mocked(prisma.meeting.findMany).mockResolvedValue(mockMeetings as any);
      vi.mocked(prisma.meeting.count).mockResolvedValue(2);

      const result = await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
      });

      expect(result.meetings).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.nextCursor).toBeNull();
    });

    it('should apply admin filter (no OR condition)', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      const where = call.where as any;
      expect(where.OR).toBeUndefined();
    });

    it('should apply non-admin filter (OR for PUBLIC or attendee)', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: false,
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      const where = call.where as any;
      expect(where.OR).toBeDefined();
      expect(where.OR).toHaveLength(2);
    });

    it('should filter by status when provided', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
        status: 'SCHEDULED',
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      expect((call.where as any).status).toBe('SCHEDULED');
    });

    it('should filter upcoming meetings when requested', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
        upcoming: true,
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      const where = call.where as any;
      expect(where.startTime.gte).toBeInstanceOf(Date);
    });

    it('should cap limit at 50', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
        limit: 100,
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      expect(call.take).toBe(50);
    });

    it('should return nextCursor when more results exist', async () => {
      const meetings = Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        title: `Meeting ${i}`,
      }));
      vi.mocked(prisma.meeting.findMany).mockResolvedValue(meetings as any);
      vi.mocked(prisma.meeting.count).mockResolvedValue(25);

      const result = await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
        limit: 20,
      });

      expect(result.nextCursor).toBe('m19');
    });

    it('should use cursor-based pagination when cursor provided', async () => {
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([]);
      vi.mocked(prisma.meeting.count).mockResolvedValue(0);

      await MeetingQuery.listForUser({
        workspaceId: 'ws1',
        userId: 'u1',
        isAdmin: true,
        cursor: 'm5',
      });

      const call = vi.mocked(prisma.meeting.findMany).mock.calls[0][0];
      expect(call.cursor).toEqual({ id: 'm5' });
      expect(call.skip).toBe(1);
    });
  });

  describe('findById', () => {
    it('should return meeting by id', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue({
        id: 'm1',
        title: 'Test',
      } as any);

      const result = await MeetingQuery.findById('m1');
      expect(result!.id).toBe('m1');
    });

    it('should return null when not found', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue(null);

      const result = await MeetingQuery.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('canUserAccess', () => {
    it('should return true for admin', async () => {
      const result = await MeetingQuery.canUserAccess('m1', 'u1', true);
      expect(result).toBe(true);
      expect(prisma.meeting.findUnique).not.toHaveBeenCalled();
    });

    it('should return true for PUBLIC meeting', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue({
        visibility: 'PUBLIC',
        attendees: [],
      } as any);

      const result = await MeetingQuery.canUserAccess('m1', 'u1', false);
      expect(result).toBe(true);
    });

    it('should return true when user is an attendee', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue({
        visibility: 'PRIVATE',
        attendees: [{ id: 'a1', userId: 'u1' }],
      } as any);

      const result = await MeetingQuery.canUserAccess('m1', 'u1', false);
      expect(result).toBe(true);
    });

    it('should return false when meeting not found', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue(null);

      const result = await MeetingQuery.canUserAccess('m1', 'u1', false);
      expect(result).toBe(false);
    });

    it('should return false for PRIVATE meeting when user is not attendee', async () => {
      vi.mocked(prisma.meeting.findUnique).mockResolvedValue({
        visibility: 'PRIVATE',
        attendees: [],
      } as any);

      const result = await MeetingQuery.canUserAccess('m1', 'u1', false);
      expect(result).toBe(false);
    });
  });
});
