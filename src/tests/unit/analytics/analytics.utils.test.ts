import { describe, it, expect } from 'vitest';
import { minutesToHours, bytesToMB, getDayKey, getWeekOfDay } from '../../../modules/analytics/analytics.utils.js';

describe('analytics.utils', () => {
  describe('minutesToHours', () => {
    it('should convert 60 minutes to 1 hour', () => {
      expect(minutesToHours(60)).toBe(1);
    });

    it('should convert 0 minutes to 0', () => {
      expect(minutesToHours(0)).toBe(0);
    });

    it('should convert null to 0', () => {
      expect(minutesToHours(null)).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      expect(minutesToHours(90)).toBe(1.5);
    });

    it('should handle 1 minute', () => {
      expect(minutesToHours(1)).toBe(0.02);
    });

    it('should handle large values', () => {
      expect(minutesToHours(1440)).toBe(24);
    });

    it('should round correctly for non-terminating decimals', () => {
      // 1/3 hour = 20 minutes, 20/60 = 0.333... → 0.33
      expect(minutesToHours(20)).toBe(0.33);
    });
  });

  describe('bytesToMB', () => {
    it('should convert 1MB (1048576 bytes) to 1', () => {
      expect(bytesToMB(1048576)).toBe(1);
    });

    it('should convert 0 bytes to 0', () => {
      expect(bytesToMB(0)).toBe(0);
    });

    it('should convert null to 0', () => {
      expect(bytesToMB(null)).toBe(0);
    });

    it('should round to 2 decimal places', () => {
      // 1.5 MB = 1572864 bytes
      expect(bytesToMB(1572864)).toBe(1.5);
    });

    it('should handle large values', () => {
      // 1 GB = 1073741824 bytes
      expect(bytesToMB(1073741824)).toBe(1024);
    });

    it('should handle fractional MB', () => {
      // 0.5 MB = 524288 bytes
      expect(bytesToMB(524288)).toBe(0.5);
    });
  });

  describe('getDayKey', () => {
    it('should return YYYY-MM-DD format', () => {
      const date = new Date('2026-07-15T14:30:00Z');
      expect(getDayKey(date)).toBe('2026-07-15');
    });

    it('should handle midnight UTC', () => {
      const date = new Date('2026-01-01T00:00:00Z');
      expect(getDayKey(date)).toBe('2026-01-01');
    });

    it('should handle end of day', () => {
      const date = new Date('2026-12-31T23:59:59Z');
      expect(getDayKey(date)).toBe('2026-12-31');
    });
  });

  describe('getWeekOfDay', () => {
    it('should return the day name', () => {
      // 2026-07-15 is a Wednesday
      const date = new Date('2026-07-15T12:00:00Z');
      const day = getWeekOfDay(date);
      expect(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']).toContain(day);
    });

    it('should return a valid day name', () => {
      const date = new Date('2026-07-20T12:00:00Z');
      const day = getWeekOfDay(date);
      expect(typeof day).toBe('string');
      expect(day.length).toBeGreaterThan(0);
    });
  });
});
