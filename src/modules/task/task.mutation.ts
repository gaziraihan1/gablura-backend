import { prisma } from "../../lib/prisma.js";
import type { CreateTaskInput, UpdateTaskInput } from "./task.types.js";
import { taskFullInclude, taskWithAssigneesInclude } from "./task.selects.js";
import { TaskAccess } from "./task.access.js";
import { getTimeStatus } from "./task.utils.js";
import {
  checkAndConsumePersonalQuota,
  checkAndConsumeWorkspaceQuota,
  rollbackPersonalQuota,
  rollbackWorkspaceQuota,
} from "./task.quota.service.js";
import { AnalyticsCache, WorkspaceCache } from "../../lib/redis/cache.client.js";
import { getRedisClient } from "../../redis/redis.client.js";

// ─── Plan resolution ──────────────────────────────────────────────────────────
// Adapt these two functions to match however your DB stores plan info.

async function resolveUserPlan(userId: string): Promise<"FREE" | "PRO"> {
  const cacheKey = `plan:user:${userId}`;
  const redis = getRedisClient();

  const cached = await redis.get(cacheKey);
  if (cached) return (cached === 'PRO' ? 'PRO' : 'FREE') as "FREE" | "PRO";

  const bestSub = await prisma.subscription.findFirst({
    where: {
      workspace: { ownerId: userId },
      status: { in: ['ACTIVE', 'TRIALING'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { plan: { select: { name: true } } },
  });

  const planName = bestSub?.plan.name ?? 'FREE';
  await redis.setex(cacheKey, 600, planName);

  return (planName === 'PRO' ? 'PRO' : 'FREE') as "FREE" | "PRO";
}

async function resolveWorkspacePlan(
  workspaceId: string,
): Promise<"FREE" | "PRO" | "BUSINESS" | "ENTERPRISE"> {
  const cacheKey = `plan:workspace:${workspaceId}`;
  const redis = getRedisClient();

  const cached = await redis.get(cacheKey);
  if (cached) {
    if (cached === 'ENTERPRISE') return 'ENTERPRISE';
    if (cached === 'BUSINESS')   return 'BUSINESS';
    if (cached === 'PRO')        return 'PRO';
    return 'FREE';
  }

  const ws = await prisma.workspace.findUnique({
    where:  { id: workspaceId },
    select: { plan: true },
  });

  const planName = (ws?.plan ?? 'FREE') as string;
  await redis.setex(cacheKey, 600, planName);

  if (planName === 'ENTERPRISE') return 'ENTERPRISE';
  if (planName === 'BUSINESS')   return 'BUSINESS';
  if (planName === 'PRO')        return 'PRO';
  return 'FREE';
}
// ─── Callback types ───────────────────────────────────────────────────────────

type OnTaskCreated = (data: {
  task: any;
  assigneeIds: string[];
}) => Promise<void>;
type OnTaskUpdated = (data: {
  task: any;
  oldStatus?: string;
  newStatus?: string;
  addedAssigneeIds: string[];
}) => Promise<void>;
type OnTaskDeleted = (data: { task: any }) => Promise<void>;
type OnCommentAdded = (data: {
  taskId: string;
  taskTitle: string;
  workspaceId?: string;
}) => Promise<void>;

// ─── Mutations ────────────────────────────────────────────────────────────────

export const TaskMutation = {
  async createTask(data: CreateTaskInput, onCreated?: OnTaskCreated) {
    // ── Validation ────────────────────────────────────────────────────────────
    if (!data.title?.trim()) throw new Error("Task title is required");
    if (
      data.focusLevel !== undefined &&
      (data.focusLevel < 1 || data.focusLevel > 5)
    ) {
      throw new Error("Focus level must be between 1 and 5");
    }
    if (data.distractionCost !== undefined && data.distractionCost < 0) {
      throw new Error("Distraction cost cannot be negative");
    }
    if (data.assigneeIds && data.assigneeIds.length > 5) {
      throw new Error("Too many assignees reduce task focus");
    }

    // ── Resolve project / workspace ───────────────────────────────────────────
    let finalWorkspaceId: string | null = null;

    if (data.projectId) {
      const project = await prisma.project.findFirst({
        where: {
          id: data.projectId,
          workspace: {
            OR: [
              { ownerId: data.createdById },
              { members: { some: { userId: data.createdById } } },
            ],
          },
        },
        select: { workspaceId: true },
      });
      if (!project) throw new Error("You do not have access to this project");
      finalWorkspaceId = project.workspaceId;
    }

    // ── Quota check (atomic Redis INCR) ────────────────────────────────────────
    let quotaConsumed: "personal" | "workspace" | null = null;

    if (finalWorkspaceId) {
      const [plan, memberCount] = await Promise.all([
        resolveWorkspacePlan(finalWorkspaceId),
        prisma.workspaceMember.count({
          where: { workspaceId: finalWorkspaceId },
        }),
      ]);

      const quota = await checkAndConsumeWorkspaceQuota(
        data.createdById,
        finalWorkspaceId,
        plan,
        memberCount,
      );

      if (!quota.allowed) {
        throw new Error(
          quota.reason ?? "Workspace task creation limit reached",
        );
      }

      quotaConsumed = "workspace";
      console.log(
        `📊 Workspace quota consumed — ${quota.remaining ?? "∞"} remaining`,
      );
    } else {
      const plan = await resolveUserPlan(data.createdById);
      const quota = await checkAndConsumePersonalQuota(data.createdById, plan);

      if (!quota.allowed) {
        throw new Error(
          quota.reason ?? "Daily personal task creation limit reached",
        );
      }

      quotaConsumed = "personal";
      console.log(
        `📊 Personal quota consumed — ${quota.remaining} remaining today`,
      );
    }

    // ── DB Insert ──────────────────────────────────────────────────────────────
    let computedPriority = data.priority ?? "MEDIUM";
    if (!data.priority && data.dueDate) {
      const hoursLeft = (new Date(data.dueDate).getTime() - Date.now()) / 36e5;
      if (hoursLeft <= 24) computedPriority = "HIGH";
    }

    const taskData: any = {
      title: data.title,
      description: data.description,
      status: data.status || "TODO",
      priority: computedPriority as any,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      estimatedHours: data.estimatedHours,
      focusRequired: data.focusRequired ?? false,
      focusLevel: data.focusLevel,
      energyType: data.energyType as any,
      distractionCost: data.distractionCost,
      intent: data.intent as any,
      createdBy: { connect: { id: data.createdById } },
    };

    if (data.projectId) taskData.project = { connect: { id: data.projectId } };
    if (finalWorkspaceId)
      taskData.workspace = { connect: { id: finalWorkspaceId } };
    if (data.parentId) taskData.parent = { connect: { id: data.parentId } };
    if (data.assigneeIds?.length) {
      taskData.assignees = {
        create: data.assigneeIds.map((userId) => ({ userId })),
      };
    }
    if (data.labelIds?.length) {
      taskData.labels = {
        create: data.labelIds.map((labelId) => ({ labelId })),
      };
    }

    let task: any;
    try {
      task = await prisma.task.create({
        data: taskData,
        include: taskFullInclude,
      });
    } catch (dbError) {
      if (quotaConsumed === "personal") {
        await rollbackPersonalQuota(data.createdById);
      } else if (quotaConsumed === "workspace" && finalWorkspaceId) {
        await rollbackWorkspaceQuota(data.createdById, finalWorkspaceId);
      }
      throw dbError;
    }

    console.log(`✨ Task created: "${task.title}" (ID: ${task.id})`);

    // Invalidate analytics and workspace stats cache (non-blocking)
    if (finalWorkspaceId) {
      Promise.all([
        AnalyticsCache.invalidateWorkspace(finalWorkspaceId),
        WorkspaceCache.invalidateWorkspace(finalWorkspaceId),
      ]).catch((err) => console.error("[Cache] Failed to invalidate after task creation:", err));
    }

    if (onCreated) {
      onCreated({ task, assigneeIds: data.assigneeIds || [] }).catch((err) =>
        console.error("Post-creation callback failed:", err),
      );
    }

    return { ...task, timeTracking: getTimeStatus(task) };
  },

  async updateTask(
    taskId: string,
    userId: string,
    data: UpdateTaskInput,
    onUpdated?: OnTaskUpdated,
  ) {
    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new Error(
        permission.reason || "You do not have permission to edit this task",
      );
    }

    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true, assignees: true },
    });
    if (!existingTask) throw new Error("Task not found");

    const wasCompleted =
      data.status === "COMPLETED" && existingTask.status !== "COMPLETED";

    const updateData: any = {};
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.status) updateData.status = data.status as any;
    if (data.priority) updateData.priority = data.priority as any;
    if (data.dueDate !== undefined)
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.startDate !== undefined)
      updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.estimatedHours !== undefined)
      updateData.estimatedHours = data.estimatedHours;
    if (wasCompleted) updateData.completedAt = new Date();
    if (data.focusRequired !== undefined)
      updateData.focusRequired = data.focusRequired;
    if (data.focusLevel !== undefined) updateData.focusLevel = data.focusLevel;
    if (data.energyType !== undefined)
      updateData.energyType = data.energyType as any;
    if (data.distractionCost !== undefined)
      updateData.distractionCost = data.distractionCost;
    if (data.intent !== undefined) updateData.intent = data.intent as any;

    const task = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: taskFullInclude,
    });

    console.log(`✏️  Task updated: "${task.title}" (ID: ${task.id})`);

    if (existingTask.workspaceId) {
      Promise.all([
        AnalyticsCache.invalidateWorkspace(existingTask.workspaceId),
        WorkspaceCache.invalidateWorkspace(existingTask.workspaceId),
      ]).catch((err) => console.error("[Cache] Failed to invalidate after task update:", err));
    }

    let addedAssigneeIds: string[] = [];
    if (data.assigneeIds !== undefined) {
      const existingIds = existingTask.assignees.map((a) => a.userId);
      addedAssigneeIds = data.assigneeIds.filter(
        (uid) => !existingIds.includes(uid),
      );
      await prisma.taskAssignee.deleteMany({ where: { taskId } });
      if (data.assigneeIds.length > 0) {
        await prisma.taskAssignee.createMany({
          data: data.assigneeIds.map((userId) => ({ taskId, userId })),
        });
      }
    }

    if (data.labelIds !== undefined) {
      await prisma.taskLabel.deleteMany({ where: { taskId } });
      if (data.labelIds.length > 0) {
        await prisma.taskLabel.createMany({
          data: data.labelIds.map((labelId) => ({ taskId, labelId })),
        });
      }
    }

    if (onUpdated) {
      onUpdated({
        task,
        oldStatus: data.status ? existingTask.status : undefined,
        newStatus: data.status,
        addedAssigneeIds,
      }).catch((err) => console.error("Post-update callback failed:", err));
    }

    return { ...task, timeTracking: getTimeStatus(task) };
  },

  async updateTaskStatus(
    taskId: string,
    userId: string,
    status: string,
    onUpdated?: OnTaskUpdated,
  ) {
    if (!status) throw new Error("Status is required");

    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new Error(
        permission.reason ||
          "You do not have permission to change this task status",
      );
    }

    const existingTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: taskWithAssigneesInclude,
    });
    if (!existingTask) throw new Error("Task not found");

    const wasCompleted =
      status === "COMPLETED" && existingTask.status !== "COMPLETED";

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: status as any,
        ...(wasCompleted && { completedAt: new Date() }),
      },
      include: taskFullInclude,
    });

    console.log(`🔄 Task status updated: "${existingTask.title}" → ${status}`);

    // Invalidate analytics and workspace stats cache (non-blocking)
    if (existingTask.workspaceId) {
      Promise.all([
        AnalyticsCache.invalidateWorkspace(existingTask.workspaceId),
        WorkspaceCache.invalidateWorkspace(existingTask.workspaceId),
      ]).catch((err) => console.error("[Cache] Failed to invalidate after status update:", err));
    }

    if (onUpdated) {
      onUpdated({
        task: updated,
        oldStatus: existingTask.status,
        newStatus: status,
        addedAssigneeIds: [],
      }).catch((err) =>
        console.error("Post-status-update callback failed:", err),
      );
    }

    return { ...updated, timeTracking: getTimeStatus(updated) };
  },

  async deleteTask(taskId: string, userId: string, onDeleted?: OnTaskDeleted) {
    const task = await TaskAccess.assertDeletePermission(taskId, userId);
    
    // Store workspaceId before deletion
    const workspaceId = task.workspaceId;
    
    await prisma.task.delete({ where: { id: taskId } });

    console.log(`🗑️  Task deleted: "${task.title}" (ID: ${task.id})`);

    // Invalidate analytics and workspace stats cache (non-blocking)
    if (workspaceId) {
      Promise.all([
        AnalyticsCache.invalidateWorkspace(workspaceId),
        WorkspaceCache.invalidateWorkspace(workspaceId),
      ]).catch((err) => console.error("[Cache] Failed to invalidate after task deletion:", err));
    }

    if (onDeleted) {
      onDeleted({ task }).catch((err) =>
        console.error("Post-deletion callback failed:", err),
      );
    }

    return { success: true };
  },

  async addComment(
    taskId: string,
    userId: string,
    content: string,
    onCommentAdded?: OnCommentAdded,
  ) {
    const comment = await prisma.comment.create({
      data: { taskId, userId, content },
    });

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });

    if (onCommentAdded && task) {
      onCommentAdded({
        taskId,
        taskTitle: task.title,
        workspaceId: task.project?.workspaceId ?? undefined,
      }).catch((err) => console.error("Post-comment callback failed:", err));
    }

    return comment;
  },
};