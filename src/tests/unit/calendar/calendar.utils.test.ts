// src/tests/unit/calendar/calendar.utils.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests — no mocks, no DB.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  normalizeDate,
  endOfDay,
  generateDateRange,
  getWorkDayNumbers,
  countWorkDays,
  countConsecutiveDays,
  isReviewDay,
  getWeekStart,
} from '../../../modules/calendar/calendar.utils.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('sets time to 00:00:00.000', () => {
    const d = normalizeDate(new Date('2025-06-15T14:32:11.500Z'));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('does not mutate the input date', () => {
    const input = new Date('2025-06-15T14:00:00Z');
    const before = input.getTime();
    normalizeDate(input);
    expect(input.getTime()).toBe(before);
  });
});

describe('endOfDay', () => {
  it('sets time to 23:59:59.999', () => {
    const d = endOfDay(new Date('2025-06-15T00:00:00Z'));
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it('normalizeDate result is always before endOfDay result for the same date', () => {
    const date = new Date('2025-06-15T12:00:00');
    expect(normalizeDate(date).getTime()).toBeLessThan(endOfDay(date).getTime());
  });
});

describe('generateDateRange', () => {
  it('generates inclusive range of 7 dates for a one-week span', () => {
    const start = new Date('2025-06-01');
    const end   = new Date('2025-06-07');
    const range = generateDateRange(start, end);
    expect(range).toHaveLength(7);
  });

  it('returns a single date when start === end', () => {
    const d = new Date('2025-06-15');
    expect(generateDateRange(d, d)).toHaveLength(1);
  });

  it('all dates are at midnight', () => {
    const range = generateDateRange(new Date('2025-06-01'), new Date('2025-06-03'));
    for (const d of range) {
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it('returns empty array when end < start', () => {
    const range = generateDateRange(new Date('2025-06-10'), new Date('2025-06-05'));
    expect(range).toHaveLength(0);
  });
});

describe('getWorkDayNumbers', () => {
  it('maps standard Mon-Fri to [1,2,3,4,5]', () => {
    const nums = getWorkDayNumbers(['MON', 'TUE', 'WED', 'THU', 'FRI']);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps SUN to 0 and SAT to 6', () => {
    expect(getWorkDayNumbers(['SUN'])).toEqual([0]);
    expect(getWorkDayNumbers(['SAT'])).toEqual([6]);
  });

  it('filters out unknown day names', () => {
    const nums = getWorkDayNumbers(['MON', 'HOLIDAY']);
    expect(nums).toEqual([1]);
  });
});

describe('countWorkDays', () => {
  it('counts 5 work days in a Mon-Fri week', () => {
    // 2025-06-09 is Monday, 2025-06-13 is Friday
    const count = countWorkDays(
      new Date('2025-06-09'),
      new Date('2025-06-13'),
      ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    );
    expect(count).toBe(5);
  });

  it('counts 0 when the range is only weekend days', () => {
    // 2025-06-14 = Saturday, 2025-06-15 = Sunday
    const count = countWorkDays(
      new Date('2025-06-14'),
      new Date('2025-06-15'),
      ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    );
    expect(count).toBe(0);
  });

  it('counts correctly over a full 2-week span (10 work days)', () => {
    const count = countWorkDays(
      new Date('2025-06-09'),
      new Date('2025-06-20'),
      ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    );
    expect(count).toBe(10);
  });
});

describe('countConsecutiveDays', () => {
  it('returns 0 for an empty array', () => {
    expect(countConsecutiveDays([], () => true)).toBe(0);
  });

  it('returns 0 when no items satisfy the condition', () => {
    expect(countConsecutiveDays([1, 2, 3], (n) => n > 10)).toBe(0);
  });

  it('returns the length when all items satisfy the condition', () => {
    expect(countConsecutiveDays([5, 6, 7], (n) => n > 0)).toBe(3);
  });

  it('returns the longest consecutive run', () => {
    // run of 1, gap, run of 3, gap, run of 2
    const items = [true, false, true, true, true, false, true, true];
    const result = countConsecutiveDays(items, (b) => b);
    expect(result).toBe(3);
  });

  it('handles a single-element array that satisfies the condition', () => {
    expect(countConsecutiveDays([42], (n) => n === 42)).toBe(1);
  });
});

describe('isReviewDay', () => {
  it('returns true for Sunday (day 0)', () => {
    // 2025-06-15 is Sunday
    expect(isReviewDay(new Date('2025-06-15T00:00:00'))).toBe(true);
  });

  it('returns true for the 1st of any month', () => {
    expect(isReviewDay(new Date('2025-06-01T00:00:00'))).toBe(true);
    expect(isReviewDay(new Date('2025-01-01T00:00:00'))).toBe(true);
  });

  it('returns false for a regular weekday that is not the 1st', () => {
    // 2025-06-11 is Wednesday, not 1st
    expect(isReviewDay(new Date('2025-06-11T00:00:00'))).toBe(false);
  });
});

describe('getWeekStart', () => {
  it('returns Sunday for a Wednesday input', () => {
    // 2025-06-11 is Wednesday → week start is 2025-06-08 (Sunday)
    const start = getWeekStart(new Date('2025-06-11'));
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(8);
    expect(start.getMonth()).toBe(5); // June (0-indexed)
  });

  it('returns the same day if input is already Sunday', () => {
    const sunday = new Date('2025-06-08');
    const start  = getWeekStart(sunday);
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(8);
  });

  it('normalizes to midnight', () => {
    const start = getWeekStart(new Date('2025-06-11T15:30:00'));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });
});