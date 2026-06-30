import { describe, it, expect } from "vitest";

import {
  normalizeDate,
  endOfDay,
  generateDateRange,
  getWorkDayNumbers,
  countWorkDays,
  countConsecutiveDays,
  isReviewDay,
  getWeekStart,
} from "../../../modules/calendar/calendar.utils.js";

describe("calendar.utils", () => {
  describe("normalizeDate", () => {
    it("normalizes date to midnight", () => {
      const date = new Date("2024-01-15T14:30:00.000Z");
      const normalized = normalizeDate(date);
      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it("preserves the date", () => {
      const date = new Date("2024-01-15T14:30:00.000Z");
      const normalized = normalizeDate(date);
      expect(normalized.getDate()).toBe(15);
      expect(normalized.getMonth()).toBe(0);
      expect(normalized.getFullYear()).toBe(2024);
    });
  });

  describe("endOfDay", () => {
    it("sets time to 23:59:59.999", () => {
      const date = new Date("2024-01-15T14:30:00.000Z");
      const end = endOfDay(date);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
    });

    it("preserves the date", () => {
      const date = new Date("2024-01-15T14:30:00.000Z");
      const end = endOfDay(date);
      expect(end.getDate()).toBe(15);
      expect(end.getMonth()).toBe(0);
      expect(end.getFullYear()).toBe(2024);
    });
  });

  describe("generateDateRange", () => {
    it("generates single day range", () => {
      const start = new Date("2024-01-15");
      const end = new Date("2024-01-15");
      const range = generateDateRange(start, end);
      expect(range).toHaveLength(1);
      expect(range[0].getDate()).toBe(15);
    });

    it("generates multi-day range", () => {
      const start = new Date("2024-01-15");
      const end = new Date("2024-01-17");
      const range = generateDateRange(start, end);
      expect(range).toHaveLength(3);
      expect(range[0].getDate()).toBe(15);
      expect(range[1].getDate()).toBe(16);
      expect(range[2].getDate()).toBe(17);
    });

    it("handles month boundaries", () => {
      const start = new Date("2024-01-31");
      const end = new Date("2024-02-02");
      const range = generateDateRange(start, end);
      expect(range).toHaveLength(3);
      expect(range[0].getMonth()).toBe(0);
      expect(range[1].getMonth()).toBe(1);
      expect(range[2].getMonth()).toBe(1);
    });

    it("returns empty array when start > end", () => {
      const start = new Date("2024-01-17");
      const end = new Date("2024-01-15");
      const range = generateDateRange(start, end);
      expect(range).toHaveLength(0);
    });
  });

  describe("getWorkDayNumbers", () => {
    it("converts day abbreviations to numbers", () => {
      const result = getWorkDayNumbers(["MON", "WED", "FRI"]);
      expect(result).toEqual([1, 3, 5]);
    });

    it("filters invalid day abbreviations", () => {
      const result = getWorkDayNumbers(["MON", "INVALID", "FRI"]);
      expect(result).toEqual([1, 5]);
    });

    it("handles empty array", () => {
      const result = getWorkDayNumbers([]);
      expect(result).toEqual([]);
    });

    it("handles all days", () => {
      const result = getWorkDayNumbers(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  describe("countWorkDays", () => {
    it("counts work days in range", () => {
      const start = new Date("2024-01-15"); // Monday
      const end = new Date("2024-01-19"); // Friday
      const workDays = ["MON", "TUE", "WED", "THU", "FRI"];
      const count = countWorkDays(start, end, workDays);
      expect(count).toBe(5);
    });

    it("excludes weekends when not in work days", () => {
      const start = new Date("2024-01-15"); // Monday
      const end = new Date("2024-01-21"); // Sunday
      const workDays = ["MON", "TUE", "WED", "THU", "FRI"];
      const count = countWorkDays(start, end, workDays);
      expect(count).toBe(5);
    });

    it("handles custom work week", () => {
      const start = new Date("2024-01-15"); // Monday
      const end = new Date("2024-01-21"); // Sunday
      const workDays = ["MON", "WED", "FRI"];
      const count = countWorkDays(start, end, workDays);
      expect(count).toBe(3);
    });

    it("returns 0 for empty work days", () => {
      const start = new Date("2024-01-15");
      const end = new Date("2024-01-19");
      const count = countWorkDays(start, end, []);
      expect(count).toBe(0);
    });
  });

  describe("countConsecutiveDays", () => {
    it("counts consecutive true values", () => {
      const items = [true, true, true, false, true, true];
      const count = countConsecutiveDays(items, (item) => item);
      expect(count).toBe(3);
    });

    it("counts consecutive items matching condition", () => {
      const items = [1, 2, 3, 0, 5, 6];
      const count = countConsecutiveDays(items, (item) => item > 0);
      expect(count).toBe(3);
    });

    it("returns 0 for all false values", () => {
      const items = [false, false, false];
      const count = countConsecutiveDays(items, (item) => item);
      expect(count).toBe(0);
    });

    it("returns 0 for empty array", () => {
      const items: boolean[] = [];
      const count = countConsecutiveDays(items, (item) => item);
      expect(count).toBe(0);
    });

    it("handles all true values", () => {
      const items = [true, true, true, true];
      const count = countConsecutiveDays(items, (item) => item);
      expect(count).toBe(4);
    });
  });

  describe("isReviewDay", () => {
    it("returns true for Sunday", () => {
      const sunday = new Date("2024-01-14"); // Sunday
      expect(isReviewDay(sunday)).toBe(true);
    });

    it("returns true for first day of month", () => {
      const first = new Date("2024-01-01"); // Monday
      expect(isReviewDay(first)).toBe(true);
    });

    it("returns false for regular days", () => {
      const regular = new Date("2024-01-15"); // Monday
      expect(isReviewDay(regular)).toBe(false);
    });

    it("returns true for first day that's not Sunday", () => {
      const first = new Date("2024-02-01"); // Thursday
      expect(isReviewDay(first)).toBe(true); // True because it's 1st of month
    });
  });

  describe("getWeekStart", () => {
    it("returns Sunday for Monday", () => {
      const monday = new Date("2024-01-15"); // Monday
      const weekStart = getWeekStart(monday);
      expect(weekStart.getDay()).toBe(0); // Sunday
      expect(weekStart.getDate()).toBe(14);
    });

    it("returns same day for Sunday", () => {
      const sunday = new Date("2024-01-14"); // Sunday
      const weekStart = getWeekStart(sunday);
      expect(weekStart.getDay()).toBe(0);
      expect(weekStart.getDate()).toBe(14);
    });

    it("normalizes to midnight", () => {
      const date = new Date("2024-01-15T14:30:00.000Z");
      const weekStart = getWeekStart(date);
      expect(weekStart.getHours()).toBe(0);
      expect(weekStart.getMinutes()).toBe(0);
    });
  });
});