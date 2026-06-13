import { prisma } from "../../lib/prisma.js";
import crypto from "crypto";
import { sendInvitationEmail } from "../../utils/email.js";
import { WorkspaceAccess } from "./workspace.access.js";
import { workspaceListInclude } from "./workspace.selects.js";
import { generateUniqueSlug } from "./workspace.utils.js";
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceRole,
} from "./workspace.types.js";
import { WorkspaceCache } from "../../lib/redis/cache.client.js";
import { ConflictError, BadRequestError, ForbiddenError, NotFoundError, PlanLimitError } from "../../errors/AppError.js";

type OnWorkspaceCreated = (data: { workspace: any }) => Promise<void>;
type OnWorkspaceUpdated = (data: { workspaceId: string }) => Promise<void>;
type OnMemberInvited = (data: {
  invitation: any;
  inviterName: string;
}) => Promise<void>;
type OnInvitationAccepted = (data: {
  workspace: any;
  invitedBy: string;
  userName: string;
}) => Promise<void>;
type OnMemberRemoved = (data: { member: any }) => Promise<void>;
type OnRoleUpdated = (data: {
  member: any;
  workspaceName: string;
}) => Promise<void>;

export const WorkspaceMutation = {
  async create(
    userId: string,
    input: CreateWorkspaceInput,
    onCreated?: OnWorkspaceCreated,
  ) {
    const slug = await generateUniqueSlug(input.name);
    const workspace = await prisma.workspace.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        color: input.color || "#667eea",
        logo: input.logo,
        isPublic: input.isPublic || false,
        plan: input.plan || "FREE",
        ownerId: userId,
        members: { create: { userId, role: "OWNER" } },
      },
      include: workspaceListInclude,
    });

    // Invalidate user's workspace list cache
    await WorkspaceCache.invalidateUserWorkspaces(userId);

    if (onCreated) onCreated({ workspace }).catch(console.error);
    return workspace;
  },

  async update(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceInput,
    onUpdated?: OnWorkspaceUpdated,
  ) {
    await WorkspaceAccess.assertAdmin(workspaceId, userId);
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: input,
      include: workspaceListInclude,
    });

    // Invalidate workspace cache
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace.slug);

    if (onUpdated) onUpdated({ workspaceId }).catch(console.error);
    return workspace;
  },

  async delete(workspaceId: string, userId: string) {
    await WorkspaceAccess.assertOwner(workspaceId, userId);

    // Get workspace slug before deleting
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true, ownerId: true },
    });

    await prisma.workspace.delete({ where: { id: workspaceId } });

    // Invalidate workspace cache
    if (workspace) {
      await WorkspaceCache.invalidateWorkspace(workspaceId, workspace.slug);
      await WorkspaceCache.invalidateUserWorkspaces(workspace.ownerId);
    }
  },

  async inviteMember(
    workspaceId: string,
    inviterId: string,
    email: string,
    role: WorkspaceRole,
    onInvited?: OnMemberInvited,
  ) {
    const inviter = await WorkspaceAccess.assertAdmin(workspaceId, inviterId); // already throws ForbiddenError

    const existing = await prisma.workspaceInvitation.findFirst({
      where: { workspaceId, email, status: "PENDING" },
    });
    if (existing) throw new ConflictError("User has already been invited");

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
    });
    if (member) throw new ConflictError("User is already a member");


    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const invitation = await prisma.workspaceInvitation.create({
      data: {
        email,
        role,
        token,
        workspaceId,
        invitedById: inviterId,
        expiresAt,
      },
      include: { workspace: true },
    });

    await sendInvitationEmail(email, invitation);
    if (onInvited) {
      const inviterUser = await prisma.user.findUnique({
        where: { id: inviterId },
        select: { name: true },
      });
      onInvited({
        invitation,
        inviterName: inviterUser?.name || "Someone",
      }).catch(console.error);
    }
    return invitation;
  },

  async acceptInvitation(
    token: string,
    userId: string,
    onAccepted?: OnInvitationAccepted,
  ) {
    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { token },
      include: { workspace: true },
    });
    if (!invitation) throw new BadRequestError("Invalid invitation token", "INVALID_TOKEN");
    if (invitation.status !== "PENDING") throw new BadRequestError("Invitation has already been used", "INVITATION_USED");
    if (invitation.expiresAt < new Date()) {
      await prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestError("Invitation has expired", "INVITATION_EXPIRED");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email !== invitation.email)
      throw new BadRequestError("This invitation was sent to a different email address", "EMAIL_MISMATCH");


    await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId: invitation.workspaceId,
        role: invitation.role,
      },
    });
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
// Invalidate member-related caches
if (invitation.workspaceId) {
  await WorkspaceCache.invalidateMembers(invitation.workspaceId);
  await WorkspaceCache.invalidateUserWorkspaces(userId);
  const workspaceSlug = invitation.workspace?.slug ?? undefined;
  await WorkspaceCache.invalidateWorkspace(invitation.workspaceId, workspaceSlug);
}

    if (onAccepted && invitation.invitedById) {
      onAccepted({
        workspace: invitation.workspace!,
        invitedBy: invitation.invitedById,
        userName: user.name || "Someone",
      }).catch(console.error);
    }
    return invitation.workspace;
  },

  async removeMember(
    workspaceId: string,
    removerId: string,
    memberId: string,
    onRemoved?: OnMemberRemoved,
  ) {
    await WorkspaceAccess.assertAdmin(workspaceId, removerId); // throws ForbiddenError

    const member = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      include: {
        user: { select: { id: true, name: true, notifications: true } },
        workspace: { select: { name: true } },
      },
    });
    if (!member) throw new NotFoundError("Member");

    await prisma.workspaceMember.delete({ where: { id: memberId } });
    if (onRemoved) onRemoved({ member }).catch(console.error);
  },

  async updateMemberRole(
    workspaceId: string,
    updaterId: string,
    memberId: string,
    role: WorkspaceRole,
    onUpdated?: OnRoleUpdated,
  ) {
    const updater = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: updaterId, role: "OWNER" },
      include: { workspace: { select: { name: true } } },
    });
    if (!updater) throw new ForbiddenError("Only the workspace owner can change roles");

    const member = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            notifications: true,
          },
        },
      },
    });
    if (onUpdated)
      onUpdated({ member, workspaceName: updater.workspace?.name ?? "" }).catch(
        console.error,
      );
    return member;
  },

  async leaveWorkspace(workspaceId: string, userId: string) {
   const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member) throw new BadRequestError("You are not a member of this workspace", "NOT_MEMBER");
    if (member.role === "OWNER")
      throw new BadRequestError("Transfer ownership before leaving", "OWNER_CANNOT_LEAVE");

    await prisma.workspaceMember.delete({ where: { id: member.id } });
  },
};