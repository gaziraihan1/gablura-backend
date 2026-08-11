import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.js";
import { asyncHandler, NotFoundError, ValidationError } from "../errors/index.js";
import {
  paginationSchema,
  updateWorkspaceLimitsSchema,
  banUserSchema,
  deleteWorkspaceSchema,
} from "./admin.validation.js";
import {
  queryStats,
  queryWorkspaces,
  queryWorkspaceDetailBySlug,
  queryUsers,
  queryUserDetail,
  queryProjects,
  queryBilling,
  queryActivity,
} from "./admin.query.js";
import {
  assertFocuraAdmin,
  serviceUpdateWorkspaceLimits,
  serviceBanUser,
  serviceUnbanUser,
  serviceDeleteWorkspace,
  serviceRestoreWorkspace,
} from "./admin.service.js";

// ─── Helper ────────────────────────────────────────────────────────────────────

function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ValidationError("Validation error", parsed.error.issues);
  return parsed.data;
}

// ─── Read endpoints ────────────────────────────────────────────────────────────

export const getAdminStats = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const data = await queryStats();
    res.json({ success: true, data });
  },
);

export const getAdminWorkspaces = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await queryWorkspaces(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminWorkspaceDetail = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const workspace = await queryWorkspaceDetailBySlug(req.params.slug);
    if (!workspace) throw new NotFoundError("NOT_FOUND: Workspace");
    res.json({ success: true, data: workspace });
  },
);

export const getAdminUsers = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await queryUsers(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminUserDetail = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const user = await queryUserDetail(req.params.id);
    if (!user) throw new NotFoundError("NOT_FOUND: User");
    res.json({ success: true, data: user });
  },
);

export const getAdminProjects = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await queryProjects(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminBilling = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await queryBilling(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminActivity = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await queryActivity(params);
    res.json({ success: true, ...result });
  },
);

// ─── Workspace limits ──────────────────────────────────────────────────────────

export const updateWorkspaceLimits = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const input = parseOrThrow(
      updateWorkspaceLimitsSchema,
      req.body,
    );
    const updated = await serviceUpdateWorkspaceLimits(
      req.params.slug,
      req.user!.id,
      input,
    );
    res.json({
      success: true,
      message: "Workspace limits updated successfully",
      data:    updated,
    });
  },
);

// ─── User moderation ───────────────────────────────────────────────────────────

export const banUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertFocuraAdmin(req.user!.id, req.user!.role);
  const { reason } = parseOrThrow(banUserSchema, req.body);
  await serviceBanUser(req.params.id, req.user!.id, reason);
  res.json({ success: true, message: "User banned successfully" });
});

export const unbanUser = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    await serviceUnbanUser(req.params.id);
    res.json({ success: true, message: "User unbanned successfully" });
  },
);

// ─── Workspace moderation ──────────────────────────────────────────────────────

export const deleteWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    const { reason, hardDelete } = parseOrThrow(
      deleteWorkspaceSchema,
      req.body,
    );
    await serviceDeleteWorkspace(req.params.slug, req.user!.id, reason, hardDelete);
    res.json({
      success: true,
      message: hardDelete
        ? "Workspace permanently deleted"
        : "Workspace suspended (soft deleted)",
    });
  },
);

export const restoreWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req.user!.id, req.user!.role);
    await serviceRestoreWorkspace(req.params.slug, req.user!.id);
    res.json({ success: true, message: "Workspace restored successfully" });
  },
);