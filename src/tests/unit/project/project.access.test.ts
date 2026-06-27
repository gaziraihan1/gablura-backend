import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectAccess } from "../../../modules/project/project.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    workspace: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

describe("ProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertWorkspaceAccess", () => {
    it("should allow workspace owner or member access", async () => {
      (prisma.workspace.findFirst as any).mockResolvedValue({ id: "ws1" });
      await expect(ProjectAccess.assertWorkspaceAccess("u1", "ws1")).resolves.toBeDefined();
    });

    it("should throw ForbiddenError if no access", async () => {
      (prisma.workspace.findFirst as any).mockResolvedValue(null);
      await expect(ProjectAccess.assertWorkspaceAccess("u1", "ws1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertProjectAccess", () => {
    it("should allow project member access", async () => {
      (prisma.project.findFirst as any).mockResolvedValue({ id: "p1" });
      await expect(ProjectAccess.assertProjectAccess("u1", "p1")).resolves.toBeDefined();
    });

    it("should throw NotFoundError if project not accessible", async () => {
      (prisma.project.findFirst as any).mockResolvedValue(null);
      await expect(ProjectAccess.assertProjectAccess("u1", "p1")).rejects.toThrow(NotFoundError);
    });
  });
});
