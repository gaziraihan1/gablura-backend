/**
 * modules/automation/automation.selects.ts
 */
export const automationRuleSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  name: true,
  triggerType: true,
  triggerConfig: true,
  actions: true,
  enabled: true,
  runCount: true,
  lastRunAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;
