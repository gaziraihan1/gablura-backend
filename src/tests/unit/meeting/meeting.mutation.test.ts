import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingMutation } from '../../../modules/meeting/meeting.mutation.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    meeting: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    meetingAttendee: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('MeetingMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  const mockMeetingSelect = {
    id: 'm1',
    title: 'Test Meeting',
    description: 'Desc',
    link: null,
    location: null,
    visibility: 'PUBLIC',
    status: 'SCHEDULED',
    startTime: new Date(),
    endTime: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: 'ws1',
    createdById: 'u1',
    createdBy: { id: 'u1', name: 'User', email: 'u@test.com', image: null },
    attendees: [],
  };

  describe('create', () => {
    it('should create a meeting with required fields', async () => {
      vi.mocked(prisma.meeting.create).mockResolvedValue(mockMeetingSelect as any);

      const result = await MeetingMutation.create({
        input: {
          title: 'Test Meeting',
          visibility: 'PUBLIC',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
        },
        workspaceId: 'ws1',
        createdById: 'u1',
      });

      expect(result.id).toBe('m1');
      expect(prisma.meeting.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Test Meeting',
            workspaceId: 'ws1',
            createdById: 'u1',
          }),
        }),
      );
    });

    it('should create meeting with attendees', async () => {
      vi.mocked(prisma.meeting.create).mockResolvedValue({
        ...mockMeetingSelect,
        attendees: [{ id: 'a1', userId: 'u2' }],
      } as any);

      const result = await MeetingMutation.create({
        input: {
          title: 'Team Meeting',
          visibility: 'PRIVATE',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
          attendeeIds: ['u2', 'u3'],
        },
        workspaceId: 'ws1',
        createdById: 'u1',
      });

      expect(result.attendees).toHaveLength(1);
    });

    it('should convert startTime and endTime to Date objects', async () => {
      vi.mocked(prisma.meeting.create).mockResolvedValue(mockMeetingSelect as any);

      const startStr = '2026-07-20T10:00:00Z';
      const endStr = '2026-07-20T11:00:00Z';

      await MeetingMutation.create({
        input: {
          title: 'Meeting',
          visibility: 'PUBLIC',
          startTime: startStr,
          endTime: endStr,
        },
        workspaceId: 'ws1',
        createdById: 'u1',
      });

      const call = vi.mocked(prisma.meeting.create).mock.calls[0][0];
      expect(call.data.startTime).toBeInstanceOf(Date);
      expect(call.data.endTime).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('should update meeting fields', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          meeting: {
            update: vi.fn().mockResolvedValue({ id: 'm1', title: 'Updated' }),
          },
          meetingAttendee: {
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
        };
        return fn(tx);
      });

      const result = await MeetingMutation.update({
        meetingId: 'm1',
        input: { title: 'Updated' },
      });

      expect(result.title).toBe('Updated');
    });

    it('should replace attendees when attendeeIds is provided', async () => {
      let capturedDeleteMany: any;
      let capturedCreateMany: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          meeting: {
            update: vi.fn().mockResolvedValue({ id: 'm1' }),
          },
          meetingAttendee: {
            deleteMany: vi.fn().mockImplementation((args: any) => { capturedDeleteMany = args; }),
            createMany: vi.fn().mockImplementation((args: any) => { capturedCreateMany = args; }),
          },
        };
        return fn(tx);
      });

      await MeetingMutation.update({
        meetingId: 'm1',
        input: { attendeeIds: ['u2', 'u3'] },
      });

      expect(capturedDeleteMany.where).toEqual({ meetingId: 'm1' });
      expect(capturedCreateMany.data).toHaveLength(2);
    });

    it('should delete all attendees when empty array provided', async () => {
      let capturedCreateMany: any;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          meeting: {
            update: vi.fn().mockResolvedValue({ id: 'm1' }),
          },
          meetingAttendee: {
            deleteMany: vi.fn(),
            createMany: vi.fn().mockImplementation((args: any) => { capturedCreateMany = args; }),
          },
        };
        return fn(tx);
      });

      await MeetingMutation.update({
        meetingId: 'm1',
        input: { attendeeIds: [] },
      });

      expect(capturedCreateMany).toBeUndefined();
    });

    it('should not touch attendees when attendeeIds is undefined', async () => {
      let deleteManyCalled = false;

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const tx = {
          meeting: {
            update: vi.fn().mockResolvedValue({ id: 'm1' }),
          },
          meetingAttendee: {
            deleteMany: vi.fn().mockImplementation(() => { deleteManyCalled = true; }),
            createMany: vi.fn(),
          },
        };
        return fn(tx);
      });

      await MeetingMutation.update({
        meetingId: 'm1',
        input: { title: 'New Title' },
      });

      expect(deleteManyCalled).toBe(false);
    });
  });

  describe('cancel', () => {
    it('should set meeting status to CANCELLED', async () => {
      vi.mocked(prisma.meeting.update).mockResolvedValue({
        ...mockMeetingSelect,
        status: 'CANCELLED',
      } as any);

      const result = await MeetingMutation.cancel('m1');

      expect(result.status).toBe('CANCELLED');
      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { status: 'CANCELLED' },
        select: expect.any(Object),
      });
    });
  });

  describe('delete', () => {
    it('should delete the meeting', async () => {
      vi.mocked(prisma.meeting.delete).mockResolvedValue({} as any);

      await MeetingMutation.delete('m1');

      expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });
  });
});
