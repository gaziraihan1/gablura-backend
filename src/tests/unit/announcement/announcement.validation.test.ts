import { describe, it, expect } from 'vitest';
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  listAnnouncementsSchema,
} from '../../../modules/announcement/announcement.validation.js';

describe('announcement.validation', () => {
  describe('createAnnouncementSchema', () => {
    it('should accept valid input', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'New Announcement',
        content: 'This is the content',
      });
      expect(result.success).toBe(true);
    });

    it('should default visibility to PUBLIC', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'Content',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.visibility).toBe('PUBLIC');
    });

    it('should default isPinned to false', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'Content',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isPinned).toBe(false);
    });

    it('should default targetIds to empty array', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'Content',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetIds).toEqual([]);
    });

    it('should reject missing title', () => {
      const result = createAnnouncementSchema.safeParse({ content: 'Content' });
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const result = createAnnouncementSchema.safeParse({ title: 'Title' });
      expect(result.success).toBe(false);
    });

    it('should reject title over 200 chars', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'x'.repeat(201),
        content: 'Content',
      });
      expect(result.success).toBe(false);
    });

    it('should reject content over 10000 chars', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'x'.repeat(10001),
      });
      expect(result.success).toBe(false);
    });

    it('should accept PRIVATE visibility', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'Content',
        visibility: 'PRIVATE',
      });
      expect(result.success).toBe(true);
    });

    it('should accept projectId', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Test',
        content: 'Content',
        projectId: 'proj1',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateAnnouncementSchema', () => {
    it('should accept empty object', () => {
      const result = updateAnnouncementSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial updates', () => {
      const result = updateAnnouncementSchema.safeParse({ title: 'New Title' });
      expect(result.success).toBe(true);
    });

    it('should reject empty title', () => {
      const result = updateAnnouncementSchema.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });

    it('should accept isPinned boolean', () => {
      const result = updateAnnouncementSchema.safeParse({ isPinned: true });
      expect(result.success).toBe(true);
    });
  });

  describe('listAnnouncementsSchema', () => {
    it('should accept empty query', () => {
      const result = listAnnouncementsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should default page to 1', () => {
      const result = listAnnouncementsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBe(1);
    });

    it('should default pageSize to 10', () => {
      const result = listAnnouncementsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.pageSize).toBe(10);
    });

    it('should coerce page to number', () => {
      const result = listAnnouncementsSchema.safeParse({ page: '2' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBe(2);
    });

    it('should coerce isPinned to boolean', () => {
      const result = listAnnouncementsSchema.safeParse({ isPinned: 'true' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isPinned).toBe(true);
    });

    it('should reject pageSize over 100', () => {
      const result = listAnnouncementsSchema.safeParse({ pageSize: '101' });
      expect(result.success).toBe(false);
    });
  });
});
