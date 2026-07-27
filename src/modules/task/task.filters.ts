import { prisma } from "../../lib/prisma.js";
import type { TaskFilterParams } from "./task.types.js";
import { CacheClient, CACHE_TTL } from "../../lib/redis/cache.client.js";

export const TaskFilters = {
  buildProjectFilter(filters: TaskFilterParams): Record<string, unknown> {
    return { projectId: filters.projectId };
  },

  buildPersonalTasksFilter(filters: TaskFilterParams): Record<string, unknown> {
    if (filters.type === "personal") {
      return {
        projectId: null,
        createdById: filters.userId,
      };
    }

    if (filters.type === "assigned") {
      return {
        assignees: { some: { userId: filters.userId } },
      };
    }

    if (filters.type === "created") {
      return { createdById: filters.userId };
    }

    return {
      OR: [
        { createdById: filters.userId },
        { assignees: { some: { userId: filters.userId } } },
      ],
    };
  },

  async buildWorkspaceTasksFilter(
    filters: TaskFilterParams,
  ): Promise<Record<string, unknown>> {
    if (!filters.workspaceId) {
      throw new Error("workspaceId is required for workspace filter");
    }

    // Cache the workspace member role lookup to avoid a DB query on every task list/stats call
    const roleCacheKey = `task:workspace-role:${filters.workspaceId}:${filters.userId}`;
    const isWorkspaceAdmin = await CacheClient.getOrSet(
      roleCacheKey,
      async () => {
        const workspaceMember = await prisma.workspaceMember.findFirst({
          where: { workspaceId: filters.workspaceId, userId: filters.userId },
          select: { role: true },
        });
        return workspaceMember?.role === "OWNER" || workspaceMember?.role === "ADMIN";
      },
      CACHE_TTL.ACCESS_CONTROL_WORKSPACE_MEMBER,
    );

    // A task belongs to the workspace if it has workspaceId set directly,
    // or if it belongs to a project that is in the workspace.
    const workspaceBelongsToCondition = {
      OR: [
        { workspaceId: filters.workspaceId },
        { project: { workspaceId: filters.workspaceId } },
      ],
    };

    if (isWorkspaceAdmin) {
      // Admins see all tasks in the workspace
      if (filters.type === "assigned") {
        return {
          AND: [
            workspaceBelongsToCondition,
            { assignees: { some: { userId: filters.userId } } },
          ],
        };
      }

      if (filters.type === "created") {
        return {
          AND: [workspaceBelongsToCondition, { createdById: filters.userId }],
        };
      }

      return workspaceBelongsToCondition;
    }

    // Non-admin members: tasks must belong to the workspace AND user must be involved
    if (filters.type === "personal") {
      return { id: "no-personal-tasks-in-workspace" };
    }

    if (filters.type === "assigned") {
      return {
        AND: [
          workspaceBelongsToCondition,
          { assignees: { some: { userId: filters.userId } } },
        ],
      };
    }

    if (filters.type === "created") {
      return {
        AND: [workspaceBelongsToCondition, { createdById: filters.userId }],
      };
    }

    // Default: user is involved via creation, assignment, or project membership
    const userInvolvementConditions = {
      OR: [
        { createdById: filters.userId },
        { assignees: { some: { userId: filters.userId } } },
        {
          project: {
            AND: [
              { workspaceId: filters.workspaceId },
              { members: { some: { userId: filters.userId } } },
            ],
          },
        },
      ],
    };

    return {
      AND: [workspaceBelongsToCondition, userInvolvementConditions],
    };
  },

  applyAdditionalFilters(
    where: Record<string, unknown>,
    filters: TaskFilterParams,
  ): Record<string, unknown> {
    const result = { ...where };

    if (filters.status) result.status = filters.status;
    if (filters.priority) result.priority = filters.priority;

    if (filters.labelIds && filters.labelIds.length > 0) {
      result.labels = {
        some: { labelId: { in: filters.labelIds } },
      };
    }

    if (filters.assigneeId && filters.type !== "assigned") {
      result.assignees = {
        some: { userId: filters.assigneeId },
      };
    }

    return result;
  },

  applySearchFilter(
    where: Record<string, unknown>,
    search: string,
  ): Record<string, unknown> {
    const searchConditions = {
      OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { description: { contains: search, mode: "insensitive" as const } },
      ],
    };

    if (where.AND) {
      return {
        ...where,
        AND: [...(where.AND as any[]), searchConditions],
      };
    } else if (where.OR) {
      const result: Record<string, unknown> = {
        AND: [{ OR: where.OR }, searchConditions],
      };
      if (where.project) result.project = where.project;
      if (where.projectId) result.projectId = where.projectId;
      if (where.createdById) result.createdById = where.createdById;
      if (where.assignees) result.assignees = where.assignees;
      return result;
    } else {
      return {
        ...where,
        ...searchConditions,
      };
    }
  },

  buildOrderBy(
    sortBy: "dueDate" | "priority" | "status" | "createdAt" | "title",
    sortOrder: "asc" | "desc",
  ): any[] {
    const order: "asc" | "desc" = sortOrder === "asc" ? "asc" : "desc";

    switch (sortBy) {
      case "dueDate":
        return [
          { dueDate: { sort: order, nulls: "last" as const } },
          { createdAt: "desc" as const },
        ];
      case "priority":
        return [
          { priority: order },
          { dueDate: { sort: "asc" as const, nulls: "last" as const } },
        ];
      case "status":
        return [{ status: order }, { priority: "desc" as const }];
      case "title":
        return [{ title: order }];
      case "createdAt":
      default:
        return [{ createdAt: order }];
    }
  },
};
