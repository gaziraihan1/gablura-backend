import { describe, it, expect } from 'vitest';
import { getLimitsForPlan, bytesToMB, getTodayStart, getTodayEnd } from '../../../modules/attachment/attachment.utils.js';

describe('attachment.utils', () => {
  describe('getLimitsForPlan', () => {
    it('should return limits for PRO plan', () => {
      const limits = getLimitsForPlan('PRO');
      expect(limits).toHaveProperty('maxFileSizeMB');
      expect(limits).toHaveProperty('maxDailyUploads');
    });

    it('should return FREE limits for unknown plan', () => {
      const limits = getLimitsForPlan('UNKNOWN');
      const freeLimits = getLimitsForPlan('FREE');
      expect(limits).toEqual(freeLimits);
    });

    it('should return FREE limits as default', () => {
      const limits = getLimitsForPlan('FREE');
      expect(limits).toBeDefined();
    });
  });

  describe('bytesToMB', () => {
    it('should convert 1MB to 1', () => {
      expect(bytesToMB(1048576)).toBe(1);
    });

    it('should convert 0 to 0', () => {
      expect(bytesToMB(0)).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      expect(bytesToMB(1572864)).toBe(1.5);
    });

    it('should handle large values', () => {
      expect(bytesToMB(1073741824)).toBe(1024);
    });
  });

  describe('getTodayStart', () => {
    it('should return date with hours/minutes/seconds/milliseconds at 0', () => {
      const result = getTodayStart();
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });
  });

  describe('getTodayEnd', () => {
    it('should return date with hours=23, minutes=59, seconds=59, ms=999', () => {
      const result = getTodayEnd();
      expect(result.getHours()).toBe(23);
      expect(result.getMinutes()).toBe(59);
      expect(result.getSeconds()).toBe(59);
      expect(result.getMilliseconds()).toBe(999);
    });
  });
});
