/**
 * modules/automation/automation.activity.ts
 */
import { prisma } from '../../lib/prisma.js';
import { addLogActivityJob } from '../../queue/queues/activity.queue.js';
import type { AutomationRuleRecord } from './automation.types.js';

async function resolveWorkspaceSlug(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { slug: true },
  });
  return ws.slug;
}

export const AutomationActivity = {
  async logCreated(params: { rule: AutomationRuleRecord; userId: string }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.rule.workspaceId);
      await addLogActivityJob({
        action: 'CREATED',
        entityType: 'AUTOMATION',
        entityId: params.rule.id,
        userId: params.userId,
        workspaceId: params.rule.workspaceId,
        workspaceSlug,
        metadata: { ruleName: params.rule.name, triggerType: params.rule.triggerType },
      });
    } catch (error) {
      console.error('Failed to log automation rule creation activity:', error);
    }
  },

  async logUpdated(params: { rule: AutomationRuleRecord; userId: string }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.rule.workspaceId);
      await addLogActivityJob({
        action: 'UPDATED',
        entityType: 'AUTOMATION',
        entityId: params.rule.id,
        userId: params.userId,
        workspaceId: params.rule.workspaceId,
        workspaceSlug,
        metadata: { ruleName: params.rule.name, triggerType: params.rule.triggerType },
      });
    } catch (error) {
      console.error('Failed to log automation rule update activity:', error);
    }
  },

  async logDeleted(params: { rule: AutomationRuleRecord; userId: string }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.rule.workspaceId);
      await addLogActivityJob({
        action: 'DELETED',
        entityType: 'AUTOMATION',
        entityId: params.rule.id,
        userId: params.userId,
        workspaceId: params.rule.workspaceId,
        workspaceSlug,
        metadata: { ruleName: params.rule.name, triggerType: params.rule.triggerType },
      });
    } catch (error) {
      console.error('Failed to log automation rule deletion activity:', error);
    }
  },

  /**
   * Logged by the automation worker after a rule executes its actions. This
   * doubles as the rule's run history (`GET /automations/:id/runs`).
   */
  async logRun(params: {
    rule: AutomationRuleRecord;
    userId: string;
    taskId: string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.rule.workspaceId);
      await addLogActivityJob({
        action: 'AUTOMATION_RUN',
        entityType: 'AUTOMATION',
        entityId: params.rule.id,
        userId: params.userId,
        workspaceId: params.rule.workspaceId,
        workspaceSlug,
        taskId: params.taskId,
        metadata: {
          ruleName: params.rule.name,
          triggerType: params.rule.triggerType,
          actions: params.rule.actions,
        },
      });
    } catch (error) {
      console.error('Failed to log automation rule run activity:', error);
    }
  },
};
