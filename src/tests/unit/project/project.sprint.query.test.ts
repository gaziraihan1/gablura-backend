import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintQuery } from "../../../modules/project/project.sprint.query.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    sprint: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

describe("SprintQuery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getByProject", () => {
    it("should return sprints ordered by startDate desc", async () => {
      const mockSprints = [{ id: "s1", name: "Sprint 2" }, { id: "s2", name: "Sprint 1" }];
      (prisma.sprint.findMany as any).mockResolvedValue(mockSprints);
      const result = await SprintQuery.getByProject("proj1");
      expect(prisma.sprint.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj1" },
        orderBy: { startDate: "desc" },
      });
      expect(result).toEqual(mockSprints);
    });

    it("should return empty array if no sprints", async () => {
      (prisma.sprint.findMany as any).mockResolvedValue([]);
      const result = await SprintQuery.getByProject("proj1");
      expect(result).toEqual([]);
    });
  });

  describe("getActiveSprint", () => {
    it("should return the active sprint", async () => {
      const mockSprint = { id: "s1", name: "Current Sprint", status: "ACTIVE" };
      (prisma.sprint.findFirst as any).mockResolvedValue(mockSprint);
      const result = await SprintQuery.getActiveSprint("proj1");
      expect(prisma.sprint.findFirst).toHaveBeenCalledWith({
        where: { projectId: "proj1", status: "ACTIVE" },
      });
      expect(result).toEqual(mockSprint);
    });

    it("should return null if no active sprint", async () => {
      (prisma.sprint.findFirst as any).mockResolvedValue(null);
      const result = await SprintQuery.getActiveSprint("proj1");
      expect(result).toBeNull();
    });
  });

  describe("getById", () => {
    it("should return sprint with task details", async () => {
      const mockSprint = {
        id: "s1",
        name: "Sprint 1",
        project: { tasks: [] },
      };
      (prisma.sprint.findUnique as any).mockResolvedValue(mockSprint);
      const result = await SprintQuery.getById("s1");
      expect(result).toEqual(mockSprint);
    });

    it("should throw NotFoundError if sprint not found", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue(null);
      await expect(SprintQuery.getById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("getSprintStats", () => {
    it("should return sprint stats with velocity calculation", async () => {
      const mockSprints = [
        { id: "s1", name: "Sprint 1", status: "ACTIVE", startDate: new Date(), endDate: new Date(), totalPoints: 20, completedPoints: 15, velocity: 15 },
        { id: "s2", name: "Sprint 2", status: "COMPLETED", startDate: new Date(), endDate: new Date(), totalPoints: 30, completedPoints: 25, velocity: 25 },
      ];
      (prisma.sprint.findMany as any).mockResolvedValue(mockSprints);
      const result = await SprintQuery.getSprintStats("proj1");
      expect(result.sprints).toEqual(mockSprints);
      expect(result.activeSprint).toEqual(mockSprints[0]);
      expect(result.avgVelocity).toBeCloseTo(20, 0);
    });

    it("should handle empty sprints array", async () => {
      (prisma.sprint.findMany as any).mockResolvedValue([]);
      const result = await SprintQuery.getSprintStats("proj1");
      expect(result.sprints).toEqual([]);
      expect(result.activeSprint).toBeUndefined();
      expect(result.avgVelocity).toBe(0);
    });

    it("should handle no velocity data", async () => {
      const mockSprints = [
        { id: "s1", status: "PLANNING", velocity: null },
        { id: "s2", status: "PLANNING", velocity: null },
      ];
      (prisma.sprint.findMany as any).mockResolvedValue(mockSprints);
      const result = await SprintQuery.getSprintStats("proj1");
      expect(result.avgVelocity).toBe(0);
    });
  });
});
