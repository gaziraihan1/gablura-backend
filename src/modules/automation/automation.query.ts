/**
 * modules/automation/automation.query.ts
 */
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import { AutomationAccess } from './automation.access.js';
import { automationRuleSelect } from './automation.selects.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const AutomationQuery = {
  /**
   * List rules for a workspace. When `projectId` is provided the result
   * includes the project's own rules plus workspace-wide rules (projectId
   * null), matching how the worker resolves rules at runtime.
   */
  async list(userId: string, workspaceId: string, projectId?: string) {
    await AutomationAccess.assertWorkspaceMembership(userId, workspaceId);

    return CacheClient.getOrSet(
      CACHE_KEYS.automationList(workspaceId, projectId),
      async () => {
        const rules = await prisma.automationRule.findMany({
          where: {
            workspaceId,
            ...(projectId
              ? { OR: [{ projectId }, { projectId: null }] }
              : {}),
          },
          orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
          select: automationRuleSelect,
        });
        return rules;
      },
      CACHE_TTL.AUTOMATION_LIST,
    );
  },

  async getById(userId: string, ruleId: string) {
    const rule = await prisma.automationRule.findUnique({
      where: { id: ruleId },
      select: automationRuleSelect,
    });
    if (!rule) throw new NotFoundError('Automation rule not found');
    await AutomationAccess.assertWorkspaceMembership(userId, rule.workspaceId);
    return rule;
  },

  /**
   * Recent execution history for a rule. The worker logs every run to the
   * activity feed (entityType AUTOMATION), so this is a simple activity query.
   */
  async getRunHistory(userId: string, ruleId: string) {
    await AutomationAccess.assertReadPermission(userId, ruleId);

    const runs = await prisma.activity.findMany({
      where: { entityType: 'AUTOMATION', entityId: ruleId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        taskId: true,
        metadata: true,
        createdAt: true,
        user: { select: { id: true, name: true, image: true } },
      },
    });
    return runs;
  },
};
