import { Response } from "express";
import { z } from "zod";
import { WorkspacePlan } from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { AdminRepository } from "./admin.repository.js";
import { isFocuraAdmin } from "../config/admin.config.js";
import { sendWorkspaceDeletedEmail, sendBanEmail } from "./admin.email.js";
import { prisma } from "../lib/prisma.js";
import { notifyUser } from "../modules/notification/notification.helpers.js";
import {
  asyncHandler,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  ValidationError,
} from "../errors/index.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  workspaceId: z.string().optional(),
});

const updateWorkspaceLimitsSchema = z.object({
  plan: z.nativeEnum(WorkspacePlan),
  maxMembers: z.coerce
    .number()
    .int()
    .refine((v) => v === -1 || v > 0, {
      message: "maxMembers must be a positive integer, or -1 for unlimited",
    }),
  maxStorage: z.coerce
    .number()
    .int()
    .refine((v) => v === -1 || v > 0, {
      message:
        "maxStorage (MB) must be a positive integer, or -1 for unlimited",
    }),
});

const banUserSchema = z.object({
  reason: z.string().min(1, "Reason is required").max(500),
});

const deleteWorkspaceSchema = z.object({
  reason: z.string().max(500).optional(),
  hardDelete: z.boolean().default(false),
});

// ─── Guard ────────────────────────────────────────────────────────────────────

function assertFocuraAdmin(req: AuthRequest): void {
  if (!isFocuraAdmin(req.user!.id)) {
    throw new ForbiddenError("Focura admin access required");
  }
}

function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ValidationError("Validation error", parsed.error.issues);
  return parsed.data;
}

// ─── Read endpoints ───────────────────────────────────────────────────────────

export const getAdminStats = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const data = await AdminRepository.getStats();
    res.json({ success: true, data });
  },
);

export const getAdminWorkspaces = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await AdminRepository.getWorkspaces(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminWorkspaceDetail = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const workspace = await AdminRepository.getWorkspaceDetailBySlug(
      req.params.slug,
    );
    if (!workspace) throw new NotFoundError("Workspace");
    res.json({ success: true, data: workspace });
  },
);

export const getAdminUsers = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await AdminRepository.getUsers(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminUserDetail = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const user = await AdminRepository.getUserDetail(req.params.id);
    if (!user) throw new NotFoundError("User");
    res.json({ success: true, data: user });
  },
);

export const getAdminProjects = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await AdminRepository.getProjects(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminBilling = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await AdminRepository.getBilling(params);
    res.json({ success: true, ...result });
  },
);

export const getAdminActivity = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);
    const params = parseOrThrow(paginationSchema, req.query);
    const result = await AdminRepository.getActivity(params);
    res.json({ success: true, ...result });
  },
);

// ─── Workspace limits ─────────────────────────────────────────────────────────

export const updateWorkspaceLimits = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);

    const { slug } = req.params;
    const { plan, maxMembers, maxStorage } = parseOrThrow(
      updateWorkspaceLimitsSchema,
      req.body,
    );

    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
    });

    if (!workspace) throw new NotFoundError("Workspace");

    if (maxMembers !== -1 && maxMembers < workspace._count.members) {
      throw new BadRequestError(
        `maxMembers (${maxMembers}) cannot be less than the current member count (${workspace._count.members})`,
      );
    }

    if (maxStorage !== -1) {
      const storageAgg = await prisma.file.aggregate({
        where: { workspaceId: workspace.id },
        _sum: { size: true },
      });
      const usedMb = Math.round((storageAgg._sum.size ?? 0) / (1024 * 1024));
      if (maxStorage < usedMb) {
        throw new BadRequestError(
          `maxStorage (${maxStorage} MB) cannot be less than current usage (${usedMb} MB)`,
        );
      }
    }

    const updated = await AdminRepository.updateWorkspaceLimits(workspace.id, {
      plan,
      maxMembers,
      maxStorage,
    });

    void notifyUser({
      userId: workspace.owner.id,
      senderId: req.user!.id,
      type: "PROJECT_UPDATE",
      title: "📦 Workspace Plan Updated",
      message: `Your workspace "${workspace.name}" has been updated to the ${plan} plan.`,
      actionUrl: "/dashboard",
    }).catch((e) => console.error("Workspace limits notification failed:", e));

    res.json({
      success: true,
      message: "Workspace limits updated successfully",
      data: updated,
    });
  },
);

// ─── User moderation ──────────────────────────────────────────────────────────

export const banUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  assertFocuraAdmin(req);

  const { id } = req.params;
  const { reason } = parseOrThrow(banUserSchema, req.body);

  if (isFocuraAdmin(id))
    throw new ForbiddenError("Cannot ban another Focura admin");

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, bannedAt: true },
  });
  if (!user) throw new NotFoundError("User");
  if (user.bannedAt) throw new BadRequestError("User is already banned");

  await AdminRepository.banUser(id, req.user!.id, reason);

  void sendBanEmail({
    toEmail: user.email,
    toName: user.name ?? "User",
    reason,
  }).catch((e) => console.error("Ban email failed:", e));

  res.json({ success: true, message: "User banned successfully" });
});

export const unbanUser = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);

    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { bannedAt: true },
    });

    if (!user) throw new NotFoundError("User");
    if (!user.bannedAt) throw new BadRequestError("User is not banned");

    await AdminRepository.unbanUser(id);
    res.json({ success: true, message: "User unbanned successfully" });
  },
);

// ─── Workspace moderation ─────────────────────────────────────────────────────

export const deleteWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    assertFocuraAdmin(req);

    const { slug } = req.params;
    const { reason, hardDelete } = parseOrThrow(
      deleteWorkspaceSchema,
      req.body,
    );

    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        owner: { select: { id: true, name: true, email: true } },
        deletedAt: true,
      },
    });

    if (!workspace) throw new NotFoundError("Workspace");
    if (workspace.deletedAt && !hardDelete) {
      throw new BadRequestError(
        "Workspace is already soft-deleted. Use hardDelete to permanently remove.",
      );
    }

    const ownerInfo = hardDelete
      ? await AdminRepository.hardDeleteWorkspace(workspace.id)
      : await AdminRepository.softDeleteWorkspace(
          workspace.id,
          req.user!.id,
          reason,
        );

    if (!hardDelete) {
      void notifyUser({
        userId: workspace.owner.id,
        senderId: req.user!.id,
        type: "PROJECT_UPDATE",
        title: "⚠️ Workspace Suspended",
        message: `Your workspace "${workspace.name}" has been suspended by Focura admin.${reason ? ` Reason: ${reason}` : ""}`,
        actionUrl: "/dashboard",
      }).catch((e) =>
        console.error("Workspace suspend notification failed:", e),
      );
    }

    void sendWorkspaceDeletedEmail({
      toEmail: ownerInfo.ownerEmail,
      toName: ownerInfo.ownerName,
      workspaceName: ownerInfo.workspaceName,
      reason,
      hardDelete,
    }).catch((e) => console.error("Workspace delete email failed:", e));

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
    assertFocuraAdmin(req);

    const { slug } = req.params;
    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true,
        deletedAt: true,
        owner: { select: { id: true, name: true } },
      },
    });

    if (!workspace) throw new NotFoundError("Workspace");
    if (!workspace.deletedAt)
      throw new BadRequestError("Workspace is not suspended");

    await AdminRepository.restoreWorkspace(workspace.id);

    void notifyUser({
      userId: workspace.owner.id,
      senderId: req.user!.id,
      type: "PROJECT_UPDATE",
      title: "✅ Workspace Restored",
      message: "Your workspace has been restored by Focura admin.",
      actionUrl: "/dashboard",
    }).catch((e) => console.error("Workspace restore notification failed:", e));

    res.json({ success: true, message: "Workspace restored successfully" });
  },
);
