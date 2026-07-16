import { describe, it, expect } from 'vitest';
import {
  getDailyTasksSchema,
  addDailyTaskSchema,
  removeDailyTaskSchema,
  dailyTaskStatsSchema,
} from '../../../modules/dailyTask/dailyTask.validators.js';

describe('dailyTask.validators', () => {
  describe('getDailyTasksSchema', () => {
    it('should accept empty input (date is optional)', () => {
      const result = getDailyTasksSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept a valid date string', () => {
      const result = getDailyTasksSchema.safeParse({ date: '2026-07-15' });
      expect(result.success).toBe(true);
    });

    it('should coerce string to Date', () => {
      const result = getDailyTasksSchema.safeParse({ date: '2026-07-15' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.date).toBeInstanceOf(Date);
      }
    });
  });

  describe('addDailyTaskSchema', () => {
    it('should accept valid PRIMARY task', () => {
      const result = addDailyTaskSchema.safeParse({ taskId: 't1', type: 'PRIMARY' });
      expect(result.success).toBe(true);
    });

    it('should accept valid SECONDARY task', () => {
      const result = addDailyTaskSchema.safeParse({ taskId: 't1', type: 'SECONDARY' });
      expect(result.success).toBe(true);
    });

    it('should accept with optional date', () => {
      const result = addDailyTaskSchema.safeParse({
        taskId: 't1',
        type: 'PRIMARY',
        date: '2026-07-15',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing taskId', () => {
      const result = addDailyTaskSchema.safeParse({ type: 'PRIMARY' });
      expect(result.success).toBe(false);
    });

    it('should reject empty taskId', () => {
      const result = addDailyTaskSchema.safeParse({ taskId: '', type: 'PRIMARY' });
      expect(result.success).toBe(false);
    });

    it('should reject missing type', () => {
      const result = addDailyTaskSchema.safeParse({ taskId: 't1' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid type', () => {
      const result = addDailyTaskSchema.safeParse({ taskId: 't1', type: 'INVALID' });
      expect(result.success).toBe(false);
    });
  });

  describe('removeDailyTaskSchema', () => {
    it('should accept empty input (date is optional)', () => {
      const result = removeDailyTaskSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept a valid date', () => {
      const result = removeDailyTaskSchema.safeParse({ date: '2026-07-15' });
      expect(result.success).toBe(true);
    });
  });

  describe('dailyTaskStatsSchema', () => {
    it('should accept empty input (both dates optional)', () => {
      const result = dailyTaskStatsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept both dates', () => {
      const result = dailyTaskStatsSchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
    });

    it('should coerce strings to Dates', () => {
      const result = dailyTaskStatsSchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startDate).toBeInstanceOf(Date);
        expect(result.data.endDate).toBeInstanceOf(Date);
      }
    });
  });
});
