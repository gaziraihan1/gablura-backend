import { describe, it, expect, vi, beforeEach } from "vitest";
import { SectionMutation } from "../../../modules/project/project.section.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectSection: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
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
    it("should create a section", async () => {
      const data = { name: "Backend", color: "#667eea", projectId: "p1" };
      (prisma.projectSection.create as any).mockResolvedValue({ id: "sec1", ...data });
      const result = await SectionMutation.create(data, "u1");
      expect(prisma.projectSection.create).toHaveBeenCalledWith({ data });
      expect(result.id).toBe("sec1");
    });

    it("should assert project admin access", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
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
  });
});
