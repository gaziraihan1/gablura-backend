import { describe, it, expect, vi, beforeEach } from "vitest";
import { MilestoneQuery } from "../../../modules/project/project.milestone.query.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectMilestone: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

describe("MilestoneQuery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getByProject", () => {
    it("should return milestones ordered by dueDate asc", async () => {
      const mockMilestones = [
        { id: "m1", title: "Alpha", dueDate: new Date("2024-03-01") },
        { id: "m2", title: "Beta", dueDate: new Date("2024-06-01") },
      ];
      (prisma.projectMilestone.findMany as any).mockResolvedValue(mockMilestones);
      const result = await MilestoneQuery.getByProject("proj1");
      expect(prisma.projectMilestone.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj1" },
        orderBy: { dueDate: "asc" },
      });
      expect(result).toEqual(mockMilestones);
    });
  });

  describe("getById", () => {
    it("should return milestone with dependencies", async () => {
      const mock = { id: "m1", dependsOn: { id: "m2" }, dependencies: [{ id: "m3" }] };
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(mock);
      const result = await MilestoneQuery.getById("m1");
      expect(result.dependsOn).toBeDefined();
      expect(result.dependencies).toHaveLength(1);
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(null);
      await expect(MilestoneQuery.getById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("getMilestoneStats", () => {
    it("should calculate stats from milestones", async () => {
      const mockMilestones = [
        { id: "m1", title: "Alpha", status: "COMPLETED", progress: 100, dueDate: new Date(), dependsOnId: null, tasks: [] },
        { id: "m2", title: "Beta", status: "ON_TRACK", progress: 50, dueDate: new Date(), dependsOnId: null, tasks: [] },
        { id: "m3", title: "Gamma", status: "AT_RISK", progress: 30, dueDate: new Date(), dependsOnId: "m1", tasks: [] },
        { id: "m4", title: "Delta", status: "DELAYED", progress: 10, dueDate: new Date(), dependsOnId: null, tasks: [] },
      ];
      (prisma.projectMilestone.findMany as any).mockResolvedValue(mockMilestones);
      const result = await MilestoneQuery.getMilestoneStats("proj1");
      expect(result.total).toBe(4);
      expect(result.completed).toBe(1);
      expect(result.atRisk).toBe(1);
      expect(result.delayed).toBe(1);
      expect(result.onTrack).toBe(1);
      expect(result.avgProgress).toBe(48); // (100+50+30+10)/4 = 47.5 -> Math.round -> 48
    });

    it("should handle empty milestones", async () => {
      (prisma.projectMilestone.findMany as any).mockResolvedValue([]);
      const result = await MilestoneQuery.getMilestoneStats("proj1");
      expect(result.total).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.avgProgress).toBe(0);
    });
  });
});
