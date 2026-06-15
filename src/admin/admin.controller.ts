import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.js";
import { AdminRepository } from "./admin.repository.js";
import { isFocuraAdmin } from "../config/admin.config.js";
import { sendWorkspaceDeletedEmail, sendBanEmail } from './admin.email.js';
import { prisma } from "../lib/prisma.js";
import { notifyUser } from "../modules/notification/notification.helpers.js";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  workspaceId: z.string().optional(),
});

function guardAdmin(req: AuthRequest, res: Response): boolean {
  if (!isFocuraAdmin(req.user!.id)) {
    res
      .status(403)
      .json({ success: false, message: "Focura admin access required" });
    return false;
  }
  return true;
}

function handleError(res: Response, label: string, error: unknown) {
  console.error(`Admin ${label} error:`, error);
  res.status(500).json({ success: false, message: `Failed to ${label}` });
}

export const getAdminStats = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const data = await AdminRepository.getStats();
    res.json({ success: true, data });
  } catch (e) {
    handleError(res, "fetch stats", e);
  }
};

export const getAdminWorkspaces = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const params = paginationSchema.parse(req.query);
    const result = await AdminRepository.getWorkspaces(params);
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, "fetch workspaces", e);
  }
};

// By SLUG not id
export const getAdminWorkspaceDetail = async (
  req: AuthRequest,
  res: Response,
) => {
  if (!guardAdmin(req, res)) return;
  try {
    const workspace = await AdminRepository.getWorkspaceDetailBySlug(
      req.params.slug,
    );
    if (!workspace) {
      res.status(404).json({ success: false, message: "Workspace not found" });
      return;
    }
    res.json({ success: true, data: workspace });
  } catch (e) {
    handleError(res, "fetch workspace detail", e);
  }
};

export const getAdminUsers = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const params = paginationSchema.parse(req.query);
    const result = await AdminRepository.getUsers(params);
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, "fetch users", e);
  }
};

export const getAdminUserDetail = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const user = await AdminRepository.getUserDetail(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    res.json({ success: true, data: user });
  } catch (e) {
    handleError(res, "fetch user detail", e);
  }
};

export const getAdminProjects = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const params = paginationSchema.parse(req.query);
    const result = await AdminRepository.getProjects(params);
    console.log("Admin projects result:", result); // Debugging log
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, "fetch projects", e);
  }
};

export const getAdminBilling = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const params = paginationSchema.parse(req.query);
    const result = await AdminRepository.getBilling(params);
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, "fetch billing", e);
  }
};

export const getAdminActivity = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const params = paginationSchema.parse(req.query);
    const result = await AdminRepository.getActivity(params);
    res.json({ success: true, ...result });
  } catch (e) {
    handleError(res, "fetch activity", e);
  }
};


const banUserSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
});

const deleteWorkspaceSchema = z.object({
  reason:     z.string().max(500).optional(),
  hardDelete: z.boolean().default(false),
});

export const banUser = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const { id }    = req.params;
    const { reason } = banUserSchema.parse(req.body);

    // Prevent banning another admin
    if (isFocuraAdmin(id)) {
      res.status(403).json({ success: false, message: 'Cannot ban another Focura admin' });
      return;
    }

    const user = await prisma.user.findUnique({
      where:  { id },
      select: { id: true, name: true, email: true, bannedAt: true },
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (user.bannedAt) {
      res.status(400).json({ success: false, message: 'User is already banned' });
      return;
    }

    await AdminRepository.banUser(id, req.user!.id, reason);

    // Fire-and-forget: email + in-app notification
    void sendBanEmail({
      toEmail: user.email,
      toName:  user.name ?? 'User',
      reason,
    }).catch((e) => console.error('Ban email failed:', e));

    res.json({ success: true, message: 'User banned successfully' });
  } catch (e) { handleError(res, 'ban user', e); }
};

export const unbanUser = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where:  { id },
      select: { bannedAt: true },
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (!user.bannedAt) {
      res.status(400).json({ success: false, message: 'User is not banned' });
      return;
    }

    await AdminRepository.unbanUser(id);
    res.json({ success: true, message: 'User unbanned successfully' });
  } catch (e) { handleError(res, 'unban user', e); }
};

export const deleteWorkspace = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const { slug }                = req.params;
    const { reason, hardDelete }  = deleteWorkspaceSchema.parse(req.body);

    // Find workspace first to get owner for notification
    const workspace = await prisma.workspace.findUnique({
      where:  { slug },
      select: {
        id:    true,
        name:  true,
        owner: { select: { id: true, name: true, email: true } },
        deletedAt: true,
      },
    });

    if (!workspace) {
      res.status(404).json({ success: false, message: 'Workspace not found' });
      return;
    }
    if (workspace.deletedAt && !hardDelete) {
      res.status(400).json({ success: false, message: 'Workspace is already soft-deleted. Use hardDelete to permanently remove.' });
      return;
    }

    const ownerInfo = hardDelete
      ? await AdminRepository.hardDeleteWorkspace(workspace.id)
      : await AdminRepository.softDeleteWorkspace(workspace.id, req.user!.id, reason);

    // In-app notification (only for soft delete — hard delete removes the user's data)
    if (!hardDelete) {
      void notifyUser({
        userId:    workspace.owner.id,
        senderId:  req.user!.id,
        type:      'PROJECT_UPDATE',
        title:     '⚠️ Workspace Suspended',
        message:   `Your workspace "${workspace.name}" has been suspended by Focura admin.${reason ? ` Reason: ${reason}` : ''}`,
        actionUrl: '/dashboard',
      }).catch((e) => console.error('Workspace suspend notification failed:', e));
    }

    // Email notification — always
    void sendWorkspaceDeletedEmail({
      toEmail:       ownerInfo.ownerEmail,
      toName:        ownerInfo.ownerName,
      workspaceName: ownerInfo.workspaceName,
      reason,
      hardDelete,
    }).catch((e) => console.error('Workspace delete email failed:', e));

    res.json({
      success: true,
      message: hardDelete
        ? 'Workspace permanently deleted'
        : 'Workspace suspended (soft deleted)',
    });
  } catch (e) { handleError(res, 'delete workspace', e); }
};

export const restoreWorkspace = async (req: AuthRequest, res: Response) => {
  if (!guardAdmin(req, res)) return;
  try {
    const { slug } = req.params;

    const workspace = await prisma.workspace.findUnique({
      where:  { slug },
      select: { id: true, deletedAt: true, owner: { select: { id: true, name: true } } },
    });

    if (!workspace) {
      res.status(404).json({ success: false, message: 'Workspace not found' });
      return;
    }
    if (!workspace.deletedAt) {
      res.status(400).json({ success: false, message: 'Workspace is not suspended' });
      return;
    }

    await AdminRepository.restoreWorkspace(workspace.id);

    void notifyUser({
      userId:    workspace.owner.id,
      senderId:  req.user!.id,
      type:      'PROJECT_UPDATE',
      title:     '✅ Workspace Restored',
      message:   'Your workspace has been restored by Focura admin.',
      actionUrl: '/dashboard',
    }).catch((e) => console.error('Workspace restore notification failed:', e));

    res.json({ success: true, message: 'Workspace restored successfully' });
  } catch (e) { handleError(res, 'restore workspace', e); }
};