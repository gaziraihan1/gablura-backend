import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../redis/redis.client.js', () => ({
  getRedisClient: vi.fn(),
}));

import { getStorageLimits, formatBytes } from '../../../modules/attachment/attatchment.quota.service.js';
import { getRedisClient } from '../../../redis/redis.client.js';

describe('attachment.quota.service (pure functions)', () => {
  const GB = 1024 * 1024 * 1024;

  describe('getStorageLimits', () => {
    it('should return ENTERPRISE limits', () => {
      const limits = getStorageLimits('ENTERPRISE');
      expect(limits.maxStorageBytes).toBe(200 * GB);
      expect(limits.maxFileSizeBytes).toBe(500 * 1024 * 1024);
      expect(limits.maxDailyUploadsPerUser).toBeNull();
      expect(limits.uploadsPerMinute).toBeNull();
    });

    it('should return BUSINESS limits', () => {
      const limits = getStorageLimits('BUSINESS');
      expect(limits.maxStorageBytes).toBe(100 * GB);
      expect(limits.maxFileSizeBytes).toBe(100 * 1024 * 1024);
      expect(limits.uploadsPerMinute).toBe(30);
    });

    it('should return PRO limits', () => {
      const limits = getStorageLimits('PRO');
      expect(limits.maxStorageBytes).toBe(10 * GB);
      expect(limits.maxFileSizeBytes).toBe(25 * 1024 * 1024);
      expect(limits.maxDailyUploadsPerUser).toBe(100);
      expect(limits.uploadsPerMinute).toBe(10);
      expect(limits.uploadsPerHour).toBe(60);
    });

    it('should return FREE limits for FREE plan', () => {
      const limits = getStorageLimits('FREE');
      expect(limits.maxStorageBytes).toBe(1 * GB);
      expect(limits.maxFileSizeBytes).toBe(5 * 1024 * 1024);
      expect(limits.maxDailyUploadsPerUser).toBe(10);
      expect(limits.uploadsPerMinute).toBe(2);
      expect(limits.uploadsPerHour).toBe(10);
    });

    it('should return FREE limits for unknown plan', () => {
      const limits = getStorageLimits('UNKNOWN' as any);
      expect(limits.maxStorageBytes).toBe(1 * GB);
    });
  });

  describe('formatBytes', () => {
    it('should format 0 as "0 B"', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format KB', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('should format MB', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('should format GB', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    it('should format TB', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });

    it('should handle fractional values', () => {
      const result = formatBytes(1536); // 1.5 KB
      expect(result).toBe('1.5 KB');
    });

    it('should handle large fractional values', () => {
      const result = formatBytes(1572864); // 1.5 MB
      expect(result).toBe('1.5 MB');
    });
  });
});
