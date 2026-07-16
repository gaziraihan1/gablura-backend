import { describe, it, expect } from 'vitest';
import { createCommentSchema, updateCommentSchema } from '../../../modules/comment/comment.validators.js';

describe('comment.validators', () => {
  describe('createCommentSchema', () => {
    it('should accept valid comment with content only', () => {
      const result = createCommentSchema.safeParse({ content: 'Hello' });
      expect(result.success).toBe(true);
    });

    it('should accept valid comment with parentId', () => {
      const result = createCommentSchema.safeParse({ content: 'Reply', parentId: 'parent1' });
      expect(result.success).toBe(true);
    });

    it('should accept null parentId', () => {
      const result = createCommentSchema.safeParse({ content: 'Reply', parentId: null });
      expect(result.success).toBe(true);
    });

    it('should accept undefined parentId', () => {
      const result = createCommentSchema.safeParse({ content: 'Reply' });
      expect(result.success).toBe(true);
    });

    it('should reject empty content', () => {
      const result = createCommentSchema.safeParse({ content: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const result = createCommentSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject content exceeding 5000 characters', () => {
      const result = createCommentSchema.safeParse({ content: 'x'.repeat(5001) });
      expect(result.success).toBe(false);
    });

    it('should accept content at exactly 5000 characters', () => {
      const result = createCommentSchema.safeParse({ content: 'x'.repeat(5000) });
      expect(result.success).toBe(true);
    });
  });

  describe('updateCommentSchema', () => {
    it('should accept valid update content', () => {
      const result = updateCommentSchema.safeParse({ content: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('should reject empty content', () => {
      const result = updateCommentSchema.safeParse({ content: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const result = updateCommentSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject content exceeding 5000 characters', () => {
      const result = updateCommentSchema.safeParse({ content: 'x'.repeat(5001) });
      expect(result.success).toBe(false);
    });
  });
});
