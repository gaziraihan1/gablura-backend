import type { Response, Request } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  WorkspaceQuery,
  WorkspaceMutation,
  WorkspaceActivity,
  WorkspaceNotifications,
} from "./index.js";
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteMemberSchema,
} from "./workspace.validators.js";
import { prisma } from "../../lib/prisma.js";
import { TaskQuery } from "../task/task.query.js";
import { asyncHandler, ValidationError } from "../../errors/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeId(param: string): boolean {
  return /^[a-z0-9]{20,}$/i.test(param);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const getAllWorkspaces = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspaces = await WorkspaceQuery.getUserWorkspaces(req.user!.id);
    res.json({ success: true, data: workspaces });
  },
);

export const createWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const workspace = await WorkspaceMutation.create(
      req.user!.id,
      parsed.data,
      async ({ workspace }) => {
        void WorkspaceActivity.logCreated({
          workspaceId: workspace.id,
          userId: req.user!.id,
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
        });
      },
    );

    res
      .status(201)
      .json({
        success: true,
        data: workspace,
        message: "Workspace created successfully",
      });
  },
);

export const getWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { slug } = req.params;
    const workspace = looksLikeId(slug)
      ? await WorkspaceQuery.getById(slug, req.user!.id)
      : await WorkspaceQuery.getBySlug(slug, req.user!.id);

    res.json({ success: true, data: workspace });
  },
);

export const getWorkspaceOverview = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const overview = await WorkspaceQuery.getOverview(
      req.params.slug,
      req.user!.id,
    );
    res.json({ success: true, data: overview });
  },
);

export const getWorkspaceTasks = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { workspaceSlug } = req.params;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    // Reuses the existing public-or-member read gate (throws NotFound for
    // workspaces the requesting user cannot view). Callers (dashboard
    // TaskHighlights) iterate the user's own workspaces, so the requester is
    // always a member; the TaskQuery workspace filter below is membership-
    // scoped, so a non-member hitting a public workspace gets an empty list.
    const workspace = (looksLikeId(workspaceSlug)
      ? await WorkspaceQuery.getById(workspaceSlug, req.user!.id)
      : await WorkspaceQuery.getBySlug(workspaceSlug, req.user!.id)) as
      | { id: string }
      | null;

    if (!workspace) {
      res.status(404).json({ success: false, message: "Workspace not found" });
      return;
    }

    const result = await TaskQuery.getTasks(
      { userId: req.user!.id, workspaceId: workspace.id },
      { page: 1, pageSize: limit },
      { sortBy: "createdAt", sortOrder: "desc" },
    );

    res.json({ success: true, data: result.data });
  },
);

export const updateWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = updateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const workspace = await WorkspaceMutation.update(
      req.params.id,
      req.user!.id,
      parsed.data,
      async ({ workspace }) => {
        void WorkspaceActivity.logUpdated({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          userId: req.user!.id,
        });
      },
    );

    res.json({
      success: true,
      data: workspace,
      message: "Workspace updated successfully",
    });
  },
);

export const deleteWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await WorkspaceMutation.delete(req.params.id, req.user!.id);
    res.json({ success: true, message: "Workspace deleted successfully" });
  },
);

export const getMembers = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const members = await WorkspaceQuery.getMembers(
      req.params.id,
      req.user!.id,
    );
    res.json({ success: true, data: members });
  },
);

export const inviteMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const parsed = inviteMemberSchema.safeParse(req.body);
    if (!parsed.success)
      throw new ValidationError("Validation error", parsed.error.issues);

    const invitation = await WorkspaceMutation.inviteMember(
      req.params.id,
      req.user!.id,
      parsed.data.email,
      parsed.data.role,
      async ({ invitation, inviterName }) => {
        const invitedUser = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, notifications: true },
        });
        if (invitedUser?.notifications && invitation.workspace) {
          void WorkspaceNotifications.notifyInvited({
            invitedUserId: invitedUser.id,
            inviterId: req.user!.id,
            inviterName,
            workspaceName: invitation.workspace.name,
            token: invitation.token,
          });
        }
      },
    );

    res
      .status(201)
      .json({
        success: true,
        data: invitation,
        message: "Invitation sent successfully",
      });
  },
);

export const getInvitation = asyncHandler(
  async (req: Request, res: Response) => {
    const invitation = await WorkspaceQuery.getInvitationByToken(
      req.params.token,
    );
    res.json({ success: true, data: invitation });
  },
);

export const acceptInvitation = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const workspace = await WorkspaceMutation.acceptInvitation(
      req.params.token,
      req.user!.id,
      async ({ workspace, invitedBy, userName }) => {
        const inviter = await prisma.user.findUnique({
          where: { id: invitedBy },
          select: { notifications: true },
        });
        if (inviter?.notifications) {
          void WorkspaceNotifications.notifyAccepted({
            inviterId: invitedBy,
            userId: req.user!.id,
            userName,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
          });
        }
        void WorkspaceNotifications.notifyAdmins({
          workspaceId: workspace.id,
          excludeUserId: invitedBy,
          senderId: req.user!.id,
          senderName: userName,
          workspaceName: workspace.name,
          workspaceSlug: workspace.slug,
        });
      },
    );

    res.json({
      success: true,
      data: workspace,
      message: "Invitation accepted successfully",
    });
  },
);

export const removeMember = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await WorkspaceMutation.removeMember(
      req.params.id,
      req.user!.id,
      req.params.memberId,
      async ({ member }) => {
        if (member.user.notifications) {
          void WorkspaceNotifications.notifyRemoved({
            removedUserId: member.userId,
            removerId: req.user!.id,
            workspaceName: member.workspace.name,
          });
        }
      },
    );

    res.json({ success: true, message: "Member removed successfully" });
  },
);

export const updateMemberRole = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { role } = req.body;

    const member = await WorkspaceMutation.updateMemberRole(
      req.params.id,
      req.user!.id,
      req.params.memberId,
      role,
      async ({ member, workspaceName }) => {
        if (member.user.notifications) {
          void WorkspaceNotifications.notifyRoleChanged({
            userId: member.userId,
            updaterId: req.user!.id,
            workspaceName,
            workspaceId: req.params.id,
            role,
          });
        }
      },
    );

    res.json({
      success: true,
      data: member,
      message: "Member role updated successfully",
    });
  },
);

export const getStats = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const stats = await WorkspaceQuery.getStats(req.params.id, req.user!.id);
    res.json({ success: true, data: stats });
  },
);

export const leaveWorkspace = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    await WorkspaceMutation.leaveWorkspace(req.params.id, req.user!.id);
    res.json({ success: true, message: "You have left the workspace" });
  },
);
