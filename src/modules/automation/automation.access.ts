/**
 * modules/automation/automation.access.ts
 *
 * Automation rules are workspace-scoped. Every workspace member can read
 * rules; only OWNER/ADMIN can create, update, or delete them. The workspace
 * owner is an implicit OWNER even if not present in the members table.
 */
import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../../errors/index.js';
import { automationRuleSelect } from './automation.selects.js';

const MANAGER_ROLES = new Set(['OWNER', 'ADMIN']);

export const AutomationAccess = {
  /**
   * Throws unless the user is a member (or the owner) of the workspace.
   */
  async assertWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { id: true }, take: 1 },
      },
    });

    if (!workspace) throw new NotFoundError('Workspace not found');
    if (workspace.ownerId === userId) return;
    if (!workspace.members[0]) {
      throw new ForbiddenError('You are not a member of this workspace');
    }
  },

  /**
   * Throws unless the user is an OWNER/ADMIN (or the workspace owner).
   */
  async assertManagePermission(userId: string, workspaceId: string): Promise<void> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });

    if (!workspace) throw new NotFoundError('Workspace not found');
    if (workspace.ownerId === userId) return;

    const role = workspace.members[0]?.role;
    if (!role || !MANAGER_ROLES.has(role)) {
      throw new ForbiddenError('Only workspace owners and admins can manage automation rules');
    }
  },

  /**
   * Fetches a rule and throws unless the user can manage it. Returns the rule
   * so callers can avoid a second fetch.
   */
  async assertManageRulePermission(
    userId: string,
    ruleId: string,
  ): Promise<{ id: string; workspaceId: string }> {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
      select: { id: true, workspaceId: true },
    });
    if (!rule) throw new NotFoundError('Automation rule not found');
    await AutomationAccess.assertManagePermission(userId, rule.workspaceId);
    return rule;
  },

  /**
   * Fetches a rule and throws unless the user is a workspace member. Returns
   * the workspaceId for downstream use.
   */
  async assertReadPermission(
    userId: string,
    ruleId: string,
  ): Promise<{ id: string; workspaceId: string }> {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
      select: { id: true, workspaceId: true },
    });
    if (!rule) throw new NotFoundError('Automation rule not found');
    await AutomationAccess.assertWorkspaceMembership(userId, rule.workspaceId);
    return rule;
  },

  /** Typed select used by rules returned from permission checks. */
  async getRuleForManager(userId: string, ruleId: string) {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
      select: automationRuleSelect,
    });
    if (!rule) throw new NotFoundError('Automation rule not found');
    await AutomationAccess.assertManagePermission(userId, rule.workspaceId);
    return rule;
  },
};
