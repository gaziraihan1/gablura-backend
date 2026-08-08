import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskMutation, computeStatusTransition, refreshTaskStatus } from "../../../modules/task/task.mutation.js";
import { TaskAccess } from "../../../modules/task/task.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ProjectAccess } from "../../../modules/project/project.access.js";
import { 
  checkAndConsumePersonalQuota, 
  checkAndConsumeWorkspaceQuota, 
  rollbackPersonalQuota, 
  rollbackWorkspaceQuota 
} from "../../../modules/task/task.quota.service.js";
import { BadRequestError, ForbiddenError } from "../../../errors/index.js";
import { TaskCache } from "../../../lib/redis/cache.client.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(async (fnOrFns: any) => {
      const tx = {
        taskAssignee: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
        taskLabel: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      };
      if (typeof fnOrFns === 'function') {
        return fnOrFns(tx);
      }
      if (Array.isArray(fnOrFns)) {
        for (const fn of fnOrFns) await fn(tx);
      }
    }),
    task: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    projectSection: {
      findFirst: vi.fn(),
    },
    sprint: {
      findFirst: vi.fn(),
    },
    projectMilestone: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      count: vi.fn(),
    },
    taskAssignee: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    taskLabel: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    comment: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/task/task.access.js", () => ({
  TaskAccess: {
    checkEditPermission: vi.fn(),
    assertDeletePermission: vi.fn(),
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectNotArchived: vi.fn(),
  },
}));

vi.mock("../../../modules/task/task.quota.service.js", () => ({
  checkAndConsumePersonalQuota: vi.fn(),
  checkAndConsumeWorkspaceQuota: vi.fn(),
  rollbackPersonalQuota: vi.fn(),
  rollbackWorkspaceQuota: vi.fn(),
  resolveWorkspacePlan: vi.fn().mockResolvedValue("FREE"),
  resolveUserPlan: vi.fn().mockResolvedValue("FREE"),
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    AnalyticsCache: { invalidateWorkspace: vi.fn() },
    WorkspaceCache: { invalidateWorkspace: vi.fn() },
    TaskCache: { invalidateTask: vi.fn() },
    AccessControlCache: { invalidateTaskEdit: vi.fn() },
    CacheClient: { 
      ...actual.CacheClient,
      get: vi.fn(), 
      set: vi.fn() 
    },
  };
});

vi.mock("../../../redis/redis.client.js", () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
  })),
}));

describe("computeStatusTransition", () => {
  it("detects completion (TODO -> COMPLETED)", () => {
    expect(computeStatusTransition("TODO", "COMPLETED")).toEqual({
      wasCompleted: true,
      wasReopened: false,
    });
  });

  it("detects reopen (COMPLETED -> TODO)", () => {
    expect(computeStatusTransition("COMPLETED", "TODO")).toEqual({
      wasCompleted: false,
      wasReopened: true,
    });
  });

  it("no transition when the status is unchanged", () => {
    expect(computeStatusTransition("TODO", "TODO")).toEqual({
      wasCompleted: false,
      wasReopened: false,
    });
  });

  it("no transition when the next status is missing", () => {
    expect(computeStatusTransition("TODO", undefined)).toEqual({
      wasCompleted: false,
      wasReopened: false,
    });
  });

  it("no transition when the task is already completed", () => {
    expect(computeStatusTransition("COMPLETED", "COMPLETED")).toEqual({
      wasCompleted: false,
      wasReopened: false,
    });
  });
});

describe("refreshTaskStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes existingTask.status from the live DB row", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ status: "COMPLETED" } as any);
    const existing = { status: "TODO" };

    await refreshTaskStatus("t1", existing);

    expect(prisma.task.findUnique).toHaveBeenCalledWith({
      where: { id: "t1" },
      select: { status: true },
    });
    expect(existing.status).toBe("COMPLETED");
  });

  it("keeps existingTask.status when the DB row is missing", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);
    const existing = { status: "TODO" };

    await refreshTaskStatus("t1", existing);

    expect(existing.status).toBe("TODO");
  });
});

describe("TaskMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask", () => {
    const mockInput = {
      title: "Test Task",
      createdById: "u1",
      projectId: "p1",
    };

    it("should create a task in a workspace project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true, remaining: 100 } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task", workspaceId: "ws1" } as any);

      const result = await TaskMutation.createTask(mockInput);

      expect(result.id).toBe("t1");
      expect(prisma.task.create).toHaveBeenCalled();
      expect(checkAndConsumeWorkspaceQuota).toHaveBeenCalled();
    });

    it("should create a personal task if no project", async () => {
      const input = { ...mockInput, projectId: null };
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
      vi.mocked(checkAndConsumePersonalQuota).mockResolvedValue({ allowed: true, remaining: 50 } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task" } as any);

      const result = await TaskMutation.createTask(input as any);

      expect(result.id).toBe("t1");
      expect(checkAndConsumePersonalQuota).toHaveBeenCalled();
    });

    it("should throw BadRequestError if title is missing or empty", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, title: " " })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if title exceeds 200 characters", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, title: "a".repeat(201) })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if focusLevel is out of range", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, focusLevel: 6 })).rejects.toThrow(BadRequestError);
      await expect(TaskMutation.createTask({ ...mockInput, focusLevel: 0 })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if distractionCost is negative", async () => {
      await expect(TaskMutation.createTask({ ...mockInput, distractionCost: -1 })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if startDate is after dueDate", async () => {
      const input = { 
        ...mockInput, 
        startDate: new Date('2026-07-01'), 
        dueDate: new Date('2026-06-01') 
      };
      await expect(TaskMutation.createTask(input as any)).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if too many assignees", async () => {
      const input = { ...mockInput, assigneeIds: ['1', '2', '3', '4', '5', '6'] };
      await expect(TaskMutation.createTask(input as any)).rejects.toThrow(BadRequestError);
    });

    it("should throw ForbiddenError if user has no access to the project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow(ForbiddenError);
    });

    it("should compute HIGH priority if dueDate is within 24 hours and priority not provided", async () => {
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 12);
      
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      
      const input = { ...mockInput, dueDate: tomorrow, priority: undefined };
      
      await TaskMutation.createTask(input as any);
      
      expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ priority: 'HIGH' })
      }));
    });

    it("should set sectionId when the section belongs to the project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.projectSection.findFirst).mockResolvedValue({ id: "sec-1" } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", sectionId: "sec-1" } as any);

      await TaskMutation.createTask({ ...mockInput, sectionId: "sec-1" });

      expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sectionId: "sec-1" }),
      }));
    });

    it("should throw BadRequestError when sectionId belongs to another project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.projectSection.findFirst).mockResolvedValue(null);

      await expect(TaskMutation.createTask({ ...mockInput, sectionId: "sec-other" })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError when sectionId is provided without a project", async () => {
      vi.mocked(checkAndConsumePersonalQuota).mockResolvedValue({ allowed: true } as any);

      await expect(
        TaskMutation.createTask({ title: "T", createdById: "u1", projectId: null, sectionId: "sec-1" } as any),
      ).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if workspace quota exceeded", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: false, reason: "Limit reached" } as any);

      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow(BadRequestError);
    });

    it("should rollback quota if DB creation fails", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "FREE" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockRejectedValue(new Error("DB Error"));

      await expect(TaskMutation.createTask(mockInput)).rejects.toThrow("DB Error");
      expect(rollbackWorkspaceQuota).toHaveBeenCalled();
    });

    it("should call onCreated callback and handle its errors", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ workspaceId: "ws1" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "Test Task", workspaceId: "ws1" } as any);
      
      const onCreated = vi.fn().mockRejectedValue(new Error("Callback Fail"));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await TaskMutation.createTask(mockInput, onCreated);
      
      expect(onCreated).toHaveBeenCalled();
      // Wait for promise to settle
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(consoleSpy).toHaveBeenCalledWith('Post-creation callback failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe("updateTask", () => {
    it("should update task if user has permission", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "Updated" } as any);

      const result = await TaskMutation.updateTask("t1", "u1", { title: "Updated" });

      expect(result.title).toBe("Updated");
      expect(prisma.task.update).toHaveBeenCalled();
      expect(TaskCache.invalidateTask).toHaveBeenCalledWith("t1");
    });

    it("should sync assignees correctly when provided", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1" } as any);

      // Capture the transaction callback to verify its internal calls
      let txCallback: any;
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        txCallback = fn;
        return fn({
          taskAssignee: {
            deleteMany: vi.fn().mockResolvedValue({}),
            createMany: vi.fn().mockResolvedValue({}),
          },
          taskLabel: {
            deleteMany: vi.fn().mockResolvedValue({}),
            createMany: vi.fn().mockResolvedValue({}),
          },
        });
      });

      const newAssignees = ["u2", "u3"];
      await TaskMutation.updateTask("t1", "u1", { assigneeIds: newAssignees } as any);

      // Verify the transaction was called
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should sync labels correctly when provided", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1" } as any);

      // Capture the transaction callback to verify its internal calls
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        return fn({
          taskAssignee: {
            deleteMany: vi.fn().mockResolvedValue({}),
            createMany: vi.fn().mockResolvedValue({}),
          },
          taskLabel: {
            deleteMany: vi.fn().mockResolvedValue({}),
            createMany: vi.fn().mockResolvedValue({}),
          },
        });
      });

      const newLabels = ["l1", "l2"];
      await TaskMutation.updateTask("t1", "u1", { labelIds: newLabels } as any);

      // Verify the transaction was called
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should handle project transition (Project A -> Project B)", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: "p1", workspaceId: "ws1", status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.project.findUnique).mockResolvedValue({ workspaceId: "ws2" } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as any);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(5);
      vi.mocked(checkAndConsumeWorkspaceQuota).mockResolvedValue({ allowed: true } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", projectId: "p2" } as any);

      await TaskMutation.updateTask("t1", "u1", { projectId: "p2" } as any);

      expect(checkAndConsumeWorkspaceQuota).toHaveBeenCalled();
      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ projectId: "p2" }),
      }));
    });

    it("should clear completedAt when reopening a COMPLETED task", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "COMPLETED", assignees: [] },
      });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({ status: "COMPLETED" } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "TODO", completedAt: null } as any);

      await TaskMutation.updateTask("t1", "u1", { status: "TODO" } as any);

      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "TODO", completedAt: null }),
      }));
    });

    it("should throw BadRequestError when sprintId is set on a personal task (no project)", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      await expect(
        TaskMutation.updateTask("t1", "u1", { sprintId: "s-1" } as any),
      ).rejects.toThrow(BadRequestError);
      expect(prisma.sprint.findFirst).not.toHaveBeenCalled();
    });

    it("should throw BadRequestError when sprintId belongs to another project", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: "p1", workspaceId: "ws1", status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.sprint.findFirst).mockResolvedValue(null);
      await expect(
        TaskMutation.updateTask("t1", "u1", { sprintId: "s-other" } as any),
      ).rejects.toThrow(BadRequestError);
    });

    it("should accept sprintId when it belongs to the task project", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: "p1", workspaceId: "ws1", status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.sprint.findFirst).mockResolvedValue({ id: "s-1" } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", sprintId: "s-1" } as any);
      await TaskMutation.updateTask("t1", "u1", { sprintId: "s-1" } as any);
      expect(prisma.sprint.findFirst).toHaveBeenCalledWith({
        where: { id: "s-1", projectId: "p1" },
        select: { id: true },
      });
      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sprintId: "s-1" }) }),
      );
    });

    it("should throw BadRequestError when milestoneId is set on a personal task (no project)", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      await expect(
        TaskMutation.updateTask("t1", "u1", { milestoneId: "m-1" } as any),
      ).rejects.toThrow(BadRequestError);
      expect(prisma.projectMilestone.findFirst).not.toHaveBeenCalled();
    });

    it("should throw BadRequestError when milestoneId belongs to another project", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: "p1", workspaceId: "ws1", status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.projectMilestone.findFirst).mockResolvedValue(null);
      await expect(
        TaskMutation.updateTask("t1", "u1", { milestoneId: "m-other" } as any),
      ).rejects.toThrow(BadRequestError);
    });

    it("should throw ForbiddenError if user cannot edit", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({ canEdit: false, reason: "No access" });

      await expect(TaskMutation.updateTask("t1", "u1", { title: "Updated" })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update status and set completedAt if status is COMPLETED", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "COMPLETED" } as any);

      const result = await TaskMutation.updateTaskStatus("t1", "u1", "COMPLETED");

      expect(result.status).toBe("COMPLETED");
      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }));
      expect(TaskCache.invalidateTask).toHaveBeenCalledWith("t1");
    });

    it("should clear completedAt when reopening a COMPLETED task", async () => {
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "COMPLETED", assignees: [] },
      });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({ status: "COMPLETED" } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "TODO", completedAt: null } as any);

      await TaskMutation.updateTaskStatus("t1", "u1", "TODO");

      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "TODO", completedAt: null }),
      }));
    });

    it("should trust the live DB status over a stale permission snapshot", async () => {
      // The permission snapshot says TODO (stale), but the live DB row is
      // COMPLETED — the fresh read must drive the transition decision.
      vi.mocked(TaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        task: { id: "t1", projectId: null, workspaceId: null, status: "TODO", assignees: [] },
      });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({ status: "COMPLETED" } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", status: "TODO", completedAt: null } as any);

      await TaskMutation.updateTaskStatus("t1", "u1", "TODO");

      expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "TODO", completedAt: null }),
      }));
    });
  });

  describe("addComment", () => {
    it("should create a comment and trigger callback", async () => {
      vi.mocked(prisma.comment.create).mockResolvedValue({ id: "c1", content: "New comment" } as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({ 
        id: "t1", 
        title: "Task 1", 
        project: { workspaceId: "ws1" } 
      } as any);
      
      const onCommentAdded = vi.fn().mockResolvedValue(undefined);
      const result = await TaskMutation.addComment("t1", "u1", "New comment", onCommentAdded);

      expect(result.id).toBe("c1");
      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: { taskId: "t1", userId: "u1", content: "New comment" },
      });
      expect(onCommentAdded).toHaveBeenCalledWith({
        taskId: "t1",
        taskTitle: "Task 1",
        workspaceId: "ws1",
      });
    });
  });
});
