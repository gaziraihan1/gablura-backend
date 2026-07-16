import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calendarRangeSchema,
  createGoalCheckpointSchema,
  updateCapacitySchema,
  updateScheduleSchema,
  logEnergySchema,
  energyHistorySchema,
} from '../../../modules/calendar/calendar.validators.js';

describe('calendar.validators', () => {
  describe('calendarRangeSchema', () => {
    it('should accept valid date range', () => {
      const result = calendarRangeSchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional workspaceId', () => {
      const result = calendarRangeSchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        workspaceId: 'ws1',
      });
      expect(result.success).toBe(true);
    });

    it('should coerce strings to dates', () => {
      const result = calendarRangeSchema.safeParse({
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

  describe('createGoalCheckpointSchema', () => {
    it('should accept valid input', () => {
      const result = createGoalCheckpointSchema.safeParse({
        title: 'Q3 Goal',
        type: 'QUARTERLY',
        targetDate: '2026-09-30',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing title', () => {
      const result = createGoalCheckpointSchema.safeParse({ type: 'WEEKLY', targetDate: '2026-07-20' });
      expect(result.success).toBe(false);
    });

    it('should accept all valid types', () => {
      for (const type of ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'KPI']) {
        const result = createGoalCheckpointSchema.safeParse({
          title: 'Goal',
          type,
          targetDate: '2026-07-20',
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid type', () => {
      const result = createGoalCheckpointSchema.safeParse({
        title: 'Goal',
        type: 'DAILY',
        targetDate: '2026-07-20',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateCapacitySchema', () => {
    it('should accept valid weeklyHours', () => {
      const result = updateCapacitySchema.safeParse({ weeklyHours: 40 });
      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = updateCapacitySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject weeklyHours over 168', () => {
      const result = updateCapacitySchema.safeParse({ weeklyHours: 169 });
      expect(result.success).toBe(false);
    });

    it('should reject dailyCapacityHours over 24', () => {
      const result = updateCapacitySchema.safeParse({ dailyCapacityHours: 25 });
      expect(result.success).toBe(false);
    });

    it('should accept deepWorkHours of 0', () => {
      const result = updateCapacitySchema.safeParse({ deepWorkHours: 0 });
      expect(result.success).toBe(true);
    });
  });

  describe('updateScheduleSchema', () => {
    it('should accept valid workDays', () => {
      const result = updateScheduleSchema.safeParse({
        workDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = updateScheduleSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept workStartHour and workEndHour', () => {
      const result = updateScheduleSchema.safeParse({
        workStartHour: 9,
        workEndHour: 17,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid day abbreviations', () => {
      const result = updateScheduleSchema.safeParse({
        workDays: ['MONDAY'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('logEnergySchema', () => {
    it('should accept valid energy log', () => {
      const result = logEnergySchema.safeParse({
        date: '2026-07-15',
        energyLevel: 7,
      });
      expect(result.success).toBe(true);
    });

    it('should accept with optional note', () => {
      const result = logEnergySchema.safeParse({
        date: '2026-07-15',
        energyLevel: 5,
        note: 'Feeling good',
      });
      expect(result.success).toBe(true);
    });

    it('should reject energyLevel below 1', () => {
      const result = logEnergySchema.safeParse({
        date: '2026-07-15',
        energyLevel: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject energyLevel above 10', () => {
      const result = logEnergySchema.safeParse({
        date: '2026-07-15',
        energyLevel: 11,
      });
      expect(result.success).toBe(false);
    });

    it('should accept energyLevel at boundaries (1 and 10)', () => {
      expect(logEnergySchema.safeParse({ date: '2026-07-15', energyLevel: 1 }).success).toBe(true);
      expect(logEnergySchema.safeParse({ date: '2026-07-15', energyLevel: 10 }).success).toBe(true);
    });
  });

  describe('energyHistorySchema', () => {
    it('should accept valid date range', () => {
      const result = energyHistorySchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
    });

    it('should default page to 1', () => {
      const result = energyHistorySchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.page).toBe(1);
    });

    it('should default limit to 31', () => {
      const result = energyHistorySchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(31);
    });

    it('should reject limit over 100', () => {
      const result = energyHistorySchema.safeParse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        limit: '101',
      });
      expect(result.success).toBe(false);
    });
  });
});
