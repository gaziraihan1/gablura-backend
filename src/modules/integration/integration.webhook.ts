import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { ValidationError } from '../../errors/index.js';
import { getValidAccessToken } from './integration.oauth.js';
import type { IntegrationConfig } from './integration.types.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

interface GitHubWebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    merged: boolean;
    title: string;
  };
  issue?: {
    title: string;
    body?: string;
  };
  repository?: {
    full_name: string;
  };
}

interface SlackWebhookPayload {
  type?: string;
  command?: string;
  text?: string;
  user_id?: string;
  channel_id?: string;
  event?: {
    type?: string;
    text?: string;
    reaction?: string;
  };
}

// ─── Webhook Functions ───────────────────────────────────────────────────────

/**
 * Handle webhook from provider (queues for async processing)
 */
export async function handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string) {
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
    const isValid = verifyWebhookSignature(provider, payload, signature, integration.webhookSecret);
    if (!isValid) {
      throw new ValidationError('Invalid webhook signature');
    }
  }

  // Add to queue for async processing
  const { addProcessWebhookJob } = await import('../../queue/queues/integration.queue.js');
  await addProcessWebhookJob({
    provider,
    integrationId: integration.id,
    payload,
    signature,
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
) {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || !integration.active) {
    console.error(`Integration ${integrationId} not found or inactive`);
    return;
  }

  // Verify webhook signature if secret is set
  if (integration.webhookSecret && signature) {
    const isValid = verifyWebhookSignature(provider, payload, signature, integration.webhookSecret);
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
      await processSlackWebhook(integration, payload);
      break;
    case 'google-calendar':
      await processGoogleCalendarWebhook(integration);
      break;
  }
}

// ─── Signature Verification ──────────────────────────────────────────────────

function verifyWebhookSignature(
  provider: string,
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  switch (provider) {
    case 'github': {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(JSON.stringify(payload)).digest('hex');
      return signature === `sha256=${digest}`;
    }
    case 'slack': {
      // Slack uses HMAC-SHA256
      const timestamp = payload.timestamp as string;
      const body = JSON.stringify(payload.body);
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(`${timestamp}:${body}`);
      const expected = hmac.digest('hex');
      return signature === expected;
    }
    default:
      return true;
  }
}

// ─── Provider-Specific Processors ────────────────────────────────────────────

async function processGithubWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null; config: unknown },
  payload: Record<string, unknown>,
) {
  const ghPayload = payload as unknown as GitHubWebhookPayload;
  const event = ghPayload.action;
  const config = integration.config as IntegrationConfig;
  const workspaceId = integration.workspaceId ?? undefined;

  // Handle PR events
  if (ghPayload.pull_request) {
    if (event === 'closed' && ghPayload.pull_request.merged) {
      // PR merged - find linked tasks and close them
      const prNumber = ghPayload.pull_request.number;
      const repoFullName = ghPayload.repository?.full_name;

      console.log(`PR merged: ${ghPayload.pull_request.title} (#${prNumber})`);

      // Find tasks linked to this PR by PR number in title or description
      const linkedTasks = await prisma.task.findMany({
        where: {
          workspaceId,
          OR: [
            { title: { contains: `#${prNumber}` } },
            { description: { contains: `#${prNumber}` } },
            { title: { contains: repoFullName } },
          ],
        },
      });

      // Auto-close linked tasks
      for (const task of linkedTasks) {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'COMPLETED' },
        });
        console.log(`Auto-closed task ${task.id} due to PR merge`);
      }
    }
  }

  // Handle issue events
  if (ghPayload.issue && event === 'opened') {
    // Create task from GitHub issue
    const issue = ghPayload.issue;
    const repoFullName = ghPayload.repository?.full_name;

    console.log(`New issue: ${issue.title} in ${repoFullName}`);

    // Check if task creation is enabled in config
    if (config?.selectedRepos?.includes(repoFullName ?? '')) {
      // Create task from issue
      const createdById = integration.connectedById ?? integration.userId;
      if (!createdById) {
        console.error('No user ID available for task creation');
        return;
      }

      const taskData: Record<string, unknown> = {
        title: issue.title,
        description: issue.body || '',
        status: 'TODO',
        createdBy: { connect: { id: createdById } },
      };

      if (workspaceId) {
        taskData.workspace = { connect: { id: workspaceId } };
      }

      const task = await prisma.task.create({
        data: taskData as any,
      });

      console.log(`Created task ${task.id} from GitHub issue`);
    }
  }
}

async function processSlackWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: Record<string, unknown>,
) {
  const slackPayload = payload as unknown as SlackWebhookPayload;
  const workspaceId = integration.workspaceId ?? undefined;

  // Handle slash commands
  if (slackPayload.type === 'slash_commands') {
    const command = slackPayload.command;
    const text = slackPayload.text || '';
    const userId = slackPayload.user_id;

    console.log(`Slack command: ${command} from user ${userId}`);

    // Process different slash commands
    switch (command) {
      case '/focura':
      case '/f': {
        // Parse command: /focura create <title> or /focura status
        const parts = text.split(' ').filter(Boolean);
        const subcommand = parts[0];

        if (subcommand === 'create' && parts.length > 1) {
          // Create task from Slack message
          const title = parts.slice(1).join(' ');
          const createdById = integration.connectedById ?? integration.userId;
          if (!createdById) {
            console.error('No user ID available for task creation');
            return;
          }

          const taskData: Record<string, unknown> = {
            title,
            status: 'TODO',
            createdBy: { connect: { id: createdById } },
          };

          if (workspaceId) {
            taskData.workspace = { connect: { id: workspaceId } };
          }

          const task = await prisma.task.create({
            data: taskData as any,
          });

          console.log(`Created task ${task.id} from Slack command`);
        } else if (subcommand === 'status') {
          // Return workspace status
          const taskCount = await prisma.task.count({
            where: { workspaceId },
          });

          console.log(`Workspace has ${taskCount} tasks`);
        }
        break;
      }
    }
  }

  // Handle events (message changes, etc.)
  if (slackPayload.event) {
    const eventType = slackPayload.event.type;

    switch (eventType) {
      case 'message':
        // Handle new messages - could create tasks from mentions
        if (slackPayload.event.text?.includes('@focura')) {
          console.log('Focura mentioned in Slack message');
          // Could create task or send notification
        }
        break;

      case 'reaction_added':
        // Handle reactions - could trigger actions
        console.log(`Reaction added: ${slackPayload.event.reaction}`);
        break;
    }
  }
}

async function processGoogleCalendarWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
) {
  const workspaceId = integration.workspaceId ?? undefined;
  const accessToken = await getValidAccessToken(integration.id);

  if (!accessToken) {
    console.error('No valid access token for Google Calendar sync');
    return;
  }

  // Fetch recent calendar changes
  const now = new Date();
  const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const eventsResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50&singleEvents=true&orderBy=startTime`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (eventsResponse.ok) {
    const data = await eventsResponse.json() as Record<string, unknown>;
    const events = (data.items as Array<Record<string, unknown>>) || [];

    console.log(`Processing ${events.length} calendar events`);

    // Sync events as tasks if configured
    for (const event of events) {
      const summary = event.summary as string;
      const organizer = event.organizer as Record<string, unknown> | undefined;
      const start = event.start as Record<string, unknown> | undefined;
      const description = event.description as string | undefined;

      if (summary && !organizer?.self) {
        // Check if task already exists for this event
        const existingTask = await prisma.task.findFirst({
          where: {
            workspaceId,
            title: summary,
          },
        });

        if (!existingTask && start?.dateTime) {
          // Create task from calendar event
          const createdById = integration.connectedById ?? integration.userId;
          if (!createdById) {
            console.error('No user ID available for task creation');
            continue;
          }

          const taskData: Record<string, unknown> = {
            title: summary,
            description: description || '',
            status: 'TODO',
            dueDate: new Date(start.dateTime as string),
            createdBy: { connect: { id: createdById } },
          };

          if (workspaceId) {
            taskData.workspace = { connect: { id: workspaceId } };
          }

          const task = await prisma.task.create({
            data: taskData as any,
          });

          console.log(`Created task ${task.id} from calendar event`);
        }
      }
    }
  }
}
