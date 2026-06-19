import { WorkspacePlan } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// ─── Workspace mutations ───────────────────────────────────────────────────────

export async function mutateUpdateWorkspaceLimits(
  workspaceId: string,
  data: { plan: WorkspacePlan; maxMembers: number; maxStorage: number },
): Promise<{
  id: string; slug: string; name: string;
  plan: WorkspacePlan; maxMembers: number; maxStorage: number;
}> {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      id: true, slug: true, name: true,
      plan: true, maxMembers: true, maxStorage: true,
    },
  });
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
      owner: { select: { email: true, name: true } },
    },
  });

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
      owner: { select: { id: true, email: true, name: true } },
    },
  });

  if (!ws) throw new Error("NOT_FOUND: Workspace not found");

  await prisma.workspace.delete({ where: { id: workspaceId } });

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
}