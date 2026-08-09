/**
 * modules/automation/automation.mutation.ts
 */
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, PlanLimitError } from '../../errors/index.js';
import { AutomationAccess } from './automation.access.js';
import { AutomationActivity } from './automation.activity.js';
import { automationRuleSelect } from './automation.selects.js';
import { PLAN_LIMITS } from '../workspaceUsage/workspaceUsage.types.js';
import { AutomationCache } from '../../lib/redis/cache.client.js';
import type {
  AutomationRuleInput,
  AutomationRuleUpdateInput,
  AutomationRuleRecord,
} from './automation.types.js';

/**
 * Resolve the maximum number of *enabled* rules the workspace plan allows.
 * -1 means unlimited (ENTERPRISE).
 */
async function resolveAutomationLimit(workspaceId: string): Promise<number> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (!workspace) throw new NotFoundError('Workspace not found');

  const plan = workspace.plan as keyof typeof PLAN_LIMITS;
  return PLAN_LIMITS[plan]?.automations ?? PLAN_LIMITS.FREE.automations;
}

/**
 * Throws PlanLimitError when the workspace already has `limit` enabled rules.
 * Callers must invoke this *before* creating a new rule or re-enabling one.
 */
async function assertUnderEnabledRuleLimit(workspaceId: string): Promise<void> {
  const limit = await resolveAutomationLimit(workspaceId);
  if (limit === -1) return;

  const current = await prisma.automationRule.count({
    where: { workspaceId, enabled: true },
  });
  if (current >= limit) {
    throw new PlanLimitError(
      `Automation rule limit reached (${limit} active rules on your current plan). Upgrade to create more.`,
    );
  }
}

export const AutomationMutation = {
  async create(userId: string, data: AutomationRuleInput): Promise<AutomationRuleRecord> {
    await AutomationAccess.assertManagePermission(userId, data.workspaceId);
    await assertUnderEnabledRuleLimit(data.workspaceId);

    const rule = await prisma.automationRule.create({
      data: {
        workspaceId: data.workspaceId,
        projectId: data.projectId ?? null,
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: (data.triggerConfig ?? {}) as object,
        actions: (data.actions ?? []) as object[],
        createdById: userId,
      },
      select: automationRuleSelect,
    }) as AutomationRuleRecord;

    await AutomationCache.invalidateList(data.workspaceId);
    void AutomationActivity.logCreated({ rule, userId });

    return rule;
  },

  async update(
    userId: string,
    ruleId: string,
    data: AutomationRuleUpdateInput,
  ): Promise<AutomationRuleRecord> {
    const existing = await AutomationAccess.getRuleForManager(userId, ruleId);

    // Re-enabling a disabled rule must not bypass the plan limit.
    if (data.enabled === true && !existing.enabled) {
      await assertUnderEnabledRuleLimit(existing.workspaceId);
    }

    const updated = await prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.triggerType !== undefined ? { triggerType: data.triggerType } : {}),
        ...(data.triggerConfig !== undefined
          ? { triggerConfig: data.triggerConfig as object }
          : {}),
        ...(data.actions !== undefined ? { actions: data.actions as object[] } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
      select: automationRuleSelect,
    }) as AutomationRuleRecord;

    await AutomationCache.invalidateList(updated.workspaceId);
    void AutomationActivity.logUpdated({ rule: updated, userId });

    return updated;
  },

  async remove(userId: string, ruleId: string): Promise<{ success: boolean }> {
    const existing = await AutomationAccess.getRuleForManager(userId, ruleId);

    await prisma.automationRule.delete({ where: { id: ruleId } });

    await AutomationCache.invalidateList(existing.workspaceId);
    void AutomationActivity.logDeleted({ rule: existing, userId });

    return { success: true };
  },
};
