import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { ValidationError } from '../../errors/index.js';
import { getValidAccessToken } from './integration.oauth.js';
import type { IntegrationConfig } from './integration.types.js';

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

// ─── Input Sanitization ──────────────────────────────────────────────────────

function sanitizeString(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  // Remove potential XSS vectors and limit length
  return input.replace(/[<>]/g, '').substring(0, 500);
}

function sanitizeNumber(input: number | undefined | null): number | undefined {
  if (input === undefined || input === null) return undefined;
  const num = Number(input);
  return isNaN(num) ? undefined : num;
}

/**
 * Handle webhook from provider (queues for async processing)
 */
export async function handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string) {
  // Validate provider
  const validProviders = ['github', 'slack', 'google-calendar'];
  if (!validProviders.includes(provider)) {
    console.error(`Invalid provider: ${provider}`);
    return;
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
  try {
    const ghPayload = payload as unknown as GitHubWebhookPayload;
    const event = ghPayload.action;
    const config = integration.config as IntegrationConfig;
    const workspaceId = integration.workspaceId ?? undefined;

    // Handle PR events
    if (ghPayload.pull_request) {
      const pr = ghPayload.pull_request;
      const prNumber = sanitizeNumber(pr.number);
      if (!prNumber) return;

      const prUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/pull/${prNumber}` : undefined;
      const repoFullName = sanitizeString(ghPayload.repository?.full_name);
      const branchName = sanitizeString(pr.head?.ref);
      const branchUrl = branchName && ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/tree/${branchName}` : undefined;

      // Determine PR status
      let prStatus: string;
      if (event === 'closed' && pr.merged) {
        prStatus = 'merged';
      } else if (event === 'closed') {
        prStatus = 'closed';
      } else {
        prStatus = 'open';
      }

      console.log(`PR ${prStatus}: ${pr.title} (#${prNumber}) in ${repoFullName}`);
      console.log(`Looking for tasks with: workspaceId=${workspaceId}, prNumber=${prNumber}, repo=${repoFullName}, branchName=${branchName}`);

      // Find tasks linked to this PR by:
      // 1. PR number + repo name (exact match)
      // 2. PR number in title/description (fuzzy match for existing tasks)
      // 3. Branch name match
      const linkedTasks = await prisma.task.findMany({
        where: {
          workspaceId,
          OR: [
            // Exact match: PR number + repo
            { AND: [{ githubPrNumber: prNumber }, { githubRepo: repoFullName }] },
            // Fuzzy match: PR number in title or description
            { title: { contains: `#${prNumber}` } },
            { description: { contains: `#${prNumber}` } },
            // Branch name match
            { githubBranchName: branchName },
          ],
        },
        take: 100,
      });

      console.log(`Found ${linkedTasks.length} linked tasks`);

      // Update linked tasks with PR data, branch data, and repo name
      for (const task of linkedTasks) {
        const updateData: Record<string, unknown> = {
          githubPrUrl: prUrl,
          githubPrNumber: prNumber,
          githubPrStatus: prStatus,
          githubRepo: repoFullName,
          githubPrChecks: { totalChecks: 0, passingChecks: 0 },
        };

        // Add branch data if available
        if (branchName) {
          updateData.githubBranchName = branchName;
        }
        if (branchUrl) {
          updateData.githubBranchUrl = branchUrl;
        }

        // Auto-close on merge
        if (prStatus === 'merged') {
          updateData.status = 'COMPLETED';
        }

        await prisma.task.update({
          where: { id: task.id },
          data: updateData,
        });

      console.log(`Updated task ${task.id} with PR #${prNumber} status: ${prStatus}`);
    }
  }

  // Handle push events (for branch updates and commit data)
  if (ghPayload.ref && ghPayload.after && !ghPayload.pull_request) {
    const branchName = ghPayload.ref.replace('refs/heads/', '');
    const repoFullName = ghPayload.repository?.full_name;
    const branchUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/tree/${branchName}` : undefined;

    console.log(`Push to branch: ${branchName} in ${repoFullName}`);

    // Find tasks that might be linked to this branch
    const linkedTasks = await prisma.task.findMany({
      where: {
        workspaceId,
        githubBranchName: branchName,
      },
      take: 100,
    });

    // Get latest commit data if available
    const latestCommit = ghPayload.head_commit;
    const commitSha = ghPayload.after;
    const commitUrl = latestCommit && ghPayload.repository
      ? `https://github.com/${ghPayload.repository.full_name}/commit/${commitSha}`
      : undefined;

    // Update tasks with branch and commit data
    for (const task of linkedTasks) {
      const updateData: Record<string, unknown> = {
        githubBranchUrl: branchUrl,
      };

      // Add commit data if available
      if (commitSha) {
        updateData.githubCommitSha = commitSha;
      }
      if (commitUrl) {
        updateData.githubCommitUrl = commitUrl;
      }
      if (latestCommit) {
        updateData.githubCommitMessage = latestCommit.message;
        updateData.githubCommitAuthor = latestCommit.author?.name;
      }

      await prisma.task.update({
        where: { id: task.id },
        data: updateData,
      });
      console.log(`Updated task ${task.id} with branch URL and commit data`);
    }
  }

  // Handle workflow_run events (GitHub Actions)
  if (ghPayload.workflow_run) {
    const workflowRun = ghPayload.workflow_run;
    const workflowStatus = workflowRun.conclusion || workflowRun.status;
    const branchName = workflowRun.head_branch;
    const commitSha = workflowRun.head_sha;

    console.log(`Workflow ${workflowRun.name} ${workflowStatus} on ${branchName}`);

    // Find tasks linked to this branch or commit
    const linkedTasks = await prisma.task.findMany({
      where: {
        workspaceId,
        OR: [
          { githubBranchName: branchName },
          { githubCommitSha: commitSha },
        ],
      },
      take: 100,
    });

    // Update tasks with workflow data
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
    const repoFullName = ghPayload.repository?.full_name;

    console.log(`Release ${event}: ${release.name} (${release.tag_name}) in ${repoFullName}`);

    // Find tasks that might be linked to this release's branch or mentioned in release notes
    const linkedTasks = await prisma.task.findMany({
      where: {
        workspaceId,
        githubBranchName: release.target_commitish,
      },
      take: 100,
    });

    // Update tasks with release data
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
    const repoFullName = ghPayload.repository?.full_name;

    console.log(`Milestone ${event}: ${milestone.title} in ${repoFullName}`);

    // Find tasks that might be linked to this milestone
    const linkedTasks = await prisma.task.findMany({
      where: {
        workspaceId,
        githubMilestoneTitle: milestone.title,
      },
    });

    // Update tasks with milestone data
    for (const task of linkedTasks) {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          githubMilestoneState: milestone.state,
        },
      });
      console.log(`Updated task ${task.id} with milestone state: ${milestone.state}`);
    }
  }

  // Handle issue events (with milestone support)
  if (ghPayload.issue) {
    const issue = ghPayload.issue;
    const repoFullName = ghPayload.repository?.full_name;
    const issueUrl = ghPayload.repository ? `https://github.com/${ghPayload.repository.full_name}/issues/${issue.number}` : undefined;

    // Determine issue state
    const issueState = event === 'closed' ? 'closed' : 'open';

    console.log(`Issue ${issueState}: ${issue.title} in ${repoFullName}`);

    // Check if task creation is enabled in config
    if (config?.selectedRepos?.includes(repoFullName ?? '')) {
      const createdById = integration.connectedById ?? integration.userId;

      if (event === 'opened') {
        // Create task from new issue
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

        // Add milestone data if available
        if (issue.milestone) {
          taskData.githubMilestoneTitle = issue.milestone.title;
          taskData.githubMilestoneUrl = issue.milestone.html_url;
          taskData.githubMilestoneState = issue.milestone.state;
        }

        if (workspaceId) {
          taskData.workspace = { connect: { id: workspaceId } };
        }

        const task = await prisma.task.create({
          data: taskData as any,
        });

        console.log(`Created task ${task.id} from GitHub issue #${issue.number}`);
      } else if (event === 'closed') {
        // Update existing tasks linked to this issue
        const linkedTasks = await prisma.task.findMany({
          where: {
            workspaceId,
            githubIssueNumber: issue.number,
          },
        });

        for (const task of linkedTasks) {
          await prisma.task.update({
            where: { id: task.id },
            data: { githubIssueState: issueState },
          });
          console.log(`Updated task ${task.id} with issue #${issue.number} state: ${issueState}`);
        }
      }
    }
  }
  } catch (error) {
    console.error('Error processing GitHub webhook:', error);
    // Don't throw - webhook processing should fail gracefully
  }
}

async function processSlackWebhook(
  integration: { id: string; workspaceId: string | null; connectedById: string | null; userId: string | null },
  payload: Record<string, unknown>,
) {
  try {
    const slackPayload = payload as unknown as SlackWebhookPayload;
    const workspaceId = integration.workspaceId ?? undefined;

    // Handle slash commands
    if (slackPayload.type === 'slash_commands') {
      const command = sanitizeString(slackPayload.command);
      const text = sanitizeString(slackPayload.text) || '';
      const userId = sanitizeString(slackPayload.user_id);

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
            const title = sanitizeString(parts.slice(1).join(' '));
            if (!title) return;

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
  } catch (error) {
    console.error('Error processing Slack webhook:', error);
  }
}

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
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (eventsResponse.ok) {
      const data = await eventsResponse.json() as Record<string, unknown>;
      const events = (data.items as Array<Record<string, unknown>>) || [];

      console.log(`Processing ${events.length} calendar events`);

      // Sync events as tasks if configured
      for (const event of events) {
        const summary = sanitizeString(event.summary as string);
        const organizer = event.organizer as Record<string, unknown> | undefined;
        const start = event.start as Record<string, unknown> | undefined;
        const description = sanitizeString(event.description as string);

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
  } catch (error) {
    console.error('Error processing Google Calendar webhook:', error);
  }
}
