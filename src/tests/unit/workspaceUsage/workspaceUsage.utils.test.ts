import { describe, expect, it, vi, afterEach } from "vitest";
import {
  bytesToMB,
  daysBetween,
  getDateRange,
  getDayBounds,
  getMonthRange,
} from "../../../modules/workspaceUsage/workspaceUsage.utils.js";

describe("workspaceUsage.utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("bytesToMB", () => {
    it("converts bytes to megabytes rounded to two decimals", () => {
      expect(bytesToMB(0)).toBe(0);
      expect(bytesToMB(1024 * 1024)).toBe(1);
      expect(bytesToMB(1.234 * 1024 * 1024)).toBe(1.23);
    });
  });

  describe("daysBetween", () => {
    it("returns whole day difference between two dates", () => {
      const start = new Date("2026-06-01T10:00:00.000Z");
      const end = new Date("2026-06-04T09:59:59.000Z");

      expect(daysBetween(start, end)).toBe(2);
    });
  });

  describe("getDateRange", () => {
    it("returns dates in ascending order ending today", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));

      const range = getDateRange(3).map((date) => date.toISOString().split("T")[0]);

      expect(range).toEqual(["2026-06-26", "2026-06-27", "2026-06-28"]);
    });
  });

  describe("getDayBounds", () => {
    it("returns start and end of the provided day", () => {
      const { start, end } = getDayBounds(new Date("2026-06-28T15:30:00.000Z"));

      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
    });
  });

  describe("getMonthRange", () => {
    it("returns the requested number of month ranges", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));

      const range = getMonthRange(2);

      expect(range).toHaveLength(2);
      expect(range[0].start.getMonth()).toBe(4);
      expect(range[1].start.getMonth()).toBe(5);
      expect(range[0].label).toContain("2026");
      expect(range[1].label).toContain("2026");
    });
  });
});