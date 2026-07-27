import { prisma } from '../../lib/prisma.js';
import { SlackService } from './slack.service.js';
import type { IntegrationConfig } from './integration.types.js';

// ─── Notification Helpers ─────────────────────────────────────────────────────

interface TaskNotificationData {
  taskId: string;
  title: string;
  status?: string;
  priority?: string;
  assigneeName?: string;
  changedByName?: string;
  workspaceId?: string;
  projectName?: string;
  taskUrl?: string;
}

const STATUS_EMOJI: Record<string, string> = {
  TODO: ':white_circle:',
  IN_PROGRESS: ':large_yellow_circle:',
  IN_REVIEW: ':eyes:',
  BLOCKED: ':no_entry:',
  COMPLETED: ':white_check_mark:',
  CANCELLED: ':x:',
};

const PRIORITY_EMOJI: Record<string, string> = {
  URGENT: ':rotating_light:',
  HIGH: ':arrow_up:',
  MEDIUM: ':bar_chart:',
  LOW: ':arrow_down:',
};

// ─── Main Notification Functions ─────────────────────────────────────────────

/**
 * Notify a Slack channel about a task change
 */
export async function notifySlackTaskUpdate(
  integrationId: string,
  data: TaskNotificationData,
  channelId?: string,
  threadTs?: string,
): Promise<void> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration || !integration.active) return;

    const config = integration.config as IntegrationConfig | null;
    const targetChannel = channelId || config?.notificationChannel;
    if (!targetChannel) return;

    const slackService = new SlackService(integrationId);
    const statusEmoji = data.status ? STATUS_EMOJI[data.status] || ':spiral_note_pad:' : ':spiral_note_pad:';
    const priorityEmoji = data.priority ? PRIORITY_EMOJI[data.priority] || '' : '';

    const titleStr = data.taskUrl
      ? `<${data.taskUrl}|${data.title}>`
      : data.title;

    let text = `${statusEmoji} *Task Updated: ${titleStr}*`;

    if (data.changedByName) {
      text += `\n:raised_hand: *By:* ${data.changedByName}`;
    }

    if (data.status) {
      text += `\n:bar_chart: *Status:* ${data.status}`;
    }

    if (data.priority) {
      text += `\n${priorityEmoji} *Priority:* ${data.priority}`;
    }

    if (data.assigneeName) {
      text += `\n:bust_in_silhouette: *Assignee:* ${data.assigneeName}`;
    }

    if (data.projectName) {
      text += `\n:briefcase: *Project:* ${data.projectName}`;
    }

    await slackService.postMessage({
      channel: targetChannel,
      text,
      threadTs,
    });

    // Add reaction to indicate notification sent
    if (threadTs) {
      await slackService.addReaction({
        channel: targetChannel,
        timestamp: threadTs,
        reaction: 'bell',
      }).catch(() => { /* best-effort */ });
    }
  } catch (error) {
    console.error('[SlackNotifications] Failed to send task update notification:', error);
  }
}

/**
 * Notify when a new task is assigned to a user in Slack
 */
export async function notifySlackTaskAssignment(
  integrationId: string,
  data: TaskNotificationData & { assignedBy?: string },
  channelId?: string,
  threadTs?: string,
): Promise<void> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration || !integration.active) return;

    const config = integration.config as IntegrationConfig | null;
    // Only notify if configured
    if (!config?.notifications) return;

    const targetChannel = channelId || config?.notificationChannel;
    if (!targetChannel) return;

    const slackService = new SlackService(integrationId);

    const titleStr = data.taskUrl
      ? `<${data.taskUrl}|${data.title}>`
      : data.title;

    let text = `:bust_in_silhouette: *Task Assigned: ${titleStr}*`;
    text += `\n:busts_in_silhouette: *Assigned to:* ${data.assigneeName || 'Unassigned'}`;

    if (data.assignedBy) {
      text += `\n:raised_hand: *By:* ${data.assignedBy}`;
    }

    if (data.priority) {
      const priorityEmoji = PRIORITY_EMOJI[data.priority] || '';
      text += `\n${priorityEmoji} *Priority:* ${data.priority}`;
    }

    await slackService.postMessage({
      channel: targetChannel,
      text,
      threadTs,
    });
  } catch (error) {
    console.error('[SlackNotifications] Failed to send assignment notification:', error);
  }
}

/**
 * Notify when a task is created from Slack
 */
export async function notifySlackTaskCreated(
  integrationId: string,
  channelId: string,
  threadTs: string | undefined,
  taskTitle: string,
  taskId: string,
  taskUrl?: string,
): Promise<void> {
  try {
    const slackService = new SlackService(integrationId);
    const titleStr = taskUrl
      ? `<${taskUrl}|${taskTitle}>`
      : taskTitle;

    const text = `:white_check_mark: *Task Created: ${titleStr}*`;

    await slackService.postMessage({
      channel: channelId,
      text,
      threadTs,
    });

    // Add reaction to the original message to confirm creation
    await slackService.addReaction({
      channel: channelId,
      timestamp: threadTs || channelId,
      reaction: 'white_check_mark',
    }).catch(() => { /* best-effort */ });
  } catch (error) {
    console.error('[SlackNotifications] Failed to send task created notification:', error);
  }
}

/**
 * Send a daily task summary to a Slack channel
 */
export async function notifySlackDailySummary(
  integrationId: string,
  channelId: string,
  summaryBlocks: unknown[],
): Promise<void> {
  try {
    const slackService = new SlackService(integrationId);

    await slackService.postMessage({
      channel: channelId,
      text: ':bar_chart: *Daily Task Summary*',
      blocks: summaryBlocks,
    });
  } catch (error) {
    console.error('[SlackNotifications] Failed to send daily summary:', error);
  }
}

// ─── Integration Helpers ──────────────────────────────────────────────────────

/**
 * Find the Slack integration for a workspace and send notification
 */
export async function notifyWorkspaceSlack(
  workspaceId: string,
  data: TaskNotificationData,
  notificationType: 'update' | 'assign' = 'update',
): Promise<void> {
  try {
    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId,
        provider: 'slack',
        active: true,
      },
    });

    if (!integration) return;

    const config = integration.config as IntegrationConfig | null;

    // Check if notifications are enabled
    if (!config?.notifications) return;

    const channelId = config?.notificationChannel;

    if (notificationType === 'update') {
      await notifySlackTaskUpdate(integration.id, data, channelId);
    } else {
      await notifySlackTaskAssignment(integration.id, data, channelId);
    }
  } catch (error) {
    console.error('[SlackNotifications] Failed to notify workspace Slack:', error);
  }
}

/**
 * Find the Slack integration linked to a specific task's Slack channel/message
 */
export async function notifyTaskSlackThread(
  taskId: string,
  data: TaskNotificationData,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        slackChannelId: true,
        slackThreadTs: true,
        workspaceId: true,
      },
    });

    if (!task || !task.slackChannelId) return;

    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId: task.workspaceId,
        provider: 'slack',
        active: true,
      },
    });

    if (!integration) return;

    await notifySlackTaskUpdate(
      integration.id,
      data,
      task.slackChannelId,
      task.slackThreadTs || undefined,
    );
  } catch (error) {
    console.error('[SlackNotifications] Failed to notify task Slack thread:', error);
  }
}
