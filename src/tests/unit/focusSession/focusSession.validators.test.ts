import { describe, it, expect } from 'vitest';
import {
  startSessionSchema,
  getHistorySchema,
  getStatsSchema,
} from '../../../modules/focusSession/focusSession.validators.js';

describe('focusSession.validators', () => {
  describe('startSessionSchema', () => {
    it('should accept valid POMODORO session', () => {
      const result = startSessionSchema.safeParse({ type: 'POMODORO', duration: 25 });
      expect(result.success).toBe(true);
    });

    it('should accept valid DEEP_WORK session', () => {
      const result = startSessionSchema.safeParse({ type: 'DEEP_WORK', duration: 120 });
      expect(result.success).toBe(true);
    });

    it('should accept optional taskId', () => {
      const result = startSessionSchema.safeParse({ type: 'POMODORO', duration: 25, taskId: 't1' });
      expect(result.success).toBe(true);
    });

    it('should accept all valid session types', () => {
      for (const type of ['POMODORO', 'SHORT_BREAK', 'LONG_BREAK', 'DEEP_WORK', 'CUSTOM']) {
        expect(startSessionSchema.safeParse({ type, duration: 10 }).success).toBe(true);
      }
    });

    it('should reject invalid session type', () => {
      const result = startSessionSchema.safeParse({ type: 'INVALID', duration: 10 });
      expect(result.success).toBe(false);
    });

    it('should reject duration below 1', () => {
      const result = startSessionSchema.safeParse({ type: 'POMODORO', duration: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject duration above 480', () => {
      const result = startSessionSchema.safeParse({ type: 'POMODORO', duration: 481 });
      expect(result.success).toBe(false);
    });

    it('should accept duration at boundaries (1 and 480)', () => {
      expect(startSessionSchema.safeParse({ type: 'POMODORO', duration: 1 }).success).toBe(true);
      expect(startSessionSchema.safeParse({ type: 'POMODORO', duration: 480 }).success).toBe(true);
    });
  });

  describe('getHistorySchema', () => {
    it('should default limit to 30', () => {
      const result = getHistorySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(30);
    });

    it('should accept custom limit', () => {
      const result = getHistorySchema.safeParse({ limit: '50' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(50);
    });

    it('should reject limit over 100', () => {
      const result = getHistorySchema.safeParse({ limit: '101' });
      expect(result.success).toBe(false);
    });
  });

  describe('getStatsSchema', () => {
    it('should accept empty query', () => {
      const result = getStatsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional dates', () => {
      const result = getStatsSchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
    });
  });
});
