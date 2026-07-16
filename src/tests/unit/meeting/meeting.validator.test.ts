import { describe, it, expect } from 'vitest';
import {
  createMeetingSchema,
  updateMeetingSchema,
  listMeetingsSchema,
} from '../../../modules/meeting/meeting.validator.js';

describe('meeting.validator', () => {
  describe('createMeetingSchema', () => {
    const validInput = {
      title: 'Team Standup',
      visibility: 'PUBLIC',
      startTime: '2026-07-20T10:00:00Z',
      endTime: '2026-07-20T11:00:00Z',
    };

    it('should accept valid minimal input', () => {
      const result = createMeetingSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept with all optional fields', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        description: 'Weekly sync',
        link: 'https://meet.google.com/abc',
        location: 'Room 101',
        attendeeIds: ['clx1234567890abcdef', 'clx0987654321fedcba'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty string for link', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        link: '',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing title', () => {
      const result = createMeetingSchema.safeParse({
        visibility: 'PUBLIC',
        startTime: '2026-07-20T10:00:00Z',
        endTime: '2026-07-20T11:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding 200 chars', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        title: 'x'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('should accept title at exactly 200 chars', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        title: 'x'.repeat(200),
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid visibility', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        visibility: 'HIDDEN',
      });
      expect(result.success).toBe(false);
    });

    it('should accept PUBLIC and PRIVATE visibility', () => {
      expect(createMeetingSchema.safeParse({ ...validInput, visibility: 'PUBLIC' }).success).toBe(true);
      expect(createMeetingSchema.safeParse({ ...validInput, visibility: 'PRIVATE' }).success).toBe(true);
    });

    it('should reject invalid startTime', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        startTime: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid endTime', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        endTime: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid link URL', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        link: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid attendeeIds', () => {
      const result = createMeetingSchema.safeParse({
        ...validInput,
        attendeeIds: ['clx1234567890abcdef', 'clx0987654321fedcba'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateMeetingSchema', () => {
    it('should accept empty object (all fields optional)', () => {
      const result = updateMeetingSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial updates', () => {
      const result = updateMeetingSchema.safeParse({ title: 'New Title' });
      expect(result.success).toBe(true);
    });

    it('should accept null for nullable fields', () => {
      const result = updateMeetingSchema.safeParse({
        description: null,
        link: null,
        location: null,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid status values', () => {
      const statuses = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'];
      for (const status of statuses) {
        const result = updateMeetingSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid status', () => {
      const result = updateMeetingSchema.safeParse({ status: 'PENDING' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid visibility', () => {
      const result = updateMeetingSchema.safeParse({ visibility: 'HIDDEN' });
      expect(result.success).toBe(false);
    });

    it('should accept attendeeIds array', () => {
      const result = updateMeetingSchema.safeParse({ attendeeIds: ['clx1234567890abcdef'] });
      expect(result.success).toBe(true);
    });

    it('should accept empty attendeeIds array', () => {
      const result = updateMeetingSchema.safeParse({ attendeeIds: [] });
      expect(result.success).toBe(true);
    });
  });

  describe('listMeetingsSchema', () => {
    it('should accept empty query', () => {
      const result = listMeetingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept valid status filter', () => {
      const result = listMeetingsSchema.safeParse({ status: 'SCHEDULED' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = listMeetingsSchema.safeParse({ status: 'INVALID' });
      expect(result.success).toBe(false);
    });

    it('should transform "true" string to boolean for upcoming', () => {
      const result = listMeetingsSchema.safeParse({ upcoming: 'true' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upcoming).toBe(true);
      }
    });

    it('should transform "false" string to boolean for upcoming', () => {
      const result = listMeetingsSchema.safeParse({ upcoming: 'false' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upcoming).toBe(false);
      }
    });

    it('should transform limit string to number', () => {
      const result = listMeetingsSchema.safeParse({ limit: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(10);
      }
    });

    it('should reject limit less than 1', () => {
      const result = listMeetingsSchema.safeParse({ limit: '0' });
      expect(result.success).toBe(false);
    });

    it('should reject limit greater than 50', () => {
      const result = listMeetingsSchema.safeParse({ limit: '51' });
      expect(result.success).toBe(false);
    });

    it('should accept limit of 50', () => {
      const result = listMeetingsSchema.safeParse({ limit: '50' });
      expect(result.success).toBe(true);
    });

    it('should accept cursor string', () => {
      const result = listMeetingsSchema.safeParse({ cursor: 'm1' });
      expect(result.success).toBe(true);
    });
  });
});
