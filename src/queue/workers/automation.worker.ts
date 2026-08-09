/**
 * queue/workers/automation.worker.ts
 *
 * Consumes automation events emitted by controllers after user-initiated
 * mutations. Every mutation performed here (assign, priority, notify) is an
 * internal call that never emits a new event, so rules cannot re-trigger
 * themselves — loop-safety by construction.
 */
import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { notifyWorkspaceMembers } from '../../modules/notification/notification.helpers.js';
import { AutomationActivity } from '../../modules/automation/automation.activity.js';
import type {
  AutomationEvent,
  AutomationRuleRecord,
  AutomationAction,
  AssignUserActionConfig,
  SetPriorityActionConfig,
  NotifyMembersActionConfig,
} from '../../modules/automation/automation.types.js';

const AUTOMATION_WORKER_NAME = 'automation-worker';
const MAX_RULE_EXECUTIONS_PER_BURST = 20;

interface WorkerTask {
  id: string;
  title: string;
  projectId: string | null;
}

export function createAutomationWorker() {
  const worker = new Worker(
    AUTOMATION_WORKER_NAME,
    async (job: Job<AutomationEvent>) => {
      const event = job.data;
      if (event.trigger === 'STATUS_CHANGED' && event.fromStatus === event.toStatus) return;
      await processAutomationEvent(event);
    },
    {
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
        password: process.env.REDIS_PASSWORD ?? undefined,
        tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
      },
    },
  );
  return worker;
}

// ─── Core processing (exported for unit testing) ──────────────────────────────

export async function processAutomationEvent(event: AutomationEvent): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: {
      workspaceId: event.workspaceId,
      enabled: true,
      ...(event.projectId
        ? { OR: [{ projectId: event.projectId }, { projectId: null }] }
        : { projectId: null }),
    },
    orderBy: { createdAt: 'asc' },
  });

  const task = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: { id: true, title: true, projectId: true },
  });
  if (!task) return; // Task was deleted before the worker ran — nothing to do.

  let executions = 0;
  for (const rule of rules) {
    if (executions >= MAX_RULE_EXECUTIONS_PER_BURST) break;
    if (!matchesTrigger(rule, event)) continue;
    executions += 1;

    try {
      await applyActions(rule, event, task);
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });
      await AutomationActivity.logRun({ rule, userId: event.actorId, taskId: task.id });
    } catch (error) {
      console.error(`[AutomationWorker] Rule ${rule.id} (${rule.name}) failed:`, error);
    }
  }
}

// ─── Trigger matching ─────────────────────────────────────────────────────────

function matchesTrigger(rule: AutomationRuleRecord, event: AutomationEvent): boolean {
  const config = (rule.triggerConfig ?? {}) as {
    fromStatus?: string | null;
    toStatus?: string | null;
    projectId?: string | null;
  };

  if (rule.triggerType === 'STATUS_CHANGED') {
    if (config.fromStatus && config.fromStatus !== event.fromStatus) return false;
    if (config.toStatus && config.toStatus !== event.toStatus) return false;
    return true;
  }

  if (rule.triggerType === 'TASK_CREATED') {
    if (config.projectId && config.projectId !== event.projectId) return false;
    return true;
  }

  return false;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function applyActions(
  rule: AutomationRuleRecord,
  event: AutomationEvent,
  task: WorkerTask,
): Promise<void> {
  const actions = (rule.actions ?? []) as AutomationAction[];

  for (const action of actions) {
    switch (action.type) {
      case 'ASSIGN_USER':
        await applyAssignUser(action.config as AssignUserActionConfig, event, task);
        break;
      case 'SET_PRIORITY':
        await applySetPriority(action.config as SetPriorityActionConfig, task);
        break;
      case 'NOTIFY_MEMBERS':
        await applyNotifyMembers(action.config as NotifyMembersActionConfig, rule, task);
        break;
    }
  }
}

async function applyAssignUser(
  config: AssignUserActionConfig,
  event: AutomationEvent,
  task: WorkerTask,
): Promise<void> {
  let assigneeId: string | null = null;

  if (config.assigneeUserId) {
    assigneeId = config.assigneeUserId;
  } else if (config.role === 'project-owner' && task.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { createdById: true },
    });
    assigneeId = project?.createdById ?? null;
  } else if (config.role === 'actor') {
    assigneeId = event.actorId;
  } else if (config.email) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: event.workspaceId, user: { email: config.email } },
      select: { userId: true },
    });
    assigneeId = member?.userId ?? null;
  }

  if (!assigneeId) return;

  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: task.id, userId: assigneeId } },
    create: { taskId: task.id, userId: assigneeId },
    update: {},
  });
}

async function applySetPriority(
  config: SetPriorityActionConfig,
  task: WorkerTask,
): Promise<void> {
  await prisma.task.update({
    where: { id: task.id },
    data: { priority: config.priority },
  });
}

async function applyNotifyMembers(
  config: NotifyMembersActionConfig,
  rule: AutomationRuleRecord,
  task: WorkerTask,
): Promise<void> {
  await notifyWorkspaceMembers({
    workspaceId: rule.workspaceId,
    senderId: rule.createdById,
    type: 'AUTOMATION_TRIGGERED',
    title: `Automation: ${rule.name}`,
    message:
      config.message?.trim() || `Task "${task.title}" was updated by automation "${rule.name}"`,
    actionUrl: task.projectId
      ? `/projects/${task.projectId}/tasks/${task.id}`
      : `/tasks/${task.id}`,
  });
}
