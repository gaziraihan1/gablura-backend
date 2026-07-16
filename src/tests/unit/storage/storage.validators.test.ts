import { describe, it, expect } from 'vitest';
import {
  largestFilesQuerySchema,
  bulkDeleteSchema,
  checkUploadSchema,
} from '../../../modules/storage/storage.validators.js';

describe('storage.validators', () => {
  describe('largestFilesQuerySchema', () => {
    it('should default limit to 10', () => {
      const result = largestFilesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(10);
    });

    it('should accept custom limit', () => {
      const result = largestFilesQuerySchema.safeParse({ limit: '25' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(25);
    });

    it('should reject limit below 1', () => {
      const result = largestFilesQuerySchema.safeParse({ limit: '0' });
      expect(result.success).toBe(false);
    });

    it('should reject limit over 100', () => {
      const result = largestFilesQuerySchema.safeParse({ limit: '101' });
      expect(result.success).toBe(false);
    });
  });

  describe('bulkDeleteSchema', () => {
    it('should accept valid file IDs', () => {
      const result = bulkDeleteSchema.safeParse({ fileIds: ['f1', 'f2'] });
      expect(result.success).toBe(true);
    });

    it('should accept single file ID', () => {
      const result = bulkDeleteSchema.safeParse({ fileIds: ['f1'] });
      expect(result.success).toBe(true);
    });

    it('should reject empty array', () => {
      const result = bulkDeleteSchema.safeParse({ fileIds: [] });
      expect(result.success).toBe(false);
    });

    it('should reject missing fileIds', () => {
      const result = bulkDeleteSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('checkUploadSchema', () => {
    it('should accept valid file size', () => {
      const result = checkUploadSchema.safeParse({ fileSize: 1048576 });
      expect(result.success).toBe(true);
    });

    it('should reject zero file size', () => {
      const result = checkUploadSchema.safeParse({ fileSize: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject negative file size', () => {
      const result = checkUploadSchema.safeParse({ fileSize: -100 });
      expect(result.success).toBe(false);
    });

    it('should accept large file size', () => {
      const result = checkUploadSchema.safeParse({ fileSize: 107374182400 }); // 100 GB
      expect(result.success).toBe(true);
    });
  });
});
