import { prisma } from "../../lib/prisma.js";
import { ForbiddenError } from "../../errors/index.js";
import { AI_PLAN_LIMITS, type AiFeature, type AiPlan } from "./ai.types.js";

/**
 * Access guards for the AI module.
 *
 * Workspace-scoped calls verify the caller is a member of the workspace
 * (matching the pattern used by `analytics.access.ts`). Personal calls (no
 * `workspaceId`) need no membership check — the plan tier resolves from the
 * user's highest plan instead.
 */
export const AiAccess = {
  async assertWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    });

    if (!member) {
      throw new ForbiddenError("You do not have access to this workspace");
    }
  },

  /**
   * Restricts AI usage reports to workspace owners and admins (mirrors
   * `AnalyticsAccess.assertWorkspaceAdminOrOwner`). Members/GUESTs get 403 —
   * AI spend is a billing-sensitive metric.
   */
  async assertWorkspaceAdminOrOwner(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });

    if (!member) {
      throw new ForbiddenError("You do not have access to this workspace");
    }
    if (member.role !== "OWNER" && member.role !== "ADMIN") {
      throw new ForbiddenError(
        "AI usage is restricted to workspace owners and admins",
      );
    }
  },

  /**
   * Throws 403 when the caller's plan does not include the requested feature.
   * `"*"` means the plan can use every AI feature.
   */
  assertFeatureEnabled(plan: AiPlan, feature: AiFeature): void {
    const limits = AI_PLAN_LIMITS[plan] ?? AI_PLAN_LIMITS.FREE;
    const features = limits.features as readonly string[];
    const allowed = features.includes("*") || features.includes(feature);
    if (!allowed) {
      throw new ForbiddenError(
        `The "${feature}" AI feature is not available on the ${plan} plan. Upgrade to unlock it.`,
        "AI_FEATURE_NOT_AVAILABLE",
      );
    }
  },
};
