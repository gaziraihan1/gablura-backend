import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { WorkspaceUsageController } from "../../../modules/workspaceUsage/workspaceUsage.controller.js";
import { WorkspaceUsageQuery } from "../../../modules/workspaceUsage/workspaceUsage.query.js";
import { prisma } from "../../../lib/prisma.js";
import { WorkspaceUsageAccess } from "../../../modules/workspaceUsage/workspaceUsage.access.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("../../../modules/workspaceUsage/workspaceUsage.query.js", () => ({
  WorkspaceUsageQuery: {
    getWorkspaceUsage: vi.fn(),
  },
}));

vi.mock("../../../modules/workspaceUsage/workspaceUsage.access.js", () => ({
  WorkspaceUsageAccess: {
    assertWorkspaceMember: vi.fn(),
  },
}));

function mockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  return res;
}

describe("WorkspaceUsageController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 401 when request has no authenticated user", async () => {
    const res = mockResponse();

    await WorkspaceUsageController.getWorkspaceUsage({ params: { workspaceId: "ws-1" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Unauthorized" });
  });

  it("returns usage data for paid workspaces the user can access", async () => {
    const data = { snapshot: { totalMembers: 1 }, isAdmin: true };
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
    vi.mocked(WorkspaceUsageAccess.assertWorkspaceMember).mockResolvedValue({ role: "OWNER" } as any);
    vi.mocked(WorkspaceUsageQuery.getWorkspaceUsage).mockResolvedValue(data as any);
    const res = mockResponse();

    await WorkspaceUsageController.getWorkspaceUsage(
      { params: { workspaceId: "ws-1" }, user: { id: "user-1" } } as any,
      res,
    );

    expect(WorkspaceUsageAccess.assertWorkspaceMember).toHaveBeenCalledWith("user-1", "ws-1");
    expect(WorkspaceUsageQuery.getWorkspaceUsage).toHaveBeenCalledWith("ws-1", "user-1");
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it("returns 403 for FREE workspaces", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
    const res = mockResponse();

    await WorkspaceUsageController.getWorkspaceUsage(
      { params: { workspaceId: "ws-1" }, user: { id: "user-1" } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Upgrade workspace plan to access usage analytics",
    });
    expect(WorkspaceUsageQuery.getWorkspaceUsage).not.toHaveBeenCalled();
  });

  it("returns 404 when workspace does not exist", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    const res = mockResponse();

    await WorkspaceUsageController.getWorkspaceUsage(
      { params: { workspaceId: "missing" }, user: { id: "user-1" } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Workspace not found" });
  });

  it("returns 403 when access assertion fails", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
    vi.mocked(WorkspaceUsageAccess.assertWorkspaceMember).mockRejectedValue(
      new Error("You do not have access to this workspace"),
    );
    const res = mockResponse();

    await WorkspaceUsageController.getWorkspaceUsage(
      { params: { workspaceId: "ws-1" }, user: { id: "user-1" } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "You do not have access to this workspace",
    });
  });
});