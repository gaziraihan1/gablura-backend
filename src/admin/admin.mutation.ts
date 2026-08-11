import { WorkspacePlan } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { WorkspaceCache, UserCache } from "../lib/redis/cache.client.js";
import { invalidateWorkspaceAiConfig } from "../modules/ai/ai.ratelimit.js";

// ─── Workspace mutations ───────────────────────────────────────────────────────

export async function mutateUpdateWorkspaceLimits(
  workspaceId: string,
  data: {
    plan: WorkspacePlan;
    maxMembers: number;
    maxStorage: number;
    aiDailyCalls?: number | null;
    aiMonthlyTokens?: number | null;
    aiMaxOutputTokens?: number | null;
  },
): Promise<{
  id: string; slug: string; name: string;
  plan: WorkspacePlan; maxMembers: number; maxStorage: number;
  aiDailyCalls: number | null;
  aiMonthlyTokens: number | null;
  aiMaxOutputTokens: number | null;
}> {
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      id: true, slug: true, name: true,
      plan: true, maxMembers: true, maxStorage: true,
      aiDailyCalls: true, aiMonthlyTokens: true, aiMaxOutputTokens: true,
    },
  });

  await WorkspaceCache.invalidateWorkspace(updated.id, updated.slug);
  // AI limits are cached per-process for 60s — drop them so the new overrides
  // take effect immediately for this workspace.
  invalidateWorkspaceAiConfig(updated.id);

  return updated;
}

export async function mutateSoftDeleteWorkspace(
  workspaceId: string,
  adminId:     string,
  reason?:     string,
): Promise<{ ownerEmail: string; ownerName: string; workspaceName: string }> {
  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      deletedAt:    new Date(),
      deletedById:  adminId,
      deleteReason: reason ?? null,
    },
    select: {
      name:  true,
      slug:  true,
      owner: { select: { email: true, name: true } },
    },
  });

  // Invalidate metadata caches so the suspension applies immediately
  WorkspaceCache.invalidateWorkspace(workspaceId, ws.slug).catch(() => {});

  return {
    ownerEmail:    ws.owner.email,
    ownerName:     ws.owner.name  ?? "User",
    workspaceName: ws.name,
  };
}

export async function mutateHardDeleteWorkspace(
  workspaceId: string,
): Promise<{ ownerEmail: string; ownerName: string; workspaceName: string }> {
  // Fetch before delete so we can return owner info for notification/email
  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: {
      name:  true,
      slug:  true,
      owner: { select: { id: true, email: true, name: true } },
    },
  });

  if (!ws) throw new Error("NOT_FOUND: Workspace not found");

  await prisma.workspace.delete({ where: { id: workspaceId } });

  // Invalidate metadata caches so the deleted workspace disappears immediately
  WorkspaceCache.invalidateWorkspace(workspaceId, ws.slug).catch(() => {});

  return {
    ownerEmail:    ws.owner.email,
    ownerName:     ws.owner.name ?? "User",
    workspaceName: ws.name,
  };
}

export async function mutateRestoreWorkspace(workspaceId: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      deletedAt:    null,
      deletedById:  null,
      deleteReason: null,
    },
  });
}

// ─── User mutations ────────────────────────────────────────────────────────────

export async function mutateBanUser(
  userId:  string,
  adminId: string,
  reason:  string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      bannedAt:   new Date(),
      banReason:  reason,
      bannedById: adminId,
    },
  });
  
  // Invalidate user profile cache after ban
  await UserCache.invalidateProfile(userId);
}

export async function mutateUnbanUser(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      bannedAt:   null,
      banReason:  null,
      bannedById: null,
    },
  });
  
  // Invalidate user profile cache after unban
  await UserCache.invalidateProfile(userId);
}