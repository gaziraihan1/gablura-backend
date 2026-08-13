// backend/src/billing/middleware/plan.middleware.ts
// All guards check the *workspace's* plan, not the user's plan.
// workspaceId is always read from req.params.workspaceId.

import { Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma.js";
import { AuthRequest } from "../../middleware/auth.js";
import { BillingService } from "./billing.service.js";
import { PLAN_LIMITS, PlanName } from "./plans.config.js";
import { PlanLimitError } from "../../errors/AppError.js";

// ---------------------------------------------------------------------------
// Generic guard factory
// ---------------------------------------------------------------------------

type LimitChecker = (
  req: AuthRequest,
) => Promise<{ allowed: boolean; reason?: string }>;

function planGuard(checker: LimitChecker) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { allowed, reason } = await checker(req);

      if (!allowed) {
        return next(new PlanLimitError(reason || 'Plan limit exceeded'));
      }

      next();
    } catch (err) {
      console.error('[PlanMiddleware]', err);
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Workspace-scoped plan guards
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// USER-LEVEL GUARD — workspace *creation* only
//
// This is the only guard that looks at the USER rather than a specific workspace.
// It checks how many workspaces the user already owns against the limit
// granted by their HIGHEST active workspace plan.
//
// Example:
//   User owns Workspace A (FREE) + Workspace B (PRO)
//   → highest plan = PRO → maxWorkspacesOwned = 10
//   → user can create up to 10 workspaces total
//
// Mount this on POST /workspaces (workspace creation endpoint).
// ---------------------------------------------------------------------------
export const requireWorkspaceCreationSlot = planGuard(async (req) => {
  const userId = req.user?.id;

  const maxAllowed = await BillingService.getUserWorkspaceCreationLimit(
    userId!,
  );

  // -1 = unlimited (BUSINESS plan)
  if (maxAllowed === -1) return { allowed: true };

  const currentCount = await prisma.workspace.count({
    where: { ownerId: userId },
  });

  if (currentCount >= maxAllowed) {
    return {
      allowed: false,
      reason: `You can own up to ${maxAllowed} workspace(s) on your current plan. Upgrade any existing workspace to Pro or Business to create more.`,
    };
  }
  return { allowed: true };
});

/** True when the workspace has room for another member under its plan cap. */
async function hasMemberSlot(workspaceId: string): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  if (limits.maxMembersPerWs === -1) return { allowed: true };

  const count = await prisma.workspaceMember.count({ where: { workspaceId } });
  if (count >= limits.maxMembersPerWs) {
    return {
      allowed: false,
      reason: `This workspace's plan allows a maximum of ${limits.maxMembersPerWs} members. Upgrade this workspace to add more.`,
    };
  }
  return { allowed: true };
}

/** Block adding members beyond the workspace's plan member limit. */
export const requireMemberSlot = planGuard(async (req) => {
  const workspaceId = req.params.workspaceId ?? req.params.id;
  if (!workspaceId) {
    return { allowed: false, reason: 'Workspace ID could not be resolved from request params.' };
  }
  return hasMemberSlot(workspaceId);
});

/**
 * Member-slot guard for invitation ACCEPT (POST /invitations/:token/accept).
 * The route only carries the invitation :token, so the workspace is resolved
 * from the invitation before the same cap check as requireMemberSlot. Without
 * this, an over-limit workspace could keep growing through accepted invites.
 *
 * Unknown or non-PENDING invitations pass through — the accept controller
 * reports those with their canonical errors (INVALID_TOKEN / INVITATION_USED /
 * INVITATION_EXPIRED), which would be misleading to replace with a plan error.
 */
export const requireMemberSlotForInvitation = planGuard(async (req) => {
  const token = req.params.token;
  if (!token) {
    return { allowed: false, reason: 'Invitation token could not be resolved from request params.' };
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    select: { workspaceId: true, status: true },
  });
  if (!invitation?.workspaceId || invitation.status !== 'PENDING') return { allowed: true };

  return hasMemberSlot(invitation.workspaceId);
});

/** Block file uploads that exceed the workspace plan's per-file size limit. */
export const requireFileSizeLimit = planGuard(async (req) => {
  const workspaceId = req.params?.workspaceId ?? req.body?.workspaceId;
  // Profile-avatar uploads carry no workspaceId. The upload controller rejects
  // workspace uploads that omit it, so a missing ID can never store a file.
  if (!workspaceId) return { allowed: true };
  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  const fileSizeMb = Number(req.headers["content-length"] ?? 0) / (1024 * 1024);

  if (fileSizeMb > limits.maxFileSizeMb) {
    return {
      allowed: false,
      reason: `This workspace's plan allows uploads up to ${limits.maxFileSizeMb} MB per file.`,
    };
  }
  return { allowed: true };
});

/** Block meeting creation if workspace is over its monthly meeting limit. */
export const requireMeetingSlot = planGuard(async (req) => {
  const { workspaceId } = req.params;
  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  if (limits.maxMeetingsPerMo === -1) return { allowed: true };

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await prisma.meeting.count({
    where: { workspaceId, createdAt: { gte: startOfMonth } },
  });

  if (count >= limits.maxMeetingsPerMo) {
    return {
      allowed: false,
      reason: `This workspace's plan allows ${limits.maxMeetingsPerMo} meetings per month.`,
    };
  }
  return { allowed: true };
});

/** Block project creation if workspace is at its project limit. */
export const requireProjectSlot = planGuard(async (req) => {
  // in planmiddleware.ts — requireProjectSlot
  const workspaceId = req.params.workspaceId ?? req.body.workspaceId;
  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  if (limits.maxProjects === -1) return { allowed: true };

  const count = await prisma.project.count({ where: { workspaceId } });
  if (count >= limits.maxProjects) {
    return {
      allowed: false,
      reason: `This workspace's plan allows ${limits.maxProjects} projects. Upgrade this workspace to create more.`,
    };
  }
  return { allowed: true };
});

/** Block access to workspace analytics on FREE plan (or for non-members). */
export const requireAnalyticsAccess = planGuard(async (req) => {
  const { workspaceId } = req.params;
  const userId = req.user?.id;
  if (!userId || !workspaceId) {
    return { allowed: false, reason: "Authentication required" };
  }

  // Membership/role first so non-members can't probe the workspace's plan tier.
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
  if (!member || (member.role !== "ADMIN" && member.role !== "OWNER")) {
    return {
      allowed: false,
      reason: "Analytics access is restricted to workspace admins and owners",
    };
  }

  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  if (!limits.analyticsAccess) {
    return {
      allowed: false,
      reason: "Analytics requires a Pro or Business workspace plan.",
    };
  }
  return { allowed: true };
});

/** Block API access on non-Business workspaces. */
export const requireApiAccess = planGuard(async (req) => {
  const { workspaceId } = req.params;
  const limits = await BillingService.getWorkspacePlanLimits(workspaceId);
  if (!limits.apiAccess) {
    return {
      allowed: false,
      reason: "API access requires a Business workspace plan.",
    };
  }
  return { allowed: true };
});

/**
 * User-level API guard — API keys are user-scoped (not workspace-scoped), so
 * this checks the user's highest owned-workspace plan instead of a single
 * workspaceId. Mount on POST /api/v1/api-keys (API key creation).
 */
export const requireApiAccessForUser = planGuard(async (req) => {
  const userId = req.user?.id;
  if (!userId) return { allowed: false, reason: "Authentication required" };
  const highestPlan = await BillingService.getUserHighestPlan(userId);
  const limits = PLAN_LIMITS[highestPlan as PlanName] ?? PLAN_LIMITS.FREE;
  if (!limits.apiAccess) {
    return {
      allowed: false,
      reason: "API access requires a Business workspace plan.",
    };
  }
  return { allowed: true };
});

// ---------------------------------------------------------------------------
// Usage (mount these on the relevant routes):
//
//   // USER-LEVEL (on workspace creation — no :workspaceId param yet):
//   router.post('/workspaces', authMiddleware, requireWorkspaceCreationSlot, WorkspaceController.create);
//
//   // WORKSPACE-LEVEL (scoped to a specific workspace):
//   router.post('/:workspaceId/members',   authMiddleware, requireMemberSlot,       MemberController.invite);
//   router.post('/:workspaceId/meetings',  authMiddleware, requireMeetingSlot,       MeetingController.create);
//   router.post('/:workspaceId/projects',  authMiddleware, requireProjectSlot,       ProjectController.create);
//   router.get ('/:workspaceId/analytics', authMiddleware, requireAnalyticsAccess,   AnalyticsController.get);
//   router.post('/:workspaceId/files',     authMiddleware, requireFileSizeLimit,     FileController.upload);
// ---------------------------------------------------------------------------
