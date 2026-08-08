import { describe, it, expect, vi, beforeEach } from "vitest";
import { SectionMutation } from "../../../modules/project/project.section.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError, BadRequestError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectSection: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((updates: any[]) => Promise.all(updates)),
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectAdminAccess: vi.fn().mockResolvedValue({ id: "p1" }),
    assertProjectNotArchived: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("SectionMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("create", () => {
    it("should create a section and auto-assign position after the last one", async () => {
      const data = { name: "Backend", color: "#667eea", projectId: "p1" };
      (prisma.projectSection.findFirst as any).mockResolvedValue({ position: 2 });
      (prisma.projectSection.create as any).mockResolvedValue({ id: "sec1", ...data, position: 3 });
      const result = await SectionMutation.create(data, "u1");
      expect(prisma.projectSection.findFirst).toHaveBeenCalledWith({
        where:  { projectId: "p1" },
        orderBy: { position: "desc" },
        select:  { position: true },
      });
      expect(prisma.projectSection.create).toHaveBeenCalledWith({
        data: { ...data, position: 3 },
      });
      expect(result.id).toBe("sec1");
    });

    it("should default position to 0 when no sections exist", async () => {
      (prisma.projectSection.findFirst as any).mockResolvedValue(null);
      (prisma.projectSection.create as any).mockResolvedValue({ id: "sec1", position: 0 });
      await SectionMutation.create({ name: "Backend", projectId: "p1" }, "u1");
      expect(prisma.projectSection.create).toHaveBeenCalledWith({
        data: { name: "Backend", projectId: "p1", position: 0 },
      });
    });

    it("should respect an explicitly provided position", async () => {
      (prisma.projectSection.findFirst as any).mockResolvedValue(null);
      (prisma.projectSection.create as any).mockResolvedValue({ id: "sec1", position: 7 });
      await SectionMutation.create({ name: "Backend", projectId: "p1", position: 7 }, "u1");
      expect(prisma.projectSection.create).toHaveBeenCalledWith({
        data: { name: "Backend", projectId: "p1", position: 7 },
      });
    });

    it("should reject a taskStatus that is already mapped in the project", async () => {
      (prisma.projectSection.findFirst as any).mockResolvedValueOnce({ id: "sec-existing" });
      await expect(
        SectionMutation.create({ name: "Backend", projectId: "p1", taskStatus: "TODO" as any }, "u1"),
      ).rejects.toThrow(BadRequestError);
    });

    it("should assert project admin access", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (prisma.projectSection.findFirst as any).mockResolvedValue(null);
      (prisma.projectSection.create as any).mockResolvedValue({ id: "sec1" });
      await SectionMutation.create({ name: "Test", projectId: "p1" }, "u1");
      expect(ProjectAccess.assertProjectAdminAccess).toHaveBeenCalledWith("u1", "p1");
    });
  });

  describe("update", () => {
    it("should update a section", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue({ id: "sec1", projectId: "p1" });
      (prisma.projectSection.update as any).mockResolvedValue({ id: "sec1", name: "Updated" });
      const result = await SectionMutation.update("sec1", { name: "Updated" }, "u1");
      expect(result.name).toBe("Updated");
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue(null);
      await expect(SectionMutation.update("nonexistent", { name: "X" }, "u1")).rejects.toThrow(NotFoundError);
    });

    it("should reject remapping to a taskStatus used by another section", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue({ id: "sec1", projectId: "p1", taskStatus: "TODO" });
      (prisma.projectSection.findFirst as any).mockResolvedValueOnce({ id: "sec-other" });
      await expect(
        SectionMutation.update("sec1", { taskStatus: "IN_PROGRESS" as any }, "u1"),
      ).rejects.toThrow(BadRequestError);
    });

    it("should allow updating taskStatus to its current value", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue({ id: "sec1", projectId: "p1", taskStatus: "TODO" });
      (prisma.projectSection.update as any).mockResolvedValue({ id: "sec1", taskStatus: "TODO" });
      const result = await SectionMutation.update("sec1", { taskStatus: "TODO" as any }, "u1");
      expect(result.taskStatus).toBe("TODO");
      expect(prisma.projectSection.findFirst).not.toHaveBeenCalled();
    });

    it("should clear the taskStatus mapping when null is passed", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue({ id: "sec1", projectId: "p1", taskStatus: "TODO" });
      (prisma.projectSection.update as any).mockResolvedValue({ id: "sec1", projectId: "p1", taskStatus: null });
      const result = await SectionMutation.update("sec1", { taskStatus: null }, "u1");
      expect(prisma.projectSection.update).toHaveBeenCalledWith({
        where: { id: "sec1" },
        data:  { taskStatus: null },
      });
      // Clearing never checks availability — it cannot conflict with other sections
      expect(prisma.projectSection.findFirst).not.toHaveBeenCalled();
      expect(result.taskStatus).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete a section", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue({ id: "sec1", projectId: "p1" });
      await SectionMutation.delete("sec1", "u1");
      expect(prisma.projectSection.delete).toHaveBeenCalledWith({ where: { id: "sec1" } });
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue(null);
      await expect(SectionMutation.delete("nonexistent", "u1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("reorder", () => {
    it("should reorder sections in a transaction", async () => {
      const sectionIds = ["sec1", "sec2", "sec3"];
      (prisma.projectSection.findMany as any).mockResolvedValue([
        { id: "sec1" }, { id: "sec2" }, { id: "sec3" },
      ]);
      (prisma.projectSection.update as any).mockResolvedValue({});
      await SectionMutation.reorder("p1", sectionIds, "u1");
      expect(prisma.$transaction).toHaveBeenCalled();
      // Verify transaction received 3 update functions
      const txnArg = (prisma.$transaction as any).mock.calls[0][0];
      expect(txnArg).toHaveLength(3);
      // Verify the update calls have correct positions
      expect(prisma.projectSection.update).toHaveBeenCalledTimes(3);
      expect(prisma.projectSection.update).toHaveBeenNthCalledWith(1, { where: { id: "sec1" }, data: { position: 0 } });
      expect(prisma.projectSection.update).toHaveBeenNthCalledWith(2, { where: { id: "sec2" }, data: { position: 1 } });
      expect(prisma.projectSection.update).toHaveBeenNthCalledWith(3, { where: { id: "sec3" }, data: { position: 2 } });
    });

    it("should reject a section that does not belong to the project", async () => {
      (prisma.projectSection.findMany as any).mockResolvedValue([{ id: "sec1" }, { id: "sec2" }]);
      await expect(
        SectionMutation.reorder("p1", ["sec1", "sec-foreign"], "u1"),
      ).rejects.toThrow(BadRequestError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("should reject an empty sectionIds array", async () => {
      await expect(SectionMutation.reorder("p1", [], "u1")).rejects.toThrow(BadRequestError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
