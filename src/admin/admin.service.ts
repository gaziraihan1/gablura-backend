import { WorkspacePlan } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isFocuraAdmin } from "../config/admin.config.js";
import { sendWorkspaceDeletedEmail, sendBanEmail } from "./admin.email.js";
import { notifyUser } from "../modules/notification/notification.helpers.js";
import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import {
  queryWorkspaceForGuard,
  queryUserForGuard,
} from "./admin.query.js";
import {
  mutateBanUser,
  mutateUnbanUser,
  mutateSoftDeleteWorkspace,
  mutateHardDeleteWorkspace,
  mutateRestoreWorkspace,
  mutateUpdateWorkspaceLimits,
} from "./admin.mutation.js";

// ─── Guards ────────────────────────────────────────────────────────────────────

export function assertFocuraAdmin(userId: string): void {
  if (!isFocuraAdmin(userId)) {
    throw new ForbiddenError("Focura admin access required");
  }
}

// ─── Workspace limits ──────────────────────────────────────────────────────────

export async function serviceUpdateWorkspaceLimits(
  slug:      string,
  adminId:   string,
  plan:      WorkspacePlan,
  maxMembers: number,
  maxStorage: number,
) {
  const workspace = await queryWorkspaceForGuard(slug);
  if (!workspace) throw new NotFoundError("Workspace");

  if (maxMembers !== -1 && maxMembers < workspace._count.members) {
    throw new BadRequestError(
      `maxMembers (${maxMembers}) cannot be less than the current member count (${workspace._count.members})`,
    );
  }

  if (maxStorage !== -1) {
    const storageAgg = await prisma.file.aggregate({
      where: { workspaceId: workspace.id },
      _sum:  { size: true },
    });
    const usedMb = Math.round((storageAgg._sum.size ?? 0) / (1024 * 1024));
    if (maxStorage < usedMb) {
      throw new BadRequestError(
        `maxStorage (${maxStorage} MB) cannot be less than current usage (${usedMb} MB)`,
      );
    }
  }

  const updated = await mutateUpdateWorkspaceLimits(workspace.id, {
    plan,
    maxMembers,
    maxStorage,
  });

  // Fire-and-forget notification
  void notifyUser({
    userId:    workspace.owner.id,
    senderId:  adminId,
    type:      "PROJECT_UPDATE",
    title:     "📦 Workspace Plan Updated",
    message:   `Your workspace "${workspace.name}" has been updated to the ${plan} plan.`,
    actionUrl: "/dashboard",
  }).catch((e) => console.error("Workspace limits notification failed:", e));

  return updated;
}

// ─── User moderation ───────────────────────────────────────────────────────────

export async function serviceBanUser(
  targetId: string,
  adminId:  string,
  reason:   string,
): Promise<void> {
  if (isFocuraAdmin(targetId)) {
    throw new ForbiddenError("Cannot ban another Focura admin");
  }

  const user = await queryUserForGuard(targetId);
  if (!user) throw new NotFoundError("User");
  if (user.bannedAt) throw new BadRequestError("User is already banned");

  await mutateBanUser(targetId, adminId, reason);

  void sendBanEmail({
    toEmail: user.email,
    toName:  user.name ?? "User",
    reason,
  }).catch((e) => console.error("Ban email failed:", e));
}

export async function serviceUnbanUser(targetId: string): Promise<void> {
  const user = await queryUserForGuard(targetId);
  if (!user) throw new NotFoundError("User");
  if (!user.bannedAt) throw new BadRequestError("User is not banned");

  await mutateUnbanUser(targetId);
}

// ─── Workspace moderation ──────────────────────────────────────────────────────

export async function serviceDeleteWorkspace(
  slug:       string,
  adminId:    string,
  reason?:    string,
  hardDelete = false,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, deletedAt: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  if (!workspace) throw new NotFoundError("Workspace");
  if (workspace.deletedAt && !hardDelete) {
    throw new BadRequestError(
      "Workspace is already soft-deleted. Use hardDelete to permanently remove.",
    );
  }

  const ownerInfo = hardDelete
    ? await mutateHardDeleteWorkspace(workspace.id)
    : await mutateSoftDeleteWorkspace(workspace.id, adminId, reason);

  if (!hardDelete) {
    void notifyUser({
      userId:    workspace.owner.id,
      senderId:  adminId,
      type:      "PROJECT_UPDATE",
      title:     "⚠️ Workspace Suspended",
      message:   `Your workspace "${workspace.name}" has been suspended by Focura admin.${reason ? ` Reason: ${reason}` : ""}`,
      actionUrl: "/dashboard",
    }).catch((e) =>
      console.error("Workspace suspend notification failed:", e),
    );
  }

  void sendWorkspaceDeletedEmail({
    toEmail:       ownerInfo.ownerEmail,
    toName:        ownerInfo.ownerName,
    workspaceName: ownerInfo.workspaceName,
    reason,
    hardDelete,
  }).catch((e) => console.error("Workspace delete email failed:", e));
}

export async function serviceRestoreWorkspace(
  slug:    string,
  adminId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where:  { slug },
    select: {
      id: true, deletedAt: true,
      owner: { select: { id: true, name: true } },
    },
  });

  if (!workspace) throw new NotFoundError("Workspace");
  if (!workspace.deletedAt) {
    throw new BadRequestError("Workspace is not suspended");
  }

  await mutateRestoreWorkspace(workspace.id);

  void notifyUser({
    userId:    workspace.owner.id,
    senderId:  adminId,
    type:      "PROJECT_UPDATE",
    title:     "✅ Workspace Restored",
    message:   "Your workspace has been restored by Focura admin.",
    actionUrl: "/dashboard",
  }).catch((e) => console.error("Workspace restore notification failed:", e));
}