import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { TaskQuery }         from './task.query.js';
import { TaskMutation }      from './task.mutation.js';
import { TaskActivity }      from './task.activity.js';
import { TaskNotifications } from './task.notifications.js';
import { computeTaskChanges } from './task.utils.js';
import { CalendarAggregation } from '../calendar/calendar.aggregation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  getPersonalQuotaInfo,
  getWorkspaceQuotaInfo,
} from './task.limits.js';
import {
  getTasksQuerySchema,
  getTaskStatsQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  upsertRecurrenceSchema,
} from './task.validators.js';
import { prisma } from '../../lib/prisma.js';
import { emitAutomationEvent } from '../automation/automation.events.js';

// ─── Slack URL Validation ─────────────────────────────────────────────────────

function isValidSlackMessageUrl(url: string): boolean {
  // Format: https://<workspace>.slack.com/archives/<channel>/p<timestamp>
  return /^https:\/\/[^.]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/.test(url);
}

export const getTasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { labelIds: rawLabelIds, ...rest } = parsed.data;
  const labelIds = rawLabelIds ? rawLabelIds.split(',').filter(Boolean) : undefined;

  const result = await TaskQuery.getTasks(
    { userId: req.user!.id, ...rest, labelIds },
    { page: parsed.data.page, pageSize: parsed.data.pageSize },
    { sortBy: parsed.data.sortBy, sortOrder: parsed.data.sortOrder },
  );

  res.json({ success: true, data: result.data, pagination: result.pagination });
});

export const getTaskStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getTaskStatsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const stats = await TaskQuery.getTaskStats({ userId: req.user!.id, ...parsed.data });
  res.json({ success: true, data: stats });
});

export const getTaskOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
  const overview = await TaskQuery.getTaskOverview(req.params.id, req.user!.id);
  res.json({ success: true, data: overview });
});

export const createTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validate before submitting (filled the form)', parsed.error.issues);

  const data = parsed.data;
  const task = await TaskMutation.createTask(
    { ...data, createdById: req.user!.id },
    async ({ task, assigneeIds }) => {
      if (task.workspaceId) {
        void TaskActivity.logCreated({
          taskId:        task.id,
          taskTitle:     task.title,
          userId:        req.user!.id,
          workspaceId:   task.workspaceId,
          focusRequired: data.focusRequired,
          energyType:    data.energyType,
          intent:        data.intent,
        });
      }
      if (assigneeIds.length > 0) {
        void TaskNotifications.notifyNewAssignees({
          taskId:      task.id,
          taskTitle:   task.title,
          assigneeIds,
          creatorId:   req.user!.id,
        });
      }
      if (task.dueDate) {
        void CalendarAggregation.recalculateDay(req.user!.id, task.workspaceId || undefined, task.dueDate);
      }
      if (task.workspaceId) {
        void emitAutomationEvent({
          trigger: 'TASK_CREATED',
          taskId: task.id,
          actorId: req.user!.id,
          workspaceId: task.workspaceId,
          projectId: task.projectId ?? null,
        });
      }
    },
  );

  res.status(201).json({ success: true, message: 'Task created successfully', data: task });
});

export const getTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const task = await TaskQuery.getTaskById(req.params.id, req.user!.id);
  res.json({ success: true, data: task });
});

export const updateTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  // ✅ Remove this — it blocks admins before permission check even runs
  // const oldTask = await TaskQuery.getTaskById(req.params.id, req.user!.id);

  // ✅ Fetch old task without ownership restriction (needed for dueDate diff + activity changes)
  const oldTask = await prisma.task.findUnique({
    where:  { id: req.params.id },
    select: {
      title: true, description: true, priority: true, status: true, projectId: true,
      dueDate: true, startDate: true, estimatedHours: true,
      focusRequired: true, focusLevel: true, energyType: true, distractionCost: true, intent: true,
      assignees: { select: { userId: true } },
      labels:    { select: { labelId: true } },
    },
  });

  const task = await TaskMutation.updateTask(
    req.params.id, req.user!.id, parsed.data,
    async ({ task, oldStatus, newStatus, addedAssigneeIds = [] }) => {
      // Notify people who were newly assigned through this edit (re-assign / add assignee)
      if (addedAssigneeIds.length > 0) {
        void TaskNotifications.notifyAddedAssignees({
          taskId:    task.id,
          taskTitle: task.title,
          addedIds:  addedAssigneeIds,
          updaterId: req.user!.id,
        });
      }
      if (newStatus === 'COMPLETED' && oldStatus && oldStatus !== 'COMPLETED') {
        void TaskNotifications.notifyTaskCompleted({ taskId: task.id, taskTitle: task.title, userId: req.user!.id });
      }
      const dates = new Set<Date>();
      if (oldTask?.dueDate) dates.add(oldTask.dueDate);
      if (task.dueDate)     dates.add(task.dueDate);
      for (const date of dates) {
        void CalendarAggregation.recalculateDay(req.user!.id, task.workspaceId || undefined, date);
      }

      // Log an activity entry so other members can see what changed and who did it
      if (task.workspaceId) {
        const changes = computeTaskChanges(parsed.data, oldTask);
        if (Object.keys(changes).length > 0) {
          void TaskActivity.logUpdated({
            taskId:      task.id,
            taskTitle:   task.title,
            userId:      req.user!.id,
            workspaceId: task.workspaceId,
            changes,
          });
        }
      }

      // Emit a STATUS_CHANGED automation event when the edit form changed
      // the task status — same event shape as PATCH /tasks/:id/status so
      // automation rules fire regardless of which UI path changed it.
      if (task.workspaceId && newStatus && oldStatus && newStatus !== oldStatus) {
        void emitAutomationEvent({
          trigger: 'STATUS_CHANGED',
          taskId: task.id,
          actorId: req.user!.id,
          workspaceId: task.workspaceId,
          projectId: task.projectId ?? null,
          fromStatus: oldStatus,
          toStatus: newStatus,
        });
      }
    },
  );

  res.json({ success: true, message: 'Task updated successfully', data: task });
});

export const updateTaskStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTaskStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const task = await TaskMutation.updateTaskStatus(
    req.params.id, req.user!.id, parsed.data.status,
    async ({ task, oldStatus, newStatus }) => {
      if (task.workspaceId && newStatus && oldStatus && newStatus !== oldStatus) {
        void TaskActivity.logStatusChanged({
          taskId: task.id, taskTitle: task.title, userId: req.user!.id,
          workspaceId: task.workspaceId, oldStatus, newStatus,
        });
        void emitAutomationEvent({
          trigger: 'STATUS_CHANGED',
          taskId: task.id,
          actorId: req.user!.id,
          workspaceId: task.workspaceId,
          projectId: task.projectId ?? null,
          fromStatus: oldStatus,
          toStatus: newStatus,
        });
      }
      if (newStatus === 'COMPLETED' && oldStatus !== 'COMPLETED') {
        void TaskNotifications.notifyTaskCompleted({ taskId: task.id, taskTitle: task.title, userId: req.user!.id });
      }
    },
  );

  res.json({ success: true, data: task });
});

export const deleteTask = asyncHandler(async (req: AuthRequest, res: Response) => {

  await TaskMutation.deleteTask(
    req.params.id, req.user!.id,
    async ({ task: deletedTask }) => {
      if (deletedTask.project?.workspaceId) {
        void TaskActivity.logDeleted({
          taskId:      deletedTask.id,
          taskTitle:   deletedTask.title,
          userId:      req.user!.id,
          workspaceId: deletedTask.project.workspaceId,
          status:      deletedTask.status,
          priority:    deletedTask.priority,
        });
      }
      if (deletedTask.dueDate) {  // ✅ use deletedTask (was task) for dueDate
        void CalendarAggregation.recalculateDay(
          req.user!.id,
          deletedTask.workspaceId || undefined,
          deletedTask.dueDate,
        );
      }
    },
  );

  res.json({ success: true, message: 'Task deleted successfully' });
});
export const upsertRecurrence = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = upsertRecurrenceSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const recurrence = await TaskMutation.upsertRecurrence(
    req.params.id, req.user!.id, parsed.data,
    async ({ task, recurrence: rec }) => {
      if (task?.workspaceId) {
        const unit = rec.pattern === 'WEEKLY' ? 'week' : rec.pattern === 'MONTHLY' ? 'month' : 'day';
        void TaskActivity.logUpdated({
          taskId:      task.id,
          taskTitle:   task.title,
          userId:      req.user!.id,
          workspaceId: task.workspaceId,
          changes:     { recurrence: `${rec.pattern} every ${rec.interval} ${unit}${rec.interval > 1 ? 's' : ''}` },
        });
      }
    },
  );

  res.json({ success: true, message: 'Recurrence updated', data: recurrence });
});

export const deleteRecurrence = asyncHandler(async (req: AuthRequest, res: Response) => {
  await TaskMutation.deleteRecurrence(
    req.params.id, req.user!.id,
    async ({ task }) => {
      if (task?.workspaceId) {
        void TaskActivity.logUpdated({
          taskId:      task.id,
          taskTitle:   task.title,
          userId:      req.user!.id,
          workspaceId: task.workspaceId,
          changes:     { recurrence: 'stopped' },
        });
      }
    },
  );

  res.json({ success: true, message: 'Recurrence stopped' });
});

export const getPersonalQuota = asyncHandler(async (req: AuthRequest, res: Response) => {
  const info = await getPersonalQuotaInfo(req.user!.id);
  res.json({ success: true, data: info });
});

export const getWorkspaceQuota = asyncHandler(async (req: AuthRequest, res: Response) => {
  const info = await getWorkspaceQuotaInfo(req.params.workspaceId, req.user!.id);
  res.json({ success: true, data: info });
});

// ─── Input Sanitization ──────────────────────────────────────────────────────

function sanitizeString(input: string | undefined | null, maxLength = 500): string | undefined {
  if (!input) return undefined;
  // Remove HTML tags and limit length
  return input.replace(/[<>]/g, '').substring(0, maxLength);
}

function sanitizeNumber(input: number | undefined | null): number | undefined {
  if (input === undefined || input === null) return undefined;
  const num = Number(input);
  return isNaN(num) ? undefined : num;
}

function isValidGitHubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues|tree|commit)\/.+$/.test(url);
}

export const linkGitHubEntity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { type, url, number, sha, name } = req.body;
  const userId = req.user!.id;

  // Validate link type
  const validTypes = ['pr', 'issue', 'branch', 'commit'];
  if (!validTypes.includes(type)) {
    throw new ValidationError('Invalid link type');
  }

  // Sanitize inputs
  const sanitizedUrl = sanitizeString(url, 500);
  const sanitizedName = sanitizeString(name, 200);
  const sanitizedSha = sanitizeString(sha, 40);
  const sanitizedNumber = sanitizeNumber(number);

  // Validate URL format if provided
  if (sanitizedUrl && !isValidGitHubUrl(sanitizedUrl)) {
    throw new ValidationError('Invalid GitHub URL format');
  }

  // Validate required fields based on type
  if (type === 'pr' && !sanitizedNumber && !sanitizedUrl) {
    throw new ValidationError('PR number or URL is required');
  }
  if (type === 'issue' && !sanitizedNumber && !sanitizedUrl) {
    throw new ValidationError('Issue number or URL is required');
  }
  if (type === 'branch' && !sanitizedName && !sanitizedUrl) {
    throw new ValidationError('Branch name or URL is required');
  }
  if (type === 'commit' && !sanitizedSha && !sanitizedUrl) {
    throw new ValidationError('Commit SHA or URL is required');
  }

  // Find the task with workspace/project info
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      createdById: true,
      workspaceId: true,
      projectId: true,
      status: true,
    },
  });

  if (!task) {
    throw new ValidationError('Task not found');
  }

  // Check access: user must be task creator, workspace member, or project member
  let hasAccess = task.createdById === userId;

  if (!hasAccess && task.workspaceId) {
    // Check workspace membership
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId: task.workspaceId,
      },
    });
    hasAccess = !!membership;
  }

  if (!hasAccess && task.projectId) {
    // Check project membership (project members have access)
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { workspaceId: true },
    });
    if (project?.workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          userId,
          workspaceId: project.workspaceId,
        },
      });
      hasAccess = !!membership;
    }
  }

  if (!hasAccess) {
    throw new ValidationError('You do not have permission to link GitHub entities to this task');
  }

  // Extract repository name from URL if provided
  let repoName: string | undefined;
  if (sanitizedUrl) {
    const repoMatch = sanitizedUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (repoMatch) {
      repoName = repoMatch[1];
    }
  }

  // Build update data based on link type
  const updateData: Record<string, unknown> = {};

  // Always store repository name if available
  if (repoName) {
    updateData.githubRepo = repoName;
  }

  // Try to fetch actual PR/issue status from GitHub if we have an access token
  let prStatus = 'open';
  let issueState = 'open';

  if (type === 'pr' || type === 'issue') {
    const integration = await prisma.integration.findFirst({
      where: {
        userId,
        provider: 'github',
        active: true,
      },
    });

    if (integration?.accessToken && sanitizedUrl) {
      try {
        const response = await fetch(sanitizedUrl, {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/vnd.github+json',
          },
        });

        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          if (type === 'pr') {
            prStatus = (data.merged ? 'merged' : data.state === 'closed' ? 'closed' : 'open') as string;
          } else {
            issueState = (data.state === 'closed' ? 'closed' : 'open') as string;
          }
        }
      } catch {
        // If we can't fetch, use defaults
        console.log('Could not fetch PR/issue status from GitHub');
      }
    }
  }

  switch (type) {
    case 'pr':
      updateData.githubPrUrl = sanitizedUrl;
      updateData.githubPrNumber = sanitizedNumber;
      updateData.githubPrStatus = prStatus;
      // Auto-complete task if PR is already merged
      if (prStatus === 'merged') {
        updateData.status = 'COMPLETED';
      }
      break;
    case 'issue':
      updateData.githubIssueUrl = sanitizedUrl;
      updateData.githubIssueNumber = sanitizedNumber;
      updateData.githubIssueState = issueState;
      break;
    case 'branch':
      updateData.githubBranchName = sanitizedName;
      updateData.githubBranchUrl = sanitizedUrl;
      break;
    case 'commit':
      updateData.githubCommitSha = sanitizedSha;
      updateData.githubCommitUrl = sanitizedUrl;
      break;
  }

  // Update the task
  const updatedTask = await prisma.task.update({
    where: { id },
    data: updateData,
  });

  // Linking a merged PR auto-completes the task — emit a STATUS_CHANGED
  // event so automation rules behave exactly as if the user set it manually.
  if (prStatus === 'merged' && task.workspaceId && task.status !== 'COMPLETED') {
    void emitAutomationEvent({
      trigger: 'STATUS_CHANGED',
      taskId: task.id,
      actorId: userId,
      workspaceId: task.workspaceId,
      projectId: task.projectId ?? null,
      fromStatus: task.status,
      toStatus: 'COMPLETED',
    });
  }

  res.json({ success: true, data: updatedTask });
});

// ─── Slack Link/Unlink Handlers ───────────────────────────────────────────────

/**
 * Link a Slack message to a task
 */
export const linkSlackMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { channelId, messageTs, messageUrl, threadTs } = req.body;
  const userId = req.user!.id;

  // Validate required fields
  if (!channelId || !messageTs) {
    throw new ValidationError('channelId and messageTs are required');
  }

  // Sanitize inputs
  const sanitizedChannelId = String(channelId).replace(/[<>]/g, '').substring(0, 20);
  const sanitizedMessageTs = String(messageTs).substring(0, 50);
  const sanitizedMessageUrl = messageUrl ? String(messageUrl).substring(0, 500) : undefined;
  const sanitizedThreadTs = threadTs ? String(threadTs).substring(0, 50) : undefined;

  // Validate URL format if provided
  if (sanitizedMessageUrl && !isValidSlackMessageUrl(sanitizedMessageUrl)) {
    throw new ValidationError('Invalid Slack message URL format');
  }

  // Find the task and check access
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, createdById: true, workspaceId: true, projectId: true },
  });

  if (!task) {
    throw new ValidationError('Task not found');
  }

  // Check access: user must be task creator, workspace member, or project member
  let hasAccess = task.createdById === userId;
  if (!hasAccess && task.workspaceId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: task.workspaceId },
    });
    hasAccess = !!membership;
  }
  if (!hasAccess && task.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { workspaceId: true },
    });
    if (project?.workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId, workspaceId: project.workspaceId },
      });
      hasAccess = !!membership;
    }
  }

  if (!hasAccess) {
    throw new ValidationError('You do not have permission to link Slack messages to this task');
  }

  // Update the task with Slack link data
  const updateData: Record<string, unknown> = {
    slackChannelId: sanitizedChannelId,
    slackMessageTs: sanitizedMessageTs,
  };
  if (sanitizedMessageUrl) updateData.slackMessageUrl = sanitizedMessageUrl;
  if (sanitizedThreadTs) updateData.slackThreadTs = sanitizedThreadTs;

  const updatedTask = await prisma.task.update({
    where: { id },
    data: updateData,
  });

  res.json({ success: true, data: updatedTask });
});

/**
 * Unlink Slack message from a task
 */
export const unlinkSlackMessage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  // Find the task and check access
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, createdById: true, workspaceId: true, projectId: true },
  });

  if (!task) {
    throw new ValidationError('Task not found');
  }

  let hasAccess = task.createdById === userId;
  if (!hasAccess && task.workspaceId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId, workspaceId: task.workspaceId },
    });
    hasAccess = !!membership;
  }
  if (!hasAccess && task.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { workspaceId: true },
    });
    if (project?.workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId, workspaceId: project.workspaceId },
      });
      hasAccess = !!membership;
    }
  }

  if (!hasAccess) {
    throw new ValidationError('You do not have permission to unlink Slack from this task');
  }

  // Clear all Slack fields
  await prisma.$executeRaw`
    UPDATE "Task" SET
      "slackChannelId" = NULL,
      "slackMessageTs" = NULL,
      "slackThreadTs" = NULL,
      "slackMessageUrl" = NULL,
      "slackUserId" = NULL,
      "slackUserDisplayName" = NULL
    WHERE id = ${id}
  `;

  const updatedTask = await prisma.task.findUnique({ where: { id } });
  res.json({ success: true, data: updatedTask });
});

export const unlinkGitHubEntity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  // Find the task
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      createdById: true,
      workspaceId: true,
      projectId: true,
    },
  });

  if (!task) {
    throw new ValidationError('Task not found');
  }

  // Check access
  let hasAccess = task.createdById === userId;

  if (!hasAccess && task.workspaceId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId: task.workspaceId,
      },
    });
    hasAccess = !!membership;
  }

  if (!hasAccess && task.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: task.projectId },
      select: { workspaceId: true },
    });
    if (project?.workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          userId,
          workspaceId: project.workspaceId,
        },
      });
      hasAccess = !!membership;
    }
  }

  if (!hasAccess) {
    throw new ValidationError('You do not have permission to unlink GitHub from this task');
  }

  // Clear all GitHub fields using SQL for better performance
  await prisma.$executeRaw`
    UPDATE "Task" SET
      "githubRepo" = NULL,
      "githubPrUrl" = NULL,
      "githubPrNumber" = NULL,
      "githubPrStatus" = NULL,
      "githubPrChecks" = NULL,
      "githubIssueUrl" = NULL,
      "githubIssueNumber" = NULL,
      "githubIssueState" = NULL,
      "githubBranchName" = NULL,
      "githubBranchUrl" = NULL,
      "githubBranchProtected" = NULL,
      "githubCommitSha" = NULL,
      "githubCommitUrl" = NULL,
      "githubCommitMessage" = NULL,
      "githubCommitAuthor" = NULL,
      "githubWorkflowStatus" = NULL,
      "githubWorkflowName" = NULL,
      "githubWorkflowUrl" = NULL,
      "githubWorkflowRunId" = NULL,
      "githubReleaseName" = NULL,
      "githubReleaseUrl" = NULL,
      "githubReleaseTagName" = NULL,
      "githubMilestoneTitle" = NULL,
      "githubMilestoneUrl" = NULL,
      "githubMilestoneState" = NULL,
      "githubProjectNumber" = NULL,
      "githubProjectUrl" = NULL,
      "githubProjectTitle" = NULL,
      "githubDiscussionNumber" = NULL,
      "githubDiscussionUrl" = NULL,
      "githubDiscussionCategory" = NULL,
      "githubLabels" = NULL
    WHERE id = ${id}
  `;

  // Fetch and return the updated task
  const updatedTask = await prisma.task.findUnique({ where: { id } });

  res.json({ success: true, data: updatedTask });
});