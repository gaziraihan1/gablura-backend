import { describe, it, expect, vi, beforeEach } from "vitest";
import { SectionQuery } from "../../../modules/project/project.section.query.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectSection: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

describe("SectionQuery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getByProject", () => {
    it("should return sections ordered by position", async () => {
      const mockSections = [
        { id: "sec1", name: "Section 1", position: 0 },
        { id: "sec2", name: "Section 2", position: 1 },
      ];
      (prisma.projectSection.findMany as any).mockResolvedValue(mockSections);
      const result = await SectionQuery.getByProject("p1");
      expect(prisma.projectSection.findMany).toHaveBeenCalledWith({
        where: { projectId: "p1" },
        orderBy: { position: "asc" },
        include: { _count: { select: { tasks: true } } },
      });
      expect(result).toEqual(mockSections);
    });

    it("should return empty array if no sections", async () => {
      (prisma.projectSection.findMany as any).mockResolvedValue([]);
      const result = await SectionQuery.getByProject("p1");
      expect(result).toEqual([]);
    });
  });

  describe("getById", () => {
    it("should return a section by id", async () => {
      const mockSection = { id: "sec1", name: "Backend" };
      (prisma.projectSection.findUnique as any).mockResolvedValue(mockSection);
      const result = await SectionQuery.getById("sec1");
      expect(result).toEqual(mockSection);
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectSection.findUnique as any).mockResolvedValue(null);
      await expect(SectionQuery.getById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });
});
