import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { ValidationError } from '../../errors/index.js';
import { getValidAccessToken } from './integration.oauth.js';
import { SlackService } from './slack.service.js';
import type { IntegrationConfig } from './integration.types.js';
import type {
  SlackEventPayload,
  SlackSlashCommand,
  SlackInteractionPayload,
} from './slack.types.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

interface GitHubCommit {
  id: string;
  message: string;
  author: {
    name: string;
    email: string;
  };
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion?: string;
  html_url: string;
  head_branch?: string;
  head_sha?: string;
  run_number?: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  target_commitish?: string;
}

interface GitHubMilestone {
  number: number;
  title: string;
  html_url: string;
  state: string;
}

interface GitHubWebhookPayload {
  action?: string;
  ref?: string;
  after?: string;
  commits?: GitHubCommit[];
  head_commit?: GitHubCommit;
  workflow_run?: GitHubWorkflowRun;
  release?: GitHubRelease;
  milestone?: GitHubMilestone;
  pull_request?: {
    number: number;
    merged: boolean;
    title: string;
    head?: {
      ref: string;
    };
  };
  issue?: {
    number: number;
    title: string;
    body?: string;
    milestone?: GitHubMilestone;
  };
  repository?: {
    full_name: string;
    default_branch?: string;
  };
}

// ─── Webhook Functions ───────────────────────────────────────────────────────

// ─── Input Sanitization ──────────────────────────────────────────────────────

function sanitizeString(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  // Remove potential XSS vectors and limit length
  return input.replace(/[<>]/g, '').substring(0, 2000);
}

function sanitizeNumber(input: number | undefined | null): number | undefined {
  if (input === undefined || input === null) return undefined;
  const num = Number(input);
  return isNaN(num) ? undefined : num;
}

// ─── Webhook Event Deduplication ─────────────────────────────────────────────
// Prevents processing the same webhook event twice (at-least-once delivery).
const processedWebhookEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicateEvent(key: string): boolean {
  const now = Date.now();
  // Evict expired entries periodically
  if (processedWebhookEvents.size > 10000) {
    for (const [k, ts] of processedWebhookEvents) {
      if (now - ts > DEDUP_TTL_MS) processedWebhookEvents.delete(k);
    }
  }
  if (processedWebhookEvents.has(key)) return true;
  processedWebhookEvents.set(key, now);
  return false;
}

/**
 * Handle webhook from provider (queues for async processing)
 * For Slack, we also handle url_verification synchronously
 */
export async function handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string, timestamp?: string) {
  // Validate provider
  const validProviders = ['github', 'slack', 'google-calendar', 'trello'];
  if (!validProviders.includes(provider)) {
    console.error(`Invalid provider: ${provider}`);
    return;
  }

  // For Slack url_verification, respond synchronously
  if (provider === 'slack' && payload.type === 'url_verification') {
    return { challenge: payload.challenge };
  }

  // Find integration by provider
  const integration = await prisma.integration.findFirst({
    where: {
      provider,
      active: true,
    },
  });

  if (!integration) {
    console.error(`No active integration found for provider: ${provider}`);
    return;
  }

  // Verify webhook signature if secret is set
  if (integration.webhookSecret && signature) {
    const isValid = verifyWebhookSignature(provider, payload, signature, integration.webhookSecret, timestamp);
    if (!isValid) {
      throw new ValidationError('Invalid webhook signature');
    }
  }

  // Deduplication: skip if this event was recently processed
  // Use a composite key: provider + event type + action/id for uniqueness
  const evt = payload as Record<string, unknown>;
  const eventObj = evt.event as Record<string, unknown> | undefined;
  const dedupKey = `${provider}:${evt.type || evt.action || ''}:${evt.id || evt.delivery_id || ''}:${eventObj?.type || ''}`;
  if (isDuplicateEvent(dedupKey)) {
    console.log(`[Webhook] Duplicate event skipped: ${dedupKey}`);
    return;
  }

  // Add to queue for async processing
  const { addProcessWebhookJob } = await import('../../queue/queues/integration.queue.js');
  await addProcessWebhookJob({
    provider,
    integrationId: integration.id,
    payload,
    signature,
    timestamp,
  });
}

/**
 * Process webhook event (called by worker)
 */
export async function processWebhookEvent(
  provider: string,
  integrationId: string,
  payload: Record<string, unknown>,
  signature?: string,
  timestamp?: string,
) {
  // Structured log for production observability
  console.log(JSON.stringify({
    level: 'info',
    msg: 'Processing integration webhook',
    provider,
    integrationId,
    eventType: payload.type || payload.action || 'unknown',
    timestamp: new Date().toISOString(),
  }));

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.active) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Integration not found or inactive',
      provider,
      integrationId,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Verify webhook signature if secret is set
  if (integration.webhookSecret && signature) {
    const isValid = verifyWebhookSignature(provider, payload, signature, integration.webhookSecret, timestamp);
    if (!isValid) {
      throw new ValidationError('Invalid webhook signature');
    }
  }

  // Process webhook based on provider
  switch (provider) {
    case 'github':
      await processGithubWebhook(integration, payload);
      break;
    case 'slack':
      await processSlackEvent(integration, payload);
      break;
    case 'google-calendar':
      await processGoogleCalendarWebhook(integration);
      break;
    case 'trello':
      await processTrelloWebhook(integration, payload);
      break;
  }
}

// ─── Signature Verification ──────────────────────────────────────────────────

function verifyWebhookSignature(
  provider: string,
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
  timestamp?: string,
): boolean {
  switch (provider) {
    case 'github': {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(JSON.stringify(payload)).digest('hex');
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(`sha256=${digest}`),
        );
      } catch {
        return false;
      }
    }
    case 'slack': {
      // Slack uses HMAC-SHA256 with version=v0
      // sig_basestring = "v0:{timestamp}:{raw_body}"
      // We need timestamp from header passed to this function
      if (!timestamp) return false;

      // Verify timestamp is within 5 minutes to prevent replay attacks
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
        console.error('Slack webhook timestamp too old, possible replay attack');
        return false;
      }

      const sigBaseString = `v0:${timestamp}:${JSON.stringify(payload)}`;
      const hmac = crypto.createHmac('sha256', secret);
      const mySignature = `v0=${hmac.update(sigBaseString).digest('hex')}`;

      // Timing-safe comparison
      try {
        return crypto.timingSafeEqual(
          Buffer.from(mySignature),
          Buffer.from(signature),
        );
      } catch {
        return false;
      }
    }
    case 'trello': {
      // Trello uses HMAC-SHA1 for webhook verification
      // The signature is in the X-Trello-Webhook header
      // Verification: HMAC-SHA1(rawBody, secret) == header value
      try {
        const hmac = crypto.createHmac('sha1', secret);
        hmac.update(JSON.stringify(payload));
        const expected = hmac.digest('hex');

        // Constant-time comparison
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
      } catch {
        return false;
      }
    }
    case 'google-calendar': {
      // Google Calendar push notifications use a verification token.
      // The X-Goog-Channel-Token header contains the token we set when
      // creating the watch. Verify it matches our stored secret.
      // If no token is set in the header, accept the webhook (Google
      // sometimes omits it for non-push notification events).
      if (!signature) return true; // No token to verify
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(secret),
        );
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}

// ─── Slack Event Router ──────────────────────────────────────────────────────

/**
 * Route incoming Slack payloads to the appropriate handler
 */
async function processSlackEvent(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null; config: unknown },
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const workspaceId = integration.workspaceId ?? undefined;

    // Determine the type of Slack payload
    // 1. Slash commands - has `command` field
    if (payload.command) {
      const normalized = normalizeSlackCommand(payload);
      await handleSlackSlashCommand(integration, normalized as unknown as SlackSlashCommand);
      return;
    }

    // 2. Interactive components (block actions, view submissions) - has `type` of block_actions/view_submission etc
    if (payload.type === 'block_actions' || payload.type === 'view_submission' || payload.type === 'view_closed' || payload.type === 'message_action' || payload.type === 'shortcut') {
      const normalized = normalizeSlackInteraction(payload);
      await handleSlackInteraction(integration, normalized as unknown as SlackInteractionPayload);
      return;
    }

    // 3. Event callbacks - has `type` of 'event_callback'
    if (payload.type === 'event_callback') {
      await handleSlackEventCallback(integration, payload as unknown as SlackEventPayload, workspaceId);
      return;
    }

    console.log('[SlackWebhook] Unknown Slack payload type:', payload.type);
  } catch (error) {
    console.error('[SlackWebhook] Error processing Slack event:', error);
  }
}

// ─── Slack Slash Commands ────────────────────────────────────────────────────

/**
 * Normalize snake_case Slack command payload to camelCase
 */
function normalizeSlackCommand(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    token: payload.token,
    teamId: (payload.teamId as string) ?? (payload['team_id'] as string),
    teamDomain: (payload['team_domain'] as string) || (payload.teamDomain as string),
    channelId: (payload['channel_id'] as string) || (payload.channelId as string),
    channelName: (payload['channel_name'] as string) || (payload.channelName as string),
    userId: (payload['user_id'] as string) || (payload.userId as string),
    userName: (payload['user_name'] as string) || (payload.userName as string),
    command: payload.command as string,
    text: payload.text as string,
    apiAppId: (payload['api_app_id'] as string) || (payload.apiAppId as string),
    responseUrl: (payload['response_url'] as string) || (payload.responseUrl as string),
    triggerId: (payload['trigger_id'] as string) || (payload.triggerId as string),
  } as unknown as Record<string, unknown>;
}

/**
 * Normalize snake_case Slack interaction payload to camelCase
 */
function normalizeSlackInteraction(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...payload,
    channel: (payload['channel'] as Record<string, unknown>) || payload.channel,
    user: (payload['user'] as Record<string, unknown>) || payload.user,
    responseUrl: (payload['response_url'] as string) || (payload.responseUrl as string),
    triggerId: (payload['trigger_id'] as string) || (payload.triggerId as string),
    callbackId: (payload['callback_id'] as string) || (payload.callbackId as string),
    privateMetadata: (payload['private_metadata'] as string) || (payload.privateMetadata as string),
    messageTs: (payload['message_ts'] as string) || (payload.messageTs as string),
  };

  // Normalize actions array items from snake_case to camelCase
  const actions = (payload['actions'] as Array<Record<string, unknown>>) || (payload.actions as Array<Record<string, unknown>>);
  if (actions) {
    normalized.actions = actions.map((a) => ({
      ...a,
      actionId: (a['action_id'] as string) || (a.actionId as string),
      blockId: (a['block_id'] as string) || (a.blockId as string),
      actionTs: (a['action_ts'] as string) || (a.actionTs as string),
      selectedOption: (a['selected_option'] as Record<string, unknown>) || (a.selectedOption as Record<string, unknown>),
    }));
  }

  return normalized;
}

/**
 * Handle Slack slash commands (/focura, /f)
 */
async function handleSlackSlashCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
): Promise<void> {
  const slackService = new SlackService(integration.id);

  // Parse command text
  const text = (command.text || '').trim();
  const parts = text.split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase();

  switch (subcommand) {
    case 'create':
    case 'add':
      await handleSlackCreateCommand(integration, command, parts.slice(1));
      break;
    case 'list':
    case 'my':
      await handleSlackListCommand(integration, command, parts);
      break;
    case 'status':
      await handleSlackStatusCommand(integration, command);
      break;
    case 'assign':
      await handleSlackAssignCommand(integration, command, parts.slice(1));
      break;
    case 'search':
    case 'find':
      await handleSlackSearchCommand(integration, command, parts.slice(1));
      break;
    case 'help':
    default:
      await slackService.respondToUrl(command.responseUrl, {
        text: `*Focura Bot Help* :robot_face:\n\n` +
          `\`/focura create <title>\` - Create a new task\n` +
          `\`/focura list\` - List your tasks\n` +
          `\`/focura status\` - Show workspace task status\n` +
          `\`/focura assign @user <task-id>\` - Assign a task\n` +
          `\`/focura search <query>\` - Search tasks\n` +
          `\`/focura help\` - Show this help message`,
        responseType: 'ephemeral',
      });
      break;
  }
}

/**
 * Handle /focura create <title> [description]
 */
async function handleSlackCreateCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
  args: string[],
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  if (args.length === 0) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':warning: Please provide a task title. Usage: `/focura create <title>`',
      responseType: 'ephemeral',
    });
    return;
  }

  // Try to find the Slack user's Focura user ID
  let createdById = integration.connectedById ?? integration.userId;
  if (!createdById) {
    // Try to resolve from Slack user ID
    createdById = await slackService.resolveSlackUserToFocuraUserId(command.userId);
  }

  if (!createdById) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Could not find your Focura account. Please connect your Slack account to Focura first via the dashboard.',
      responseType: 'ephemeral',
    });
    return;
  }

  const title = sanitizeString(args.join(' ')) || 'Untitled Task';

  try {
    const taskData: Record<string, unknown> = {
      title,
      status: 'TODO',
      createdBy: { connect: { id: createdById } },
      slackChannelId: command.channelId,
      slackUserId: command.userId,
      slackUserDisplayName: command.userName,
    };

    if (workspaceId) {
      taskData.workspace = { connect: { id: workspaceId } };
    }

    const task = await prisma.task.create({
      data: taskData as any,
    });

    // Respond in channel so others can see the task was created
    await slackService.respondToUrl(command.responseUrl, {
      text: `:white_check_mark: *Task Created:* ${title}\n:wastebasket: *ID:* \`${task.id}\`\n<${process.env.CLIENT_URL || process.env.FRONTEND_URL || ''}/dashboard/tasks/${task.id}|View in Focura>`,
      responseType: 'in_channel',
    });

    console.log(`[Slack] Created task ${task.id} from Slack command by ${command.userName}`);
  } catch (error) {
    console.error('[Slack] Error creating task from command:', error);
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Failed to create task. Please try again.',
      responseType: 'ephemeral',
    });
  }
}

/**
 * Handle /focura list [status] - list tasks
 */
async function handleSlackListCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
  parts: string[],
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  let createdById = integration.connectedById ?? integration.userId;
  if (!createdById) {
    createdById = await slackService.resolveSlackUserToFocuraUserId(command.userId);
  }

  if (!createdById || !workspaceId) {
    await slackService.respondToUrl(command.responseUrl, {
      text: workspaceId ? ':x: Could not identify your Focura account.' : ':x: This integration is not connected to a workspace.',
      responseType: 'ephemeral',
    });
    return;
  }

  const statusFilter = parts[1]?.toUpperCase();
  const validStatuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED'];
  const status = validStatuses.includes(statusFilter || '') ? statusFilter : undefined;

  try {
    const where: Record<string, unknown> = {
      workspaceId,
      createdById,
    };
    if (status) where.status = status;

    const tasks = await prisma.task.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
      },
    });

    if (tasks.length === 0) {
      await slackService.respondToUrl(command.responseUrl, {
        text: status
          ? `:inbox_tray: No tasks with status *${status}* found.`
          : ':inbox_tray: No tasks found. Create one with `/focura create <title>`',
        responseType: 'ephemeral',
      });
      return;
    }

    const taskList = tasks.map((t, i) =>
      `${i + 1}. *${t.title}* — ${t.status}${t.priority ? ` (${t.priority})` : ''}`
    ).join('\n');

    await slackService.respondToUrl(command.responseUrl, {
      text: `:clipboard: *Your Tasks* ${status ? `(${status})` : ''}\n\n${taskList}`,
      responseType: 'ephemeral',
    });
  } catch (error) {
    console.error('[Slack] Error listing tasks:', error);
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Failed to list tasks. Please try again.',
      responseType: 'ephemeral',
    });
  }
}

/**
 * Handle /focura status - workspace statistics
 */
async function handleSlackStatusCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  if (!workspaceId) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: This integration is not connected to a workspace.',
      responseType: 'ephemeral',
    });
    return;
  }

  try {
    const [total, todo, inProgress, completed, overdue] = await Promise.all([
      prisma.task.count({ where: { workspaceId } }),
      prisma.task.count({ where: { workspaceId, status: 'TODO' } }),
      prisma.task.count({ where: { workspaceId, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { workspaceId, status: 'COMPLETED' } }),
      prisma.task.count({
        where: {
          workspaceId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    const projects = await prisma.project.count({ where: { workspaceId } });

    await slackService.respondToUrl(command.responseUrl, {
      text: `:bar_chart: *Workspace Overview*\n\n` +
        `:books: *Projects:* ${projects}\n` +
        `:white_circle: *Total Tasks:* ${total}\n` +
        `:white_circle: *To Do:* ${todo}\n` +
        `:large_yellow_circle: *In Progress:* ${inProgress}\n` +
        `:white_check_mark: *Completed:* ${completed}\n` +
        `:rotating_light: *Overdue:* ${overdue}`,
      responseType: 'in_channel',
    });
  } catch (error) {
    console.error('[Slack] Error getting workspace status:', error);
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Failed to get workspace status.',
      responseType: 'ephemeral',
    });
  }
}

/**
 * Handle /focura assign @user <task-id>
 */
async function handleSlackAssignCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
  args: string[],
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  if (args.length < 2) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':warning: Usage: `/focura assign @slackuser <task-id>`',
      responseType: 'ephemeral',
    });
    return;
  }

  const slackMention = args[0];
  const taskId = args[1];
  const slackUserId = slackMention.replace(/[<@>]/g, '');

  try {
    // Resolve Slack user to Focura user
    const focuraUserId = await slackService.resolveSlackUserToFocuraUserId(slackUserId);
    if (!focuraUserId) {
      await slackService.respondToUrl(command.responseUrl, {
        text: ':x: Could not find a Focura user linked to that Slack account.',
        responseType: 'ephemeral',
      });
      return;
    }

    // Find the task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, workspaceId: true },
    });

    if (!task || (workspaceId && task.workspaceId !== workspaceId)) {
      await slackService.respondToUrl(command.responseUrl, {
        text: `:x: Task \`${taskId}\` not found in this workspace.`,
        responseType: 'ephemeral',
      });
      return;
    }

    // Upsert the assignment
    const existingAssignee = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId, userId: focuraUserId } },
    });

    if (!existingAssignee) {
      await prisma.taskAssignee.create({
        data: { taskId, userId: focuraUserId },
      });
    }

    await slackService.respondToUrl(command.responseUrl, {
      text: `:bust_in_silhouette: *${task.title}* assigned to <@${slackUserId}> :white_check_mark:`,
      responseType: 'in_channel',
    });
  } catch (error) {
    console.error('[Slack] Error assigning task:', error);
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Failed to assign task.',
      responseType: 'ephemeral',
    });
  }
}

/**
 * Handle /focura search <query>
 */
async function handleSlackSearchCommand(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  command: SlackSlashCommand,
  args: string[],
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  if (args.length === 0) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':warning: Usage: `/focura search <query>`',
      responseType: 'ephemeral',
    });
    return;
  }

  const query = sanitizeString(args.join(' '));
  if (!query) {
    await slackService.respondToUrl(command.responseUrl, {
      text: ':warning: Please provide a search query.',
      responseType: 'ephemeral',
    });
    return;
  }

  try {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      select: { id: true, title: true, status: true, priority: true },
    });

    if (tasks.length === 0) {
      await slackService.respondToUrl(command.responseUrl, {
        text: `:mag: No tasks found matching "${query}"`,
        responseType: 'ephemeral',
      });
      return;
    }

    const taskList = tasks.map((t, i) =>
      `${i + 1}. *${t.title}* — ${t.status}${t.priority ? ` (${t.priority})` : ''}`
    ).join('\n');

    await slackService.respondToUrl(command.responseUrl, {
      text: `:mag: *Search Results for "${query}"*\n\n${taskList}`,
      responseType: 'ephemeral',
    });
  } catch (error) {
    console.error('[Slack] Error searching tasks:', error);
    await slackService.respondToUrl(command.responseUrl, {
      text: ':x: Failed to search tasks.',
      responseType: 'ephemeral',
    });
  }
}

// ─── Slack Interactive Components ─────────────────────────────────────────────

/**
 * Handle interactive component payloads (block actions, modals, message actions)
 */
async function handleSlackInteraction(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: SlackInteractionPayload,
): Promise<void> {
  switch (payload.type) {
    case 'block_actions':
      await handleSlackBlockActions(integration, payload);
      break;
    case 'view_submission':
      await handleSlackViewSubmission(integration, payload);
      break;
    case 'message_action':
      await handleSlackMessageAction(integration, payload);
      break;
    case 'shortcut':
      await handleSlackShortcut(integration, payload);
      break;
    default:
      console.log('[SlackWebhook] Unknown interaction type:', payload.type);
  }
}

/**
 * Handle block actions (button clicks, select menus, etc.)
 */
async function handleSlackBlockActions(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: SlackInteractionPayload,
): Promise<void> {
  const slackService = new SlackService(integration.id);
  const workspaceId: string | undefined = integration.workspaceId ?? undefined;

  if (!payload.actions || payload.actions.length === 0) return;
  const action = payload.actions[0];
  const actionId = action.actionId;

  // Acknowledge the action immediately
  // (Slack requires a 200 response within 3 seconds)

  if (actionId.startsWith('task_status_')) {
    // Update task status
    const taskId = action.value;
    const newStatus = actionId.replace('task_status_', '').toUpperCase();

    try {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: newStatus as any },
      });

      // Update the message to reflect the change
      if (payload.responseUrl) {
        await slackService.respondToUrl(payload.responseUrl, {
          text: `:white_check_mark: Task status updated to *${newStatus}*`,
          responseType: 'ephemeral',
          replaceOriginal: false,
        });
      }
    } catch (error) {
      console.error('[Slack] Error updating task status from action:', error);
    }
  }

  if (actionId === 'create_task_from_message' && payload.channel && payload.message) {
    // Create a task from the Slack message
    const createdById = integration.connectedById ?? integration.userId;
    if (!createdById || !workspaceId) return;

    const messageText = payload.message.text || 'Untitled Task';
    const title = messageText.substring(0, 200);

    try {
      const task = await prisma.task.create({
        data: {
          title,
          status: 'TODO',
          createdById,
          workspaceId,
          slackChannelId: payload.channel.id,
          slackMessageTs: (payload.message as any).ts,
          slackUserId: payload.user.id,
          slackUserDisplayName: payload.user.name,
        },
      });

      if (payload.responseUrl) {
        await slackService.respondToUrl(payload.responseUrl, {
          text: `:white_check_mark: *Task Created:* ${title}\n:wastebasket: *ID:* \`${task.id}\``,
          responseType: 'in_channel',
          replaceOriginal: false,
        });
      }
    } catch (error) {
      console.error('[Slack] Error creating task from message action:', error);
    }
  }
}

/**
 * Handle modal view submissions (form data from modals)
 */
async function handleSlackViewSubmission(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: SlackInteractionPayload,
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  const slackService = new SlackService(integration.id);

  const view = payload.view;
  if (!view?.state?.values) return;

  // Extract form values
  const values = view.state.values;
  const callbackId = view.callbackId || view.privateMetadata || '';

  // Handle task creation modal
  if (callbackId === 'create_task_modal') {
    const titleBlock = Object.values(values).find(v => v.title);
    const descBlock = Object.values(values).find(v => v.description);
    const priorityBlock = Object.values(values).find(v => v.priority);

    const title = titleBlock?.title?.value || 'Untitled Task';
    const description = descBlock?.description?.value || '';
    const priority = priorityBlock?.priority?.selected_option?.value || 'MEDIUM';

    const createdById = integration.connectedById ?? integration.userId;
    if (!createdById || !workspaceId) {
      await slackService.respondToUrl(payload.responseUrl || '', {
        text: ':x: Could not create task. Please try again.',
        responseType: 'ephemeral',
      });
      return;
    }

    try {
      const task = await prisma.task.create({
        data: {
          title,
          description,
          priority: priority as any,
          status: 'TODO',
          createdById,
          workspaceId,
        },
      });

      const frontendUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || '';
      await slackService.postMessage({
        channel: payload.user.id,
        text: `:white_check_mark: *Task Created:* ${title}\n:wastebasket: *ID:* \`${task.id}\`\n${frontendUrl ? `<${frontendUrl}/dashboard/tasks/${task.id}|View in Focura>` : ''}`,
      });
    } catch (error) {
      console.error('[Slack] Error creating task from modal:', error);
    }
  }
}

/**
 * Handle message actions (from message context menus)
 */
async function handleSlackMessageAction(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: SlackInteractionPayload,
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  if (!workspaceId) return;

  const slackService = new SlackService(integration.id);
  const callbackId = payload.callbackId || '';

  if (callbackId === 'create_task_from_message') {
    // Open a modal to create a task from the message
    const messageText = payload.message?.text || 'Task from Slack';

    await slackService.openModal({
      triggerId: payload.triggerId || '',
      view: {
        type: 'modal',
        callback_id: 'create_task_modal',
        title: { type: 'plain_text', text: 'Create Task' },
        submit: { type: 'plain_text', text: 'Create' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'title_block',
            element: {
              type: 'plain_text_input',
              action_id: 'title',
              initial_value: messageText.substring(0, 200),
            },
            label: { type: 'plain_text', text: 'Title' },
          },
          {
            type: 'input',
            block_id: 'desc_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'description',
              multiline: true,
            },
            label: { type: 'plain_text', text: 'Description' },
          },
          {
            type: 'input',
            block_id: 'priority_block',
            element: {
              type: 'static_select',
              action_id: 'priority',
              initial_option: { value: 'MEDIUM', text: { type: 'plain_text', text: 'Medium' } },
              options: [
                { value: 'URGENT', text: { type: 'plain_text', text: 'Urgent' } },
                { value: 'HIGH', text: { type: 'plain_text', text: 'High' } },
                { value: 'MEDIUM', text: { type: 'plain_text', text: 'Medium' } },
                { value: 'LOW', text: { type: 'plain_text', text: 'Low' } },
              ],
            },
            label: { type: 'plain_text', text: 'Priority' },
          },
        ],
        private_metadata: `workspaceId:${workspaceId}`,
      },
    });
  }
}

/**
 * Handle global shortcuts
 */
async function handleSlackShortcut(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: SlackInteractionPayload,
): Promise<void> {
  const workspaceId = integration.workspaceId ?? undefined;
  if (!workspaceId) return;

  const slackService = new SlackService(integration.id);
  const callbackId = payload.callbackId || '';

  if (callbackId === 'quick_create_task') {
    await slackService.openModal({
      triggerId: payload.triggerId || '',
      view: {
        type: 'modal',
        callback_id: 'create_task_modal',
        title: { type: 'plain_text', text: 'Quick Create Task' },
        submit: { type: 'plain_text', text: 'Create' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'title_block',
            element: {
              type: 'plain_text_input',
              action_id: 'title',
              placeholder: { type: 'plain_text', text: 'Enter task title' },
            },
            label: { type: 'plain_text', text: 'Title' },
          },
          {
            type: 'input',
            block_id: 'desc_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'description',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'Optional description' },
            },
            label: { type: 'plain_text', text: 'Description' },
          },
          {
            type: 'input',
            block_id: 'priority_block',
            element: {
              type: 'static_select',
              action_id: 'priority',
              initial_option: { value: 'MEDIUM', text: { type: 'plain_text', text: 'Medium' } },
              options: [
                { value: 'URGENT', text: { type: 'plain_text', text: 'Urgent' } },
                { value: 'HIGH', text: { type: 'plain_text', text: 'High' } },
                { value: 'MEDIUM', text: { type: 'plain_text', text: 'Medium' } },
                { value: 'LOW', text: { type: 'plain_text', text: 'Low' } },
              ],
            },
            label: { type: 'plain_text', text: 'Priority' },
          },
        ],
        private_metadata: `workspaceId:${workspaceId}`,
      },
    });
  }
}

// ─── Slack Event Callbacks ────────────────────────────────────────────────────

/**
 * Handle Slack event callbacks (app_mention, message, reaction_added, etc.)
 */
async function handleSlackEventCallback(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null; config: unknown },
  payload: SlackEventPayload,
  workspaceId?: string,
): Promise<void> {
  const event = payload.event;
  if (!event) return;

  const slackService = new SlackService(integration.id);

  switch (event.type) {
    case 'app_mention':
      await handleAppMention(integration, event, workspaceId);
      break;

    case 'message':
      // Only handle messages in channels (not DMs with the bot itself)
      // Messages are passively monitored - task creation happens via:
      // - Slash commands (/focura create)
      // - App mentions (@Focura create task)
      // - Message actions (context menu)
      if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') break;
      if (event.channelType === 'im') break;
      break;

    case 'reaction_added': {
      // Check if this is a task creation via reaction
      if (event.reaction === 'white_check_mark' || event.reaction === 'heavy_plus_sign') {
        await handleReactionTaskCreation(integration, event, workspaceId);
      }
      break;
    }

    case 'link_shared':
      // Could handle link unfurling for Focura task links
      console.log('[SlackWebhook] Link shared event received');
      break;

    case 'member_joined_channel':
      // Could welcome user and provide help info
      if (event.channel) {
        await slackService.postMessage({
          channel: event.channel,
          text: `:wave: Hello! I'm Focura Bot. Use \`/focura help\` to see what I can do, or just @mention me to create tasks from messages!`,
        }).catch(() => {});
      }
      break;

    default:
      console.log(`[SlackWebhook] Unhandled event type: ${event.type}`);
  }
}

/**
 * Handle @focura mentions in channels
 */
async function handleAppMention(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  event: SlackEventPayload['event'],
  workspaceId?: string,
): Promise<void> {
  const slackService = new SlackService(integration.id);
  const text = event.text || '';
  const channelId = event.channel || '';
  const threadTs = event.threadTs || event.eventTs;
  const user = event.user || '';

  // Check if the mention includes a task creation request
  const lowerText = text.toLowerCase();

  if (lowerText.includes('create task') || lowerText.includes('add task')) {
    // Extract task title from the mention
    const title = text
      .replace(/<@[^>]+>/g, '')  // Remove mention
      .replace(/(create task|add task)/i, '')  // Remove command
      .trim();

    if (!title) {
      await slackService.postMessage({
        channel: channelId,
        text: `:wave: Hi there! To create a task, say \`@Focura create task <title>\`.`,
        threadTs,
      }).catch(() => {});
      return;
    }

    const createdById = integration.connectedById ?? integration.userId;
    if (!createdById || !workspaceId) return;

    try {
      const task = await prisma.task.create({
        data: {
          title: sanitizeString(title) || 'Untitled Task',
          status: 'TODO',
          createdById,
          workspaceId,
          slackChannelId: channelId,
          slackThreadTs: threadTs,
          slackUserId: user,
        },
      });

      await slackService.postMessage({
        channel: channelId,
        text: `:white_check_mark: *Task Created:* ${title}\n:wastebasket: *ID:* \`${task.id}\``,
        threadTs,
      }).catch(() => {});
    } catch (error) {
      console.error('[Slack] Error creating task from mention:', error);
    }
    return;
  }

  // General help response
  if (lowerText.includes('help') || lowerText.includes('what')) {
    await slackService.postMessage({
      channel: channelId,
      text: `:robot_face: *Focura Bot Help*\n\n` +
        `• \`@Focura create task <title>\` - Create a task from this conversation\n` +
        `• \`/focura status\` - View workspace overview\n` +
        `• \`/focura list\` - View your tasks\n` +
        `• \`/focura assign @user <task-id>\` - Assign a task\n` +
        `• \`/focura search <query>\` - Search tasks`,
      threadTs,
    }).catch(() => {});
    return;
  }

  // Default response
  await slackService.postMessage({
    channel: channelId,
    text: `:wave: Hello! I'm Focura Bot. Say \`@Focura help\` to see what I can do!`,
    threadTs,
  }).catch(() => {});
}

/**
 * Handle reaction added to create a task from the reacted message
 */
async function handleReactionTaskCreation(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  event: SlackEventPayload['event'],
  workspaceId?: string,
): Promise<void> {
  const item = event.item;
  if (!item || !workspaceId) return;

  const slackService = new SlackService(integration.id);
  const user = event.user || '';
  const channelId = item.channel;
  const messageTs = item.ts;

  // Get the message text from conversation history
  const { messages } = await slackService.getConversationHistory({
    channel: channelId,
    latest: messageTs,
    limit: 1,
    inclusive: true,
  });

  const message = messages[0];
  if (!message || !message.text) return;

  const createdById = integration.connectedById ?? integration.userId;
  if (!createdById) return;

  try {
    const title = message.text.substring(0, 200);

    // Check if a task already exists linked to this message
    const existingTask = await prisma.task.findFirst({
      where: {
        workspaceId,
        slackChannelId: channelId,
        slackMessageTs: messageTs,
      },
    });

    if (existingTask) {
      // Task already exists, notify
      await slackService.postMessage({
        channel: channelId,
        text: `:information_source: A task already exists for this message: *${existingTask.title}* (ID: \`${existingTask.id}\`)`,
        threadTs: messageTs,
      }).catch(() => {});
      return;
    }

    const task = await prisma.task.create({
      data: {
        title,
        status: 'TODO',
        createdById,
        workspaceId,
        slackChannelId: channelId,
        slackMessageTs: messageTs,
        slackUserId: user,
        slackUserDisplayName: (message as any).userDisplayName || undefined,
      },
    });

    // Get permalink for the message
    const permalink = await slackService.getMessagePermalink(channelId, messageTs);

    await slackService.postMessage({
      channel: channelId,
      text: `:white_check_mark: *Task created from this message!*\n:wastebasket: *ID:* \`${task.id}\`\n` +
        (permalink ? `<${permalink}|View in Slack>` : ''),
      threadTs: messageTs,
    }).catch(() => {});

    // Add reaction to confirm
    await slackService.addReaction({
      channel: channelId,
      timestamp: messageTs,
      reaction: 'white_check_mark',
    }).catch(() => {});
  } catch (error) {
    console.error('[Slack] Error creating task from reaction:', error);
  }
}

// ─── GitHub Processor (unchanged) ─────────────────────────────────────────────

async function processGithubWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null; config: unknown },
  payload: Record<string, unknown>,
) {
  const wsIdForGithub = integration.workspaceId ?? undefined;
  try {
    const ghPayload = payload as unknown as GitHubWebhookPayload;
    const event = ghPayload.action;
    const config = integration.config as IntegrationConfig;

    const ghWorkspaceId = wsIdForGithub;

    // Handle PR events
    if (ghPayload.pull_request) {
      const pr = ghPayload.pull_request;
      const prNumber = sanitizeNumber(pr.number);
      if (!prNumber) return;

      const prUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/pull/${prNumber}` : undefined;
      const repoFullName = sanitizeString(ghPayload.repository?.full_name);
      const branchName = sanitizeString(pr.head?.ref);
      const branchUrl = branchName && ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/tree/${branchName}` : undefined;

      let prStatus: string;
      if (event === 'closed' && pr.merged) {
        prStatus = 'merged';
      } else if (event === 'closed') {
        prStatus = 'closed';
      } else {
        prStatus = 'open';
      }

      console.log(`PR ${prStatus}: ${pr.title} (#${prNumber}) in ${repoFullName}`);

      const linkedTasks = await prisma.task.findMany({
        where: {
          workspaceId: ghWorkspaceId,
          OR: [
            { AND: [{ githubPrNumber: prNumber }, { githubRepo: repoFullName }] },
            { title: { contains: `#${prNumber}` } },
            { description: { contains: `#${prNumber}` } },
            { githubBranchName: branchName },
          ],
        },
        take: 100,
      });

      console.log(`Found ${linkedTasks.length} linked tasks`);

      for (const task of linkedTasks) {
        const updateData: Record<string, unknown> = {
          githubPrUrl: prUrl,
          githubPrNumber: prNumber,
          githubPrStatus: prStatus,
          githubRepo: repoFullName,
          githubPrChecks: { totalChecks: 0, passingChecks: 0 },
        };

        if (branchName) updateData.githubBranchName = branchName;
        if (branchUrl) updateData.githubBranchUrl = branchUrl;
        if (prStatus === 'merged') updateData.status = 'COMPLETED';

        await prisma.task.update({
          where: { id: task.id },
          data: updateData,
        });

        console.log(`Updated task ${task.id} with PR #${prNumber} status: ${prStatus}`);
      }
    }

    // Handle push events
    if (ghPayload.ref && ghPayload.after && !ghPayload.pull_request) {
      const branchName = ghPayload.ref.replace('refs/heads/', '');
      const repoFullName = ghPayload.repository?.full_name;
      const branchUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/tree/${branchName}` : undefined;

      console.log(`Push to branch: ${branchName} in ${repoFullName}`);

      const linkedTasks = await prisma.task.findMany({
        where: { workspaceId: ghWorkspaceId, githubBranchName: branchName },
        take: 100,
      });

      const latestCommit = ghPayload.head_commit;
      const commitSha = ghPayload.after;
      const commitUrl = latestCommit && ghPayload.repository
        ? `https://github.com/${ghPayload.repository.full_name}/commit/${commitSha}`
        : undefined;

      for (const task of linkedTasks) {
        const updateData: Record<string, unknown> = { githubBranchUrl: branchUrl };
        if (commitSha) updateData.githubCommitSha = commitSha;
        if (commitUrl) updateData.githubCommitUrl = commitUrl;
        if (latestCommit) {
          updateData.githubCommitMessage = latestCommit.message;
          updateData.githubCommitAuthor = latestCommit.author?.name;
        }

        await prisma.task.update({ where: { id: task.id }, data: updateData });
        console.log(`Updated task ${task.id} with branch URL and commit data`);
      }
    }

    // Handle workflow_run events
    if (ghPayload.workflow_run) {
      const workflowRun = ghPayload.workflow_run;
      const workflowStatus = workflowRun.conclusion || workflowRun.status;
      const branchName = workflowRun.head_branch;
      const commitSha = workflowRun.head_sha;

      const linkedTasks = await prisma.task.findMany({
        where: {
          workspaceId: ghWorkspaceId,
          OR: [{ githubBranchName: branchName }, { githubCommitSha: commitSha }],
        },
        take: 100,
      });

      for (const task of linkedTasks) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            githubWorkflowStatus: workflowStatus,
            githubWorkflowName: workflowRun.name,
            githubWorkflowUrl: workflowRun.html_url,
            githubWorkflowRunId: String(workflowRun.id),
          },
        });
        console.log(`Updated task ${task.id} with workflow status: ${workflowStatus}`);
      }
    }

    // Handle release events
    if (ghPayload.release) {
      const release = ghPayload.release;

      const linkedTasks = await prisma.task.findMany({
        where: { workspaceId: ghWorkspaceId, githubBranchName: release.target_commitish },
        take: 100,
      });

      for (const task of linkedTasks) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            githubReleaseName: release.name,
            githubReleaseUrl: release.html_url,
            githubReleaseTagName: release.tag_name,
          },
        });
        console.log(`Updated task ${task.id} with release: ${release.name}`);
      }
    }

    // Handle milestone events
    if (ghPayload.milestone) {
      const milestone = ghPayload.milestone;
      const linkedTasks = await prisma.task.findMany({
        where: { workspaceId: ghWorkspaceId, githubMilestoneTitle: milestone.title },
      });

      for (const task of linkedTasks) {
        await prisma.task.update({
          where: { id: task.id },
          data: { githubMilestoneState: milestone.state },
        });
        console.log(`Updated task ${task.id} with milestone state: ${milestone.state}`);
      }
    }

    // Handle issue events
    if (ghPayload.issue) {
      const issue = ghPayload.issue;
      const repoFullName = ghPayload.repository?.full_name;
      const issueUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/issues/${issue.number}` : undefined;
      const issueState = event === 'closed' ? 'closed' : 'open';

      if (config?.selectedRepos?.includes(repoFullName ?? '')) {
        const createdById = integration.connectedById ?? integration.userId;

        if (event === 'opened') {
          if (!createdById) {
            console.error('No user ID available for task creation');
            return;
          }

          const taskData: Record<string, unknown> = {
            title: issue.title,
            description: issue.body || '',
            status: 'TODO',
            githubIssueUrl: issueUrl,
            githubIssueNumber: issue.number,
            githubIssueState: issueState,
            createdBy: { connect: { id: createdById } },
          };

          if (issue.milestone) {
            taskData.githubMilestoneTitle = issue.milestone.title;
            taskData.githubMilestoneUrl = issue.milestone.html_url;
            taskData.githubMilestoneState = issue.milestone.state;
          }

          if (ghWorkspaceId) taskData.workspace = { connect: { id: ghWorkspaceId } };

          const task = await prisma.task.create({ data: taskData as any });
          console.log(`Created task ${task.id} from GitHub issue #${issue.number}`);
        } else if (event === 'closed') {
          const linkedTasks = await prisma.task.findMany({
            where: {
              workspaceId: ghWorkspaceId,
              githubIssueNumber: issue.number,
            },
          });

          for (const task of linkedTasks) {
            await prisma.task.update({
              where: { id: task.id },
              data: { githubIssueState: issueState },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing GitHub webhook:', error);
  }
}

// ─── Google Calendar Processor (unchanged) ────────────────────────────────────

async function processGoogleCalendarWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
) {
  try {
    const workspaceId = integration.workspaceId ?? undefined;
    const accessToken = await getValidAccessToken(integration.id);

    if (!accessToken) {
      console.error('No valid access token for Google Calendar sync');
      return;
    }

    const now = new Date();
    const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const eventsResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50&singleEvents=true&orderBy=startTime`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (eventsResponse.ok) {
      const data = await eventsResponse.json() as Record<string, unknown>;
      const events = (data.items as Array<Record<string, unknown>>) || [];

      for (const event of events) {
        const summary = sanitizeString(event.summary as string);
        const organizer = event.organizer as Record<string, unknown> | undefined;
        const start = event.start as Record<string, unknown> | undefined;
        const description = sanitizeString(event.description as string);

        if (summary && !organizer?.self) {
          const existingTask = await prisma.task.findFirst({
            where: { workspaceId, title: summary },
          });

          if (!existingTask && start?.dateTime) {
            const createdById = integration.connectedById ?? integration.userId;
            if (!createdById) continue;

            const task = await prisma.task.create({
              data: {
                title: summary,
                description: description || '',
                status: 'TODO',
                dueDate: new Date(start.dateTime as string),
                createdById,
                workspaceId: workspaceId || undefined,
              } as any,
            });

            console.log(`Created task ${task.id} from calendar event`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing Google Calendar webhook:', error);
  }
}

// ─── Trello Webhook Processor ───────────────────────────────────────────────

interface TrelloWebhookPayload {
  action?: {
    type: string;
    data?: Record<string, unknown>;
    member?: { id: string; fullName?: string };
    board?: { id: string; name?: string };
    card?: { id: string; name?: string; desc?: string; idList?: string; shortUrl?: string };
    list?: { id: string; name?: string };
  };
  model?: {
    id: string;
    name?: string;
    type?: string;
  };
  type?: string;
}

/**
 * Process Trello webhook event (card created, updated, moved, etc.)
 */
async function processTrelloWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: Record<string, unknown>,
) {
  const wsId = integration.workspaceId ?? undefined;
  const data = payload as unknown as TrelloWebhookPayload;

  try {
    if (!data.action) return;

    const action = data.action;
    const actionType = action.type;

    console.log(`[TrelloWebhook] Action: ${actionType}`);

    // Handle card creation
    if (actionType === 'createCard' && action.card) {
      const card = action.card;
      const createdById = integration.connectedById ?? integration.userId;
      if (!createdById) return;

      // Check if a task already exists for this card
      const existingTask = await prisma.task.findFirst({
        where: {
          workspaceId: wsId,
          title: card.name || 'Untitled Card',
        },
      });

      if (existingTask) {
        console.log(`[TrelloWebhook] Task already exists for card: ${card.name}`);
        return;
      }

      const task = await prisma.task.create({
        data: {
          title: sanitizeString(card.name) || 'Untitled Card',
          description: sanitizeString(card.desc) || '',
          status: 'TODO',
          createdById,
          workspaceId: wsId || undefined,
        } as any,
      });

      console.log(`[TrelloWebhook] Created task ${task.id} from card: ${card.name}`);
    }

    // Handle card movement between lists
    if (actionType === 'updateCard' && action.card && action.data) {
      const card = action.card;
      const updateData = action.data as Record<string, unknown>;

      // Find task by title match (Trello cards don't have a unique ID stored)
      const task = await prisma.task.findFirst({
        where: {
          workspaceId: wsId,
          title: card.name || undefined,
        },
      });

      if (task && updateData.listAfter) {
        const listAfter = updateData.listAfter as { name?: string };
        // Map Trello list names to task statuses
        const statusMap: Record<string, string> = {
          'To Do': 'TODO',
          'Doing': 'IN_PROGRESS',
          'Done': 'COMPLETED',
          'In Review': 'IN_REVIEW',
        };
        const newStatus = statusMap[listAfter.name || ''] || task.status;

        if (newStatus !== task.status) {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: newStatus as any },
          });
          console.log(`[TrelloWebhook] Updated task ${task.id} status to ${newStatus}`);
        }
      }
    }

    // Handle card deletion
    if (actionType === 'deleteCard' && action.card) {
      console.log(`[TrelloWebhook] Card deleted: ${action.card.name}`);
      // Note: We don't delete tasks when cards are deleted — only log it
    }
  } catch (error) {
    console.error('[TrelloWebhook] Error processing Trello webhook:', error);
  }
}
