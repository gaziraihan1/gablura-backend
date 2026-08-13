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
import { WorkspaceCache, AccessControlCache } from "../../lib/redis/cache.client.js";
import { ConflictError, BadRequestError, ForbiddenError, NotFoundError } from "../../errors/AppError.js";
import { addInvalidateCacheJob } from "../../queue/index.js";

type OnWorkspaceCreated = (data: { workspace: any }) => Promise<void>;
type OnWorkspaceUpdated = (data: { workspace: any }) => Promise<void>;
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
    // generateUniqueSlug() checks-then-inserts, so two concurrent creates of
    // the same name can both pass the check and one hits the slug unique
    // constraint. Retry once with a freshly generated slug — the retry sees
    // the conflicting row and appends a counter. Any other error propagates.
    const createWithSlug = (slug: string) =>
      prisma.workspace.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          color: input.color || "#667eea",
          logo: input.logo,
          isPublic: input.isPublic || false,
          // Plan is never client-settable at creation — paid tiers require an
          // active subscription (billing flow) or a Focura-admin override.
          plan: "FREE",
          ownerId: userId,
          members: { create: { userId, role: "OWNER" } },
        },
        include: workspaceListInclude,
      });

    let workspace;
    try {
      workspace = await createWithSlug(await generateUniqueSlug(input.name));
    } catch (err: any) {
      const isSlugConflict =
        err?.code === "P2002" &&
        (Array.isArray(err?.meta?.target)
          ? err.meta.target.includes("slug")
          : true);
      if (!isSlugConflict) throw err;
      workspace = await createWithSlug(await generateUniqueSlug(input.name));
    }

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
    await WorkspaceAccess.assertNotSuspended(workspaceId);

    // `slug` is not client-settable on update (see updateWorkspaceSchema), so
    // a P2002 here is only reachable via an internal caller or a future
    // regression. Surface it as a clean 409 instead of a raw DB error.
    let workspace;
    try {
      workspace = await prisma.workspace.update({
        where: { id: workspaceId },
        data: input,
        include: workspaceListInclude,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ConflictError(
          "A workspace with this slug already exists",
          "SLUG_TAKEN",
        );
      }
      throw err;
    }

    // Invalidate workspace cache
    await WorkspaceCache.invalidateWorkspace(workspaceId, workspace.slug);

    if (onUpdated) onUpdated({ workspace }).catch(console.error);
    return workspace;
  },

  async delete(workspaceId: string, userId: string) {
    await WorkspaceAccess.assertOwner(workspaceId, userId);
    await WorkspaceAccess.assertNotSuspended(workspaceId);

    // Get workspace slug before soft-deleting
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true, ownerId: true },
    });

    // SOFT DELETE — the owner endpoint never hard-deletes. Marking deletedAt
    // hides the workspace everywhere (all queries filter it) while keeping the
    // data recoverable through the admin restore flow
    // (PATCH /admin/workspaces/:slug/restore). Permanent removal is reserved
    // for Focura admins (admin hardDelete), so an accidental delete is not
    // destructive.
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        deletedAt:    new Date(),
        deletedById:  userId,
        deleteReason: "Deleted by owner",
      },
    });

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
    await WorkspaceAccess.assertAdmin(workspaceId, inviterId); // already throws ForbiddenError
    await WorkspaceAccess.assertNotSuspended(workspaceId);

    // Parallelize independent duplicate-check queries
    const [existing, member] = await Promise.all([
      prisma.workspaceInvitation.findFirst({
        where: { workspaceId, email, status: "PENDING" },
      }),
      prisma.workspaceMember.findFirst({
        where: { workspaceId, user: { email } },
      }),
    ]);

    if (existing) throw new ConflictError("User has already been invited");
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

    // Ownership can only exist via workspace creation — never via invitations.
    if (invitation.role === "OWNER") {
      throw new BadRequestError("Invalid invitation role", "INVALID_INVITATION_ROLE");
    }

    try {
      await prisma.workspaceMember.create({
        data: {
          userId,
          workspaceId: invitation.workspaceId,
          role: invitation.role,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ConflictError(
          "You are already a member of this workspace",
          "ALREADY_MEMBER",
        );
      }
      throw err;
    }
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED" },
    });
// Invalidate member-related caches (fire-and-forget — don't block the response)
if (invitation.workspaceId) {
  const workspaceSlug = invitation.workspace?.slug ?? undefined;
  WorkspaceCache.invalidateMembers(invitation.workspaceId).catch(() => {});
  WorkspaceCache.invalidateUserWorkspaces(userId).catch(() => {});
  WorkspaceCache.invalidateWorkspace(invitation.workspaceId, workspaceSlug).catch(() => {});
  AccessControlCache.invalidateWorkspaceAccess(invitation.workspaceId, userId).catch(() => {});
  AccessControlCache.invalidateWorkspaceUsers(invitation.workspaceId).catch(() => {});
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
    const remover = await WorkspaceAccess.assertAdmin(workspaceId, removerId); // throws ForbiddenError
    await WorkspaceAccess.assertNotSuspended(workspaceId);

    const member = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      include: {
        user: { select: { id: true, name: true, notifications: true } },
        workspace: { select: { name: true } },
      },
    });
    if (!member) throw new NotFoundError("Member");
    if (member.workspaceId !== workspaceId) throw new NotFoundError("Member");

    // G1 hardening: the owner can never be removed, and only the OWNER can
    // remove an ADMIN (prevents admin-only takeover / owner lockout).
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (!workspace) throw new NotFoundError("Workspace");
    if (member.role === "OWNER" || member.userId === workspace.ownerId) {
      throw new ForbiddenError("Cannot remove the workspace owner", "CANNOT_REMOVE_OWNER");
    }
    if (remover.role === "ADMIN" && member.role === "ADMIN") {
      throw new ForbiddenError("Only the workspace owner can remove admins", "CANNOT_REMOVE_ADMIN");
    }

    await prisma.workspaceMember.delete({ where: { id: memberId } });
    addInvalidateCacheJob({ type: 'access-control', workspaceId }).catch(() => {});
    // Wipe the user-scoped detail caches — the payload includes the member
    // roster, so a removed member must lose access (and other members must
    // stop seeing them) immediately instead of waiting for the TTL.
    WorkspaceCache.invalidateWorkspace(workspaceId).catch(() => {});
    if (onRemoved) onRemoved({ member }).catch(console.error);
  },

  async updateMemberRole(
    workspaceId: string,
    updaterId: string,
    memberId: string,
    role: WorkspaceRole,
    onUpdated?: OnRoleUpdated,
  ) {
    const validRoles: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"];
    if (!validRoles.includes(role)) {
      throw new BadRequestError(`Invalid role. Must be one of: ${validRoles.join(", ")}`);
    }

    const updater = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: updaterId, role: "OWNER" },
      include: { workspace: { select: { name: true } } },
    });
    if (!updater) throw new ForbiddenError("Only the workspace owner can change roles");
    await WorkspaceAccess.assertNotSuspended(workspaceId);

    // Verify the member record belongs to this workspace
    const targetMember = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { workspaceId: true, role: true, userId: true },
    });
    if (!targetMember || targetMember.workspaceId !== workspaceId) {
      throw new NotFoundError("Member");
    }

    if (targetMember.role === "OWNER") {
      throw new ForbiddenError(
        "Cannot change the workspace owner's role",
        "CANNOT_CHANGE_OWNER_ROLE",
      );
    }

    // Ownership transfer: the current owner can hand the workspace to any
    // other member. The new owner is promoted, the previous owner is demoted
    // to ADMIN (they stay a member, so there is no lockout), and the
    // workspace's ownerId moves to the new owner. Exactly one OWNER exists
    // at all times.
    if (role === "OWNER") {
      const transferTarget = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true, slug: true },
      });
      if (!transferTarget) throw new NotFoundError("Workspace");
      if (transferTarget.ownerId === targetMember.userId) {
        throw new ForbiddenError(
          "This member already owns the workspace",
          "ALREADY_OWNER",
        );
      }

      const promoted = await prisma.$transaction(async (tx) => {
        const member = await tx.workspaceMember.update({
          where: { id: memberId },
          data: { role: "OWNER" },
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
        // Demote by the verified owner's member row (updaterId) rather than
        // the possibly-stale workspace.ownerId column, so exactly one OWNER
        // exists even if the ownerId record is inconsistent.
        await tx.workspaceMember.updateMany({
          where: { workspaceId, userId: updater.userId, role: "OWNER" },
          data: { role: "ADMIN" },
        });
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { ownerId: targetMember.userId },
        });
        return member;
      });

      await WorkspaceCache.invalidateWorkspace(workspaceId, transferTarget.slug).catch(() => {});
      addInvalidateCacheJob({ type: "access-control", workspaceId }).catch(() => {});
      if (onUpdated)
        onUpdated({ member: promoted, workspaceName: updater.workspace?.name ?? "" }).catch(console.error);
      return promoted;
    }

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
    addInvalidateCacheJob({ type: 'access-control', workspaceId }).catch(() => {});
    // Role changes alter the member roster served by the detail payload.
    WorkspaceCache.invalidateWorkspace(workspaceId).catch(() => {});
    return member;
  },

  async leaveWorkspace(workspaceId: string, userId: string) {
   const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member) throw new BadRequestError("You are not a member of this workspace", "NOT_MEMBER");
   await WorkspaceAccess.assertNotSuspended(workspaceId);
    if (member.role === "OWNER")
      throw new BadRequestError("Transfer ownership before leaving", "OWNER_CANNOT_LEAVE");

    await prisma.workspaceMember.delete({ where: { id: member.id } });
    addInvalidateCacheJob({ type: 'access-control', workspaceId }).catch(() => {});
    // The leaver's own user-scoped detail entry must not survive.
    WorkspaceCache.invalidateWorkspace(workspaceId).catch(() => {});
  },
};