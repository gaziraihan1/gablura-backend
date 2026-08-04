import { describe, expect, it, vi, afterEach } from "vitest";
import {
  bytesToMB,
  daysBetween,
  getDateRange,
  getDayBounds,
  getMonthRange,
  pctChange,
  buildGrowthInsights,
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

  describe("pctChange", () => {
    it("returns rounded percentage change", () => {
      expect(pctChange(100, 150)).toBe(50);
      expect(pctChange(200, 100)).toBe(-50);
    });

    it("returns null when there is no positive baseline", () => {
      expect(pctChange(0, 10)).toBeNull();
      expect(pctChange(-5, 10)).toBeNull();
    });
  });

  describe("buildGrowthInsights", () => {
    const baseGrowth = {
      thisMonth: { newUsers: 2, newProjects: 1, newTasks: 30 },
      trend: [
        { month: "Jan", users: 5, projects: 2, tasks: 20 },
        { month: "Feb", users: 7, projects: 3, tasks: 30 },
      ],
      projectLifecycle: { created: 5, active: 4, completed: 1, archived: 0 },
      changes: { newTasks: 50, newUsers: 0, newProjects: 0 },
      insights: [],
    };
    const baseResource = {
      storageByProject: [],
      filesByUser: [],
      totalStorage: { usedMB: 500, totalMB: 1000, percentage: 50 },
      storageGrowth: [],
      fileTrend: [],
      fileGrowthPct: null,
      fileTypeDistribution: [],
    };

    it("marks positive task growth as a positive insight", () => {
      const insights = buildGrowthInsights(baseGrowth, baseResource);
      expect(insights[0].type).toBe("positive");
      expect(insights[0].text).toContain("increased 50%");
    });

    it("marks declining task growth as a warning insight", () => {
      const declining = {
        ...baseGrowth,
        thisMonth: { ...baseGrowth.thisMonth, newTasks: 10 },
      };
      const insights = buildGrowthInsights(declining, baseResource);
      expect(insights[0].type).toBe("warning");
      expect(insights[0].text).toContain("dropped 50%");
    });

    it("uses a neutral insight when there is no task baseline", () => {
      const noBaseline = {
        ...baseGrowth,
        trend: [{ month: "Feb", users: 7, projects: 3, tasks: 30 }],
      };
      const insights = buildGrowthInsights(noBaseline, baseResource);
      expect(insights[0].type).toBe("neutral");
    });

    it("warns when storage is near the limit", () => {
      const nearLimit = {
        ...baseResource,
        totalStorage: { usedMB: 900, totalMB: 1000, percentage: 90 },
      };
      const insights = buildGrowthInsights(baseGrowth, nearLimit);
      expect(insights[1].type).toBe("warning");
      expect(insights[1].text).toContain("90%");
    });

    it("always includes the active-projects summary insight", () => {
      const insights = buildGrowthInsights(baseGrowth, baseResource);
      expect(insights[2].type).toBe("neutral");
      expect(insights[2].text).toContain("4 active projects");
    });
  });
});
