import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsAccess } from "../../../modules/analytics/analytics.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, PlanLimitError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
  },
}));

describe("AnalyticsAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertAnalyticsAccess", () => {
    it("rejects non-members with ForbiddenError before checking the plan tier", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "BUSINESS" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null as any);

      await expect(AnalyticsAccess.assertAnalyticsAccess("u1", "ws1")).rejects.toThrow(ForbiddenError);
    });

    it("rejects FREE-plan members with PlanLimitError after membership passes", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: "OWNER" } as any);

      await expect(AnalyticsAccess.assertAnalyticsAccess("u1", "ws1")).rejects.toThrow(PlanLimitError);
    });

    it("allows admin/owner members on a paid plan", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: "ADMIN" } as any);

      await expect(AnalyticsAccess.assertAnalyticsAccess("u1", "ws1")).resolves.toBeUndefined();
    });

    it("rejects non-admin members even on a paid plan", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "BUSINESS" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: "MEMBER" } as any);

      await expect(AnalyticsAccess.assertAnalyticsAccess("u1", "ws1")).rejects.toThrow(ForbiddenError);
    });
  });
});
