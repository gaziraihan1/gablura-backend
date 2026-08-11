import { WorkspacePlan } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isFocuraAdmin, isFocuraAdminUser } from "../config/admin.config.js";

import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import type { UpdateWorkspaceLimitsInput } from "./admin.validation.js";
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
import { addSendEmailJob, addSendNotificationJob } from "../queue/index.js";
import { ActivityMutation } from "../modules/activity/activity.mutation.js";

// ─── Guards ────────────────────────────────────────────────────────────────────

export function assertFocuraAdmin(userId: string, role: string): void {
  if (!isFocuraAdminUser(role, userId)) {
    throw new ForbiddenError("Focura admin access required");
  }
}

// ─── Limit-change summaries (used for notifications + emails) ─────────────────

const LIMIT_FIELD_LABELS: Record<string, string> = {
  plan:              "Plan",
  maxMembers:        "Max members",
  maxStorage:        "Max storage",
  aiDailyCalls:      "AI calls per day",
  aiMonthlyTokens:   "AI tokens per month",
  aiMaxOutputTokens: "AI max output per response",
};

export function formatLimitChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "default";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (field === "aiMonthlyTokens") {
    return n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
      : n.toLocaleString();
  }
  if (field === "maxStorage") return `${n.toLocaleString()} MB`;
  return n.toLocaleString();
}

export interface LimitChangePart {
  field: string;
  label: string;
  from: string;
  to: string;
}

export function buildLimitChangeSummary(
  changes: Record<string, { from: unknown; to: unknown }>,
): LimitChangePart[] {
  return Object.entries(changes).map(([field, c]) => ({
    field,
    label: LIMIT_FIELD_LABELS[field] ?? field,
    from:  formatLimitChangeValue(field, c.from),
    to:    formatLimitChangeValue(field, c.to),
  }));
}

// ─── Workspace limits ──────────────────────────────────────────────────────────

export async function serviceUpdateWorkspaceLimits(
  slug:    string,
  adminId: string,
  input:   UpdateWorkspaceLimitsInput,
) {
  const {
    plan,
    maxMembers,
    maxStorage,
    aiDailyCalls,
    aiMonthlyTokens,
    aiMaxOutputTokens,
  } = input;

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

  const data: Parameters<typeof mutateUpdateWorkspaceLimits>[1] = {
    plan,
    maxMembers,
    maxStorage,
  };
  // PATCH semantics — only touch the AI overrides the caller actually sent
  // (null explicitly clears back to the plan default).
  if ("aiDailyCalls" in input) data.aiDailyCalls = aiDailyCalls ?? null;
  if ("aiMonthlyTokens" in input) data.aiMonthlyTokens = aiMonthlyTokens ?? null;
  if ("aiMaxOutputTokens" in input) data.aiMaxOutputTokens = aiMaxOutputTokens ?? null;

  const updated = await mutateUpdateWorkspaceLimits(workspace.id, data);

  // Audit — record exactly what changed (old → new) so admins can see who
  // raised which cap. Skipped when nothing actually changed (no-op re-save).
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (updated.plan !== workspace.plan) {
    changes.plan = { from: workspace.plan, to: updated.plan };
  }
  if (updated.maxMembers !== workspace.maxMembers) {
    changes.maxMembers = { from: workspace.maxMembers, to: updated.maxMembers };
  }
  if (updated.maxStorage !== workspace.maxStorage) {
    changes.maxStorage = { from: workspace.maxStorage, to: updated.maxStorage };
  }
  if (updated.aiDailyCalls !== workspace.aiDailyCalls) {
    changes.aiDailyCalls = { from: workspace.aiDailyCalls, to: updated.aiDailyCalls };
  }
  if (updated.aiMonthlyTokens !== workspace.aiMonthlyTokens) {
    changes.aiMonthlyTokens = { from: workspace.aiMonthlyTokens, to: updated.aiMonthlyTokens };
  }
  if (updated.aiMaxOutputTokens !== workspace.aiMaxOutputTokens) {
    changes.aiMaxOutputTokens = { from: workspace.aiMaxOutputTokens, to: updated.aiMaxOutputTokens };
  }

  if (Object.keys(changes).length > 0) {
    try {
      await ActivityMutation.createActivity({
        action:        "UPDATED",
        entityType:    "WORKSPACE",
        entityId:      workspace.id,
        userId:        adminId,
        workspaceId:   workspace.id,
        workspaceSlug: workspace.slug,
        metadata:      { source: "focura-admin", changes },
      });
    } catch (e) {
      // Audit logging must never fail the limits update itself.
      console.error("Failed to log workspace limits change:", e);
    }

    // Notify the owner in-app + by email with a friendly summary of what
    // actually changed. Skipped entirely on no-op re-saves. The in-app
    // message is capped so it stays readable in the notification bell;
    // the email carries the full list.
    const summary = buildLimitChangeSummary(changes);
    const summaryText =
      summary
        .slice(0, 3)
        .map((c) => `${c.label} ${c.from} → ${c.to}`)
        .join(", ") + (summary.length > 3 ? ` +${summary.length - 3} more` : "");

    addSendNotificationJob({
      userId:    workspace.owner.id,
      senderId:  adminId,
      type:      "PROJECT_UPDATE",
      title:     "📦 Workspace Limits Updated",
      message:   `A Focura admin updated "${workspace.name}": ${summaryText}.`,
      actionUrl: "/dashboard",
    }).catch((e) => console.error("Workspace limits notification failed:", e));

    addSendEmailJob({
      type: "workspace-limits-changed-email",
      to:   workspace.owner.email,
      data: {
        toEmail:       workspace.owner.email,
        toName:        workspace.owner.name ?? "User",
        workspaceName: workspace.name,
        changes:       summary,
      },
    }).catch((e) => console.error("Workspace limits email failed:", e));
  }

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

  addSendEmailJob({
    type: "ban-email",
    to: user.email,
    data: { toEmail: user.email, toName: user.name ?? "User", reason },
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
    addSendNotificationJob({
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

  addSendEmailJob({
    type: "workspace-deleted-email",
    to: ownerInfo.ownerEmail,
    data: {
      toEmail: ownerInfo.ownerEmail,
      toName: ownerInfo.ownerName,
      workspaceName: ownerInfo.workspaceName,
      reason,
      hardDelete,
    },
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

  addSendNotificationJob({
    userId:    workspace.owner.id,
    senderId:  adminId,
    type:      "PROJECT_UPDATE",
    title:     "✅ Workspace Restored",
    message:   "Your workspace has been restored by Focura admin.",
    actionUrl: "/dashboard",
  }).catch((e) => console.error("Workspace restore notification failed:", e));
}